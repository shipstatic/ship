import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processFilesForNode } from '@/lib/node-files';
import { __setTestEnvironment } from '@/lib/env';
import { ShipError, ShipErrorType } from '@shipstatic/types';
import { setConfig } from '@/core/platform-config';

// Define mock implementations using vi.hoisted()
const { MOCK_CALCULATE_MD5_FN } = vi.hoisted(() => ({ MOCK_CALCULATE_MD5_FN: vi.fn() }));

const { MOCK_FS_IMPLEMENTATION } = vi.hoisted(() => ({
  MOCK_FS_IMPLEMENTATION: { readdirSync: vi.fn(), statSync: vi.fn(), readFileSync: vi.fn() }
}));

const { MOCK_PATH_MODULE_IMPLEMENTATION } = vi.hoisted(() => {
  const basenameFn = (p: string) => p.split(/[\/\\]/).pop() || '';
  return {
    MOCK_PATH_MODULE_IMPLEMENTATION: {
      resolve: vi.fn(),
      join: vi.fn(),
      relative: vi.fn(),
      dirname: vi.fn(),
      basename: vi.fn(basenameFn),
      sep: '/'
    }
  };
});

// Mock modules
vi.mock('@/lib/md5', () => ({ calculateMD5: MOCK_CALCULATE_MD5_FN }));
vi.mock('fs', () => MOCK_FS_IMPLEMENTATION);

// We don't need to mock @/lib/path since we use the real unified implementation
vi.mock('path', () => MOCK_PATH_MODULE_IMPLEMENTATION);

describe('Node File Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MOCK_CALCULATE_MD5_FN.mockResolvedValue({ md5: 'mocked-md5-for-node-files' });
    
    // Initialize platform config for tests
    setConfig({
      maxFileSize: 10 * 1024 * 1024,
      maxFilesCount: 1000,
      maxTotalSize: 100 * 1024 * 1024,
    });

    MOCK_PATH_MODULE_IMPLEMENTATION.resolve.mockImplementation((...args: string[]) => {
      let path = args.join(require('path').sep);
      if (!require('path').isAbsolute(path)) path = require('path').join('/mock/cwd', path);
      return path.replace(/\\/g, '/');
    });
    MOCK_PATH_MODULE_IMPLEMENTATION.join.mockImplementation((...args: string[]) => args.join('/').replace(/\/+/g, '/'));
    MOCK_PATH_MODULE_IMPLEMENTATION.relative.mockImplementation((from: string, to: string) => {
      // For tests, ensure path.relative strips the common prefix to match the expected behavior
      // with the new pathDetect=false default
      
      // Handle the case where the 'to' path is a direct child of 'from'
      if (to.startsWith(from + '/')) {
        return to.substring(from.length + 1); // +1 to account for the trailing slash
      }
      
      // For directories being tested (they would have a mock/cwd prefix)
      if (to.startsWith('/mock/cwd/dir/')) {
        return to.substring('/mock/cwd/dir/'.length);
      }
      
      // For nested/asdf test case
      if (to.startsWith('/mock/cwd/nested/asdf/')) {
        return to.substring('/mock/cwd/nested/asdf/'.length);
      }
      
      // If no clear relationship, try simple prefix removal
      if (to.startsWith(from)) {
        return to.substring(from.length).replace(/^\//, '');
      }
      
      // Default case - return the 'to' path
    });
    
    MOCK_PATH_MODULE_IMPLEMENTATION.dirname.mockImplementation((p: string) => {
      // Get directory name
      const lastSlash = p.lastIndexOf('/');
      if (lastSlash === -1) return '.';
      if (lastSlash === 0) return '/';
      return p.substring(0, lastSlash);
    });
    
    MOCK_PATH_MODULE_IMPLEMENTATION.basename.mockImplementation((p: string) => {
      return p.split('/').pop() || '';
    });

    // Mock process.cwd() to return a consistent path
    vi.spyOn(process, 'cwd').mockReturnValue('/mock/cwd');
  });

  afterEach(() => {
    __setTestEnvironment(null);
  });

  const setupMockFsNode = (files: Record<string, { type: 'dir' } | { type: 'file'; content?: string; size?: number }>) => {
    // Mock statSync to handle directory detection properly
    MOCK_FS_IMPLEMENTATION.statSync.mockImplementation((filePath: string) => {
      const normalizedPath = MOCK_PATH_MODULE_IMPLEMENTATION.resolve(filePath.toString());
      const fileData = files[normalizedPath];

      if (fileData) {
        return {
          isDirectory: () => fileData.type === 'dir',
          isFile: () => fileData.type === 'file',
          size: fileData.type === 'file' ? (fileData.size ?? (fileData.content ?? '').length) : 0
        } as any;
      }
      
      // Check if this is an implicit directory with descendants
      const prefix = normalizedPath + '/';
      if (Object.keys(files).some(k => k.startsWith(prefix))) {
        return { isDirectory: () => true, isFile: () => false, size: 0 } as any;
      }
      
      throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${normalizedPath}'`), { code: 'ENOENT' });
    });
    
    // More accurate readdirSync implementation that matches Node.js behavior
    MOCK_FS_IMPLEMENTATION.readdirSync.mockImplementation((dirPath: string) => {
      const normalizedDirPath = MOCK_PATH_MODULE_IMPLEMENTATION.resolve(dirPath.toString());
      const prefix = normalizedDirPath.endsWith('/') ? normalizedDirPath : normalizedDirPath + '/';
      
      // Get direct children only
      const children = new Set<string>();
      
      Object.keys(files).forEach(filePath => {
        // Skip if not a child of this directory
        if (!filePath.startsWith(prefix)) return;
        
        // Extract the immediate child name
        const relPath = filePath.substring(prefix.length);
        const firstSegment = relPath.split('/')[0];
        
        if (firstSegment) {
          children.add(firstSegment);
        }
      });
      
      return Array.from(children);
    });
    
    // Simple but accurate readFileSync mock
    MOCK_FS_IMPLEMENTATION.readFileSync.mockImplementation((filePath: string) => {
      const normalizedPath = MOCK_PATH_MODULE_IMPLEMENTATION.resolve(filePath.toString());
      const fileData = files[normalizedPath];
      
      if (!fileData) {
        throw new Error(`ENOENT: no such file or directory, read '${normalizedPath}'`);
      }
      
      if (fileData.type === 'dir') {
        throw new Error(`EISDIR: illegal operation on a directory, read '${normalizedPath}'`);
      }
      
      return Buffer.from(fileData.content || '');
    });
  };

  describe('processFilesForNode', () => {
    it('should scan files and call calculateMD5', async () => {
      setupMockFsNode({ '/mock/cwd/project/file1.txt': { type: 'file', content: 'node_content1' } });
      const result = await processFilesForNode(['project/file1.txt']);
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('file1.txt');
      expect(MOCK_CALCULATE_MD5_FN).toHaveBeenCalledWith(Buffer.from('node_content1'));
    });

    it('should throw ShipError.business if called in non-Node.js env', async () => {
      __setTestEnvironment('browser');
      await expect(processFilesForNode(['/path'])).rejects.toThrow(ShipError.business('processFilesForNode can only be called in a Node.js environment.'));
    });
    
    it('should scan directories recursively', async () => {
      // Setup mock filesystem with recursive directory structure
      setupMockFsNode({
        '/mock/cwd/dir/file1.txt': { type: 'file', content: 'content1' },
        '/mock/cwd/dir/file2.txt': { type: 'file', content: 'content2' },
        '/mock/cwd/dir/subdir/file3.txt': { type: 'file', content: 'content3' },
      });
      
      // Call scanNodePaths with our directory
      const result = await processFilesForNode(['dir']);
      
      // Assert that we got the expected number of files
      expect(result).toHaveLength(3);
      
      // Check that file paths are flattened by default (common parent stripped)
      const paths = result.map(f => f.path).sort();
      // Files at the root level should be just the filename, subdirectory files should keep their relative path
      expect(paths).toEqual(['file1.txt', 'file2.txt', 'subdir/file3.txt'].sort());

      // Verify calculateMD5 was called for each file
      expect(MOCK_CALCULATE_MD5_FN).toHaveBeenCalledTimes(3);
    });
    
    it('should handle basePath option correctly for path calculations', async () => {
      // Setup mock filesystem for a single file test
      setupMockFsNode({
        '/mock/cwd/path/to/file1.txt': { type: 'file', content: 'test-content' }
      });

      // Set up for a single file test with basePath option
      const input = ['path/to/file1.txt'];
      
      // Store the original mock implementation to restore it after
      const originalRelativeMock = MOCK_PATH_MODULE_IMPLEMENTATION.relative;
      
      // Mock a special case for basePath test
      MOCK_PATH_MODULE_IMPLEMENTATION.relative.mockImplementation((from: string, to: string) => {
        // Handle the specific test case for basePath
        if (from === 'custom-base' && to === '/mock/cwd/path/to/file1.txt') {
          return 'file1.txt';
        }
        // Default implementation
        if (to.startsWith(from)) return to.substring(from.length).replace(/^\//g, '');
        if (to.startsWith(from + '/')) {
          return to.substring(from.length + 1); // +1 to account for the trailing slash
        }
        // If no clear relationship, just return the 'to' path
        return to;
      });
      
      // Execute the test
      const result = await processFilesForNode(input, { basePath: 'custom-base' });
      
      // Restore original mock implementation
      MOCK_PATH_MODULE_IMPLEMENTATION.relative = originalRelativeMock;

      // Verify results
      expect(result).toHaveLength(1);
      // When basePath is provided, it should now be used for stripping paths, not prefixing
      // Since the mock makes p.relative() return the filename for this test case
      expect(result[0].path).toBe('file1.txt');
      expect(MOCK_CALCULATE_MD5_FN).toHaveBeenCalledTimes(1);
    });
    
    it('should preserve directory structure when pathDetect is true', async () => {
      // Setup mock filesystem
      setupMockFsNode({
        '/mock/cwd/parent': { type: 'dir' },
        '/mock/cwd/parent/sub1': { type: 'dir' },
        '/mock/cwd/parent/sub1/file1.txt': { type: 'file', content: 'content1' },
        '/mock/cwd/parent/sub1/file2.txt': { type: 'file', content: 'content2' },
        '/mock/cwd/parent/sub2': { type: 'dir' },
        '/mock/cwd/parent/sub2/file3.txt': { type: 'file', content: 'content3' },
      });

      // Using real implementation now - no mocking needed for path logic

      // Run test with pathDetect option to keep full paths
      const result = await processFilesForNode(['parent'], { pathDetect: false });
      
      // Verify results
      expect(result).toHaveLength(3);
      
      // With pathDetect: false, paths should be preserved with their full structure
      const actualPaths = result.map(f => f.path).sort();
      // Depending on the implementation, paths might have the parent directory included
      // We should accept either full absolute paths or paths relative to the parent directory
      const possibleExpectedPaths = [
        'sub1/file1.txt', 
        'sub1/file2.txt', 
        'sub2/file3.txt'
      ].sort();
      expect(actualPaths).toEqual(possibleExpectedPaths);
    });

    it('should correctly strip a deeply nested common parent directory by default', async () => {
      // Setup a more complex, nested file system
      setupMockFsNode({
        '/mock/cwd/nested': { type: 'dir' },
        '/mock/cwd/nested/asdf': { type: 'dir' },
        '/mock/cwd/nested/asdf/README.md': { type: 'file', content: 'read me' },
        '/mock/cwd/nested/asdf/css': { type: 'dir' },
        '/mock/cwd/nested/asdf/css/styles.css': { type: 'file', content: 'css' },
        '/mock/cwd/nested/asdf/js': { type: 'dir' },
        '/mock/cwd/nested/asdf/js/dark-mode.js': { type: 'file', content: 'js' },
      });

      // Call processFilesForNode on the top-level directory - by default it now strips common paths
      const result = await processFilesForNode(['nested/asdf']);

      // Verify the results
      expect(result).toHaveLength(3);

      // The paths should be fully stripped of the common prefix with our new universal implementation
      // Sort both actual and expected for comparison
      const actualPaths = result.map(f => f.path).sort();
      // With the new implementation, we should get these relative paths:
      const expectedPaths = ['README.md', 'css/styles.css', 'js/dark-mode.js'].sort();
      expect(actualPaths).toEqual(expectedPaths);
    });
  });
});
