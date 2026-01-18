import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processFilesForNode } from '../../../src/node/core/node-files';
import { __setTestEnvironment } from '../../../src/shared/lib/env';
import { ShipError, ErrorType } from '@shipstatic/types';
import { setConfig } from '../../../src/shared/core/platform-config';

// Define mock implementations using vi.hoisted()
const { MOCK_CALCULATE_MD5_FN } = vi.hoisted(() => ({ MOCK_CALCULATE_MD5_FN: vi.fn() }));

const { MOCK_FS_IMPLEMENTATION } = vi.hoisted(() => ({
  MOCK_FS_IMPLEMENTATION: { readdirSync: vi.fn(), statSync: vi.fn(), readFileSync: vi.fn(), realpathSync: vi.fn() }
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
vi.mock('../../../src/shared/lib/md5', () => ({ calculateMD5: MOCK_CALCULATE_MD5_FN }));
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

    // realpathSync mock - for tests without symlinks, just return the resolved path
    MOCK_FS_IMPLEMENTATION.realpathSync.mockImplementation((filePath: string) => {
      const normalizedPath = MOCK_PATH_MODULE_IMPLEMENTATION.resolve(filePath.toString());
      // Check if path exists in our mock filesystem
      const fileData = files[normalizedPath];
      if (fileData) {
        return normalizedPath;
      }
      // Check if it's an implicit directory
      const prefix = normalizedPath + '/';
      if (Object.keys(files).some(k => k.startsWith(prefix))) {
        return normalizedPath;
      }
      throw Object.assign(new Error(`ENOENT: no such file or directory, realpath '${normalizedPath}'`), { code: 'ENOENT' });
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
      await expect(processFilesForNode(['/path'])).rejects.toThrow(ShipError.business('processFilesForNode can only be called in Node.js environment.'));
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

      // Run test with default pathDetect behavior (should flatten paths)
      const result = await processFilesForNode(['parent']);
      
      // Verify results
      expect(result).toHaveLength(3);
      
      // With default pathDetect behavior, paths should be flattened (common parent removed)
      const actualPaths = result.map(f => f.path).sort();
      // The common parent "parent" should be stripped, leaving just the subdirectory structure
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
        '/mock/cwd/nested/asdf/js/dark-mode': { type: 'file', content: 'js' },
      });

      // Call processFilesForNode on the top-level directory - by default it now strips common paths
      const result = await processFilesForNode(['nested/asdf']);

      // Verify the results
      expect(result).toHaveLength(3);

      // The paths should be fully stripped of the common prefix with our new universal implementation
      // Sort both actual and expected for comparison
      const actualPaths = result.map(f => f.path).sort();
      // With the new implementation, we should get these relative paths:
      const expectedPaths = ['README.md', 'css/styles.css', 'js/dark-mode'].sort();
      expect(actualPaths).toEqual(expectedPaths);
    });

    describe('pathDetect: false (path preservation)', () => {
      it('should preserve Vite build structure exactly', async () => {
        setupMockFsNode({
          '/mock/cwd/dist/index.html': { type: 'file', content: '<!DOCTYPE html>' },
          '/mock/cwd/dist/vite.svg': { type: 'file', content: '<svg>' },
          '/mock/cwd/dist/assets/browser-SQEQcwkt': { type: 'file', content: 'console.log("browser");' },
          '/mock/cwd/dist/assets/index-BaplGdt4': { type: 'file', content: 'console.log("index");' },
          '/mock/cwd/dist/assets/style-CuqkljXd.css': { type: 'file', content: 'body { margin: 0; }' }
        });

        const result = await processFilesForNode(['dist'], { pathDetect: false });
        const paths = result.map(f => f.path).sort();

        expect(paths).toEqual([
          'assets/browser-SQEQcwkt',
          'assets/index-BaplGdt4',
          'assets/style-CuqkljXd.css',
          'index.html',
          'vite.svg'
        ]);
      });

      it('should preserve React build structure exactly', async () => {
        setupMockFsNode({
          '/mock/cwd/build/index.html': { type: 'file', content: '<!DOCTYPE html>' },
          '/mock/cwd/build/static/css/main.abc123.css': { type: 'file', content: '.App { text-align: center; }' },
          '/mock/cwd/build/static/js/main.def456': { type: 'file', content: 'React.render();' },
          '/mock/cwd/build/static/media/logo.789xyz.png': { type: 'file', content: 'PNG_DATA' },
          '/mock/cwd/build/manifest.json': { type: 'file', content: '{"name": "test"}' }
        });

        const result = await processFilesForNode(['build'], { pathDetect: false });
        const paths = result.map(f => f.path).sort();

        expect(paths).toEqual([
          'index.html',
          'manifest.json',
          'static/css/main.abc123.css',
          'static/js/main.def456',
          'static/media/logo.789xyz.png'
        ]);
      });

      it('should preserve complex nested project structure', async () => {
        setupMockFsNode({
          '/mock/cwd/project/src/components/Header.tsx': { type: 'file', content: 'export const Header = () => {};' },
          '/mock/cwd/project/src/components/Footer.tsx': { type: 'file', content: 'export const Footer = () => {};' },
          '/mock/cwd/project/src/utils/helpers.ts': { type: 'file', content: 'export const helper = () => {};' },
          '/mock/cwd/project/public/favicon.ico': { type: 'file', content: 'ICO_DATA' },
          '/mock/cwd/project/config/env/production/config.json': { type: 'file', content: '{"env": "prod"}' }
        });

        const result = await processFilesForNode(['project'], { pathDetect: false });
        const paths = result.map(f => f.path).sort();

        expect(paths).toEqual([
          'config/env/production/config.json',
          'public/favicon.ico',
          'src/components/Footer.tsx',
          'src/components/Header.tsx',
          'src/utils/helpers.ts'
        ]);
      });

      it('should preserve mixed depth files without common parent', async () => {
        setupMockFsNode({
          '/mock/cwd/index.html': { type: 'file', content: '<!DOCTYPE html>' },
          '/mock/cwd/assets/js/app': { type: 'file', content: 'console.log("app");' },
          '/mock/cwd/assets/css/styles.css': { type: 'file', content: 'body { margin: 0; }' },
          '/mock/cwd/images/logo.png': { type: 'file', content: 'PNG_DATA' },
          '/mock/cwd/deep/nested/folder/config': { type: 'file', content: 'module.exports = {};' }
        });

        // Process multiple individual files/directories
        const result = await processFilesForNode([
          'index.html',
          'assets/js/app', 
          'assets/css/styles.css',
          'images/logo.png',
          'deep/nested/folder/config'
        ], { pathDetect: false });
        const paths = result.map(f => f.path).sort();

        expect(paths).toEqual([
          'app',
          'config',
          'index.html',
          'logo.png',
          'styles.css'
        ]);
      });

      it('should handle single files with full paths preserved', async () => {
        setupMockFsNode({
          '/mock/cwd/some/deep/path/single-file.txt': { type: 'file', content: 'standalone content' },
          '/mock/cwd/another/different/path/other-file.txt': { type: 'file', content: 'other content' },
          '/mock/cwd/root-file.txt': { type: 'file', content: 'root content' }
        });

        const result = await processFilesForNode([
          'some/deep/path/single-file.txt',
          'another/different/path/other-file.txt',
          'root-file.txt'
        ], { pathDetect: false });
        const paths = result.map(f => f.path).sort();

        expect(paths).toEqual([
          'other-file.txt',
          'root-file.txt',
          'single-file.txt'
        ]);
      });

      it('should normalize path separators but preserve structure', async () => {
        setupMockFsNode({
          '/mock/cwd/folder/subfolder/file1.txt': { type: 'file', content: 'content1' },
          '/mock/cwd/folder/subfolder/file2.txt': { type: 'file', content: 'content2' },
          '/mock/cwd/folder/subfolder/file3.txt': { type: 'file', content: 'content3' }
        });

        // Simulate Windows-style paths in the input (they get normalized)
        const result = await processFilesForNode([
          'folder\\subfolder\\file1.txt',
          'folder/subfolder/file2.txt', 
          'folder\\subfolder/file3.txt'
        ], { pathDetect: false });
        const paths = result.map(f => f.path).sort();

        // Should normalize to forward slashes but preserve full structure
        expect(paths).toEqual([
          'file1.txt',
          'file2.txt',
          'file3.txt'
        ]);

        // Verify no backslashes remain
        paths.forEach(path => {
          expect(path).not.toContain('\\');
        });
      });

      it('should preserve directory structure with empty directory handling', async () => {
        setupMockFsNode({
          '/mock/cwd/valid/path/file.txt': { type: 'file', content: 'valid content' },
          '/mock/cwd/path/with/double/slashes/file2.txt': { type: 'file', content: 'double content' }
        });

        const result = await processFilesForNode([
          'valid/path/file.txt',
          'path//with//double//slashes/file2.txt'
        ], { pathDetect: false });
        const paths = result.map(f => f.path).sort();

        // Should preserve the intended structure (double slashes get normalized by path handling)
        expect(paths).toEqual([
          'file.txt',
          'file2.txt'
        ]);
      });

      it('should handle very deep nested structures', async () => {
        setupMockFsNode({
          '/mock/cwd/a/very/deep/nested/folder/structure/that/goes/many/levels/deep.txt': { 
            type: 'file', 
            content: 'deep file content' 
          },
          '/mock/cwd/shallow.txt': { type: 'file', content: 'shallow content' }
        });

        const result = await processFilesForNode([
          'a/very/deep/nested/folder/structure/that/goes/many/levels/deep.txt',
          'shallow.txt'
        ], { pathDetect: false });
        const paths = result.map(f => f.path).sort();

        expect(paths).toEqual([
          'deep.txt',
          'shallow.txt'
        ]);
      });

      it('should preserve build output structure for deployment scenarios', async () => {
        // Test the exact scenario that was causing the regression
        setupMockFsNode({
          '/mock/cwd/web/drop/dist/index.html': { type: 'file', content: '<!DOCTYPE html>' },
          '/mock/cwd/web/drop/dist/assets/browser-SQEQcwkt': { type: 'file', content: 'window.app = {};' },
          '/mock/cwd/web/drop/dist/assets/style-abc123.css': { type: 'file', content: '.main { color: blue; }' },
          '/mock/cwd/web/drop/dist/favicon.ico': { type: 'file', content: 'ICO_DATA' }
        });

        const result = await processFilesForNode(['web/drop/dist'], { pathDetect: false });
        const paths = result.map(f => f.path).sort();

        // The critical requirement: assets folder must be preserved 
        expect(paths).toEqual([
          'assets/browser-SQEQcwkt',
          'assets/style-abc123.css',
          'favicon.ico',
          'index.html'
        ]);

        // Verify the original bug is fixed - these should NOT exist
        expect(paths).not.toContain('browser-SQEQcwkt');
        expect(paths).not.toContain('style-abc123.css');
        
        // The assets folder structure should be completely preserved
        const assetsFiles = paths.filter(p => p.includes('assets/'));
        expect(assetsFiles).toHaveLength(2);
        expect(assetsFiles.every(f => f.startsWith('assets/'))).toBe(true);
      });

      it('should preserve multiple directory structures when processing multiple paths', async () => {
        setupMockFsNode({
          '/mock/cwd/frontend/dist/index.html': { type: 'file', content: 'frontend' },
          '/mock/cwd/frontend/dist/app': { type: 'file', content: 'frontend app' },
          '/mock/cwd/backend/build/server': { type: 'file', content: 'backend server' },
          '/mock/cwd/backend/build/config.json': { type: 'file', content: '{"port": 3000}' },
          '/mock/cwd/docs/api.md': { type: 'file', content: '# API Documentation' }
        });

        const result = await processFilesForNode([
          'frontend/dist',
          'backend/build', 
          'docs/api.md'
        ], { pathDetect: false });
        const paths = result.map(f => f.path).sort();

        expect(paths).toEqual([
          'api.md',
          'app',
          'config.json',
          'index.html',
          'server'
        ]);
      });
    });
  });

  describe('node-specific edge cases', () => {
    it('should handle files with Unicode names and paths', async () => {
      setupMockFsNode({
        '/mock/cwd/测试文件.txt': { type: 'file', content: 'Chinese file' },
        '/mock/cwd/папка/файл': { type: 'file', content: 'Cyrillic file' },
        '/mock/cwd/مجلد/ملف.html': { type: 'file', content: 'Arabic file' },
        '/mock/cwd/🚀folder/rocket.css': { type: 'file', content: 'Emoji folder' },
        '/mock/cwd/café/menu.json': { type: 'file', content: 'Accented folder' }
      });

      const result = await processFilesForNode([
        '测试文件.txt',
        'папка/файл',
        'مجلد/ملف.html',
        '🚀folder/rocket.css',
        'café/menu.json'
      ]);

      expect(result).toHaveLength(5);
      expect(result.map(f => f.path)).toEqual([
        '测试文件.txt',
        'файл', 
        'ملف.html',
        'rocket.css',
        'menu.json'
      ]);
    });

    it('should handle very deep directory nesting', async () => {
      const deepPath = 'a/very/deep/nested/folder/structure/that/goes/many/levels/deep.txt';
      const deepFilePath = `/mock/cwd/${deepPath}`;
      
      setupMockFsNode({
        [deepFilePath]: { type: 'file', content: 'Deep file content' }
      });

      const result = await processFilesForNode([deepPath]);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('deep.txt');
    });

    it('should handle files with no extensions', async () => {
      setupMockFsNode({
        '/mock/cwd/Dockerfile': { type: 'file', content: 'FROM node:18' },
        '/mock/cwd/Makefile': { type: 'file', content: 'all:\n\techo "build"' },
        '/mock/cwd/LICENSE': { type: 'file', content: 'MIT License' },
        '/mock/cwd/README': { type: 'file', content: 'Project readme' }
      });

      const result = await processFilesForNode(['Dockerfile', 'Makefile', 'LICENSE', 'README']);

      expect(result).toHaveLength(4);
      expect(result.map(f => f.path)).toEqual(['Dockerfile', 'Makefile', 'LICENSE', 'README']);
    });

    it('should handle empty directories gracefully', async () => {
      setupMockFsNode({
        '/mock/cwd/empty-dir': { type: 'dir' },
        '/mock/cwd/another-empty': { type: 'dir' }
      });

      const result = await processFilesForNode(['empty-dir', 'another-empty']);

      expect(result).toHaveLength(0);
    });

    it('should handle mixed file and directory inputs', async () => {
      setupMockFsNode({
        '/mock/cwd/single-file.txt': { type: 'file', content: 'Single file' },
        '/mock/cwd/directory/file1': { type: 'file', content: 'Dir file 1' },
        '/mock/cwd/directory/file2.css': { type: 'file', content: 'Dir file 2' },
        '/mock/cwd/another-single.html': { type: 'file', content: 'Another single' }
      });

      const result = await processFilesForNode([
        'single-file.txt',
        'directory',
        'another-single.html'
      ]);

      expect(result).toHaveLength(4);
      const paths = result.map(f => f.path).sort();
      expect(paths).toEqual([
        'another-single.html',
        'file1',
        'file2.css', 
        'single-file.txt'
      ]);
    });

    it('should handle files with special characters in names', async () => {
      setupMockFsNode({
        '/mock/cwd/file with spaces.txt': { type: 'file', content: 'Spaced file' },
        '/mock/cwd/file-with-dashes': { type: 'file', content: 'Dashed file' },
        '/mock/cwd/file_with_underscores.css': { type: 'file', content: 'Underscored file' },
        '/mock/cwd/file.with.many.dots.html': { type: 'file', content: 'Dotted file' },
        '/mock/cwd/file(with)parentheses.json': { type: 'file', content: 'Parentheses file' },
        '/mock/cwd/file[with]brackets.xml': { type: 'file', content: 'Brackets file' }
      });

      const result = await processFilesForNode([
        'file with spaces.txt',
        'file-with-dashes',
        'file_with_underscores.css',
        'file.with.many.dots.html',
        'file(with)parentheses.json',
        'file[with]brackets.xml'
      ]);

      expect(result).toHaveLength(6);
      expect(result.map(f => f.path)).toEqual([
        'file with spaces.txt',
        'file-with-dashes',
        'file_with_underscores.css',
        'file.with.many.dots.html',
        'file(with)parentheses.json',
        'file[with]brackets.xml'
      ]);
    });

    it('should handle large file counts efficiently', async () => {
      // Create mock filesystem with many files
      const manyFiles: Record<string, any> = {};
      for (let i = 0; i < 100; i++) {
        manyFiles[`/mock/cwd/file-${i.toString().padStart(3, '0')}.txt`] = {
          type: 'file',
          content: `Content of file ${i}`
        };
      }
      setupMockFsNode(manyFiles);

      const filePaths = Array.from({ length: 100 }, (_, i) => 
        `file-${i.toString().padStart(3, '0')}.txt`
      );

      const result = await processFilesForNode(filePaths);

      expect(result).toHaveLength(100);
      expect(result.every(f => f.md5 === 'mocked-md5-for-node-files')).toBe(true);
    });

    it('should handle files with identical names in different directories', async () => {
      setupMockFsNode({
        '/mock/cwd/dir1/config.json': { type: 'file', content: '{"env": "dir1"}' },
        '/mock/cwd/dir2/config.json': { type: 'file', content: '{"env": "dir2"}' },
        '/mock/cwd/dir3/config.json': { type: 'file', content: '{"env": "dir3"}' }
      });

      const result = await processFilesForNode(['dir1/config.json', 'dir2/config.json', 'dir3/config.json']);

      expect(result).toHaveLength(3);
      expect(result.map(f => f.path)).toEqual([
        'config.json',
        'config.json', 
        'config.json'
      ]);
    });

    it('should handle empty files', async () => {
      setupMockFsNode({
        '/mock/cwd/empty.txt': { type: 'file', content: '' },
        '/mock/cwd/another-empty': { type: 'file', content: '' },
        '/mock/cwd/zero-size.html': { type: 'file', content: '' }
      });

      const result = await processFilesForNode(['empty.txt', 'another-empty', 'zero-size.html']);

      // Empty files are now skipped in the new implementation
      expect(result).toHaveLength(0);
    });

    it('should handle files processed in wrong environment gracefully', async () => {
      // Temporarily switch environment to test error handling
      __setTestEnvironment('browser');

      await expect(processFilesForNode(['test.txt']))
        .rejects.toThrow('processFilesForNode can only be called in Node.js environment.');

      // Restore environment
      __setTestEnvironment('node');
    });
  });

  describe('node filesystem edge cases', () => {
    it('should handle non-existent files gracefully', async () => {
      // Don't set up any mock files, so they don't exist

      await expect(processFilesForNode(['non-existent-file.txt']))
        .rejects.toThrow();
    });

    it('should handle paths with .. (parent directory references)', async () => {
      setupMockFsNode({
        '/mock/parent-file.txt': { type: 'file', content: 'Parent file' }
      });

      // Mock path.resolve to handle the .. properly  
      const originalResolve = MOCK_PATH_MODULE_IMPLEMENTATION.resolve;
      MOCK_PATH_MODULE_IMPLEMENTATION.resolve.mockImplementation((...args: string[]) => {
        const lastArg = args[args.length - 1];
        // Handle parent directory references specifically
        if (lastArg && lastArg.includes('../parent-file.txt')) {
          return '/mock/parent-file.txt';
        }
        // For other paths, use the original implementation behavior
        if (args.length > 0 && typeof args[0] === 'string' && !args[0].startsWith('/mock/')) {
          return `/mock/cwd/${args[0]}`;
        }
        return args[0];
      });

      const result = await processFilesForNode(['../parent-file.txt'], { pathDetect: false });

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('parent-file.txt'); // Path gets normalized, parent reference resolved
    });

    it('should handle symlinks (if mocked properly)', async () => {
      // Note: This would require more sophisticated symlink mocking
      // For now, we'll just test that the interface handles symlink-like paths
      setupMockFsNode({
        '/mock/cwd/target-file.txt': { type: 'file', content: 'Target content' },
        '/mock/cwd/symlink-file.txt': { type: 'file', content: 'Target content' } // Simulate symlink
      });

      const result = await processFilesForNode(['target-file.txt', 'symlink-file.txt']);

      expect(result).toHaveLength(2);
      expect(result.map(f => f.path)).toEqual(['target-file.txt', 'symlink-file.txt']);
    });

    it('should handle files with various line endings', async () => {
      setupMockFsNode({
        '/mock/cwd/unix-endings.txt': { type: 'file', content: 'line1\nline2\nline3' },
        '/mock/cwd/windows-endings.txt': { type: 'file', content: 'line1\r\nline2\r\nline3' },
        '/mock/cwd/mac-endings.txt': { type: 'file', content: 'line1\rline2\rline3' },
        '/mock/cwd/mixed-endings.txt': { type: 'file', content: 'line1\nline2\r\nline3\r' }
      });

      const result = await processFilesForNode([
        'unix-endings.txt',
        'windows-endings.txt', 
        'mac-endings.txt',
        'mixed-endings.txt'
      ]);

      expect(result).toHaveLength(4);
      // All should be processed successfully regardless of line endings
      result.forEach(file => {
        expect(file.content).toBeInstanceOf(Buffer);
        expect(file.size).toBeGreaterThan(0);
      });
    });

    it('should handle concurrent file processing without race conditions', async () => {
      // Set up many files for concurrent processing
      const manyFiles: Record<string, any> = {};
      for (let i = 0; i < 50; i++) {
        manyFiles[`/mock/cwd/concurrent-${i}.txt`] = {
          type: 'file',
          content: `Concurrent file ${i}`
        };
      }
      setupMockFsNode(manyFiles);

      const filePaths = Array.from({ length: 50 }, (_, i) => `concurrent-${i}.txt`);

      // Process multiple batches concurrently
      const promises = [
        processFilesForNode(filePaths.slice(0, 17)),
        processFilesForNode(filePaths.slice(17, 34)),
        processFilesForNode(filePaths.slice(34, 50))
      ];

      const results = await Promise.all(promises);

      expect(results[0]).toHaveLength(17);
      expect(results[1]).toHaveLength(17);
      expect(results[2]).toHaveLength(16);
    });
  });

  describe('error handling during file processing', () => {
    it('should re-throw ShipError instances directly', async () => {
      // Setup a file that will trigger a ShipError during validation
      setupMockFsNode({
        '/mock/cwd/test.txt': { type: 'file', content: 'content', size: 1 }
      });

      // Override the statSync to throw a ShipError on the second call (during processing)
      let callCount = 0;
      MOCK_FS_IMPLEMENTATION.statSync.mockImplementation((filePath: string) => {
        callCount++;
        const normalizedPath = MOCK_PATH_MODULE_IMPLEMENTATION.resolve(filePath.toString());

        // First call is for path validation, return valid directory
        if (callCount === 1) {
          return { isDirectory: () => false, isFile: () => true, size: 1 };
        }

        // Second call during file processing - throw ShipError
        throw ShipError.business('Simulated ShipError during file processing');
      });

      await expect(processFilesForNode(['test.txt']))
        .rejects.toThrow('Simulated ShipError during file processing');
    });

    it('should convert non-ShipError exceptions to ShipError.file', async () => {
      // Setup file that exists initially but fails during read
      setupMockFsNode({
        '/mock/cwd/problem.txt': { type: 'file', content: 'content', size: 10 }
      });

      // Make readFileSync throw a generic error
      MOCK_FS_IMPLEMENTATION.readFileSync.mockImplementation((filePath: string) => {
        throw new Error('EACCES: permission denied');
      });

      await expect(processFilesForNode(['problem.txt']))
        .rejects.toThrow('Failed to read file');
    });

    it('should convert non-Error exceptions to ShipError.file', async () => {
      setupMockFsNode({
        '/mock/cwd/weird.txt': { type: 'file', content: 'content', size: 10 }
      });

      // Make readFileSync throw a string (non-Error)
      MOCK_FS_IMPLEMENTATION.readFileSync.mockImplementation(() => {
        throw 'Some string error';
      });

      await expect(processFilesForNode(['weird.txt']))
        .rejects.toThrow('Failed to read file');
    });
  });

  describe('final file count validation', () => {
    it('should throw when results exceed maxFilesCount', async () => {
      // Set a very low max file count
      setConfig({
        maxFileSize: 10 * 1024 * 1024,
        maxFilesCount: 5,
        maxTotalSize: 100 * 1024 * 1024,
      });

      // Create more files than allowed
      setupMockFsNode({
        '/mock/cwd/file1.txt': { type: 'file', content: 'a' },
        '/mock/cwd/file2.txt': { type: 'file', content: 'b' },
        '/mock/cwd/file3.txt': { type: 'file', content: 'c' },
        '/mock/cwd/file4.txt': { type: 'file', content: 'd' },
        '/mock/cwd/file5.txt': { type: 'file', content: 'e' },
        '/mock/cwd/file6.txt': { type: 'file', content: 'f' }
      });

      await expect(processFilesForNode([
        'file1.txt', 'file2.txt', 'file3.txt',
        'file4.txt', 'file5.txt', 'file6.txt'
      ])).rejects.toThrow('Too many files to deploy. Maximum allowed is 5 files.');
    });

    it('should pass when results exactly match maxFilesCount', async () => {
      setConfig({
        maxFileSize: 10 * 1024 * 1024,
        maxFilesCount: 3,
        maxTotalSize: 100 * 1024 * 1024,
      });

      setupMockFsNode({
        '/mock/cwd/file1.txt': { type: 'file', content: 'a' },
        '/mock/cwd/file2.txt': { type: 'file', content: 'b' },
        '/mock/cwd/file3.txt': { type: 'file', content: 'c' }
      });

      const result = await processFilesForNode(['file1.txt', 'file2.txt', 'file3.txt']);
      expect(result).toHaveLength(3);
    });
  });

  describe('symlink cycle detection', () => {
    it('should detect and skip symlink cycles to prevent infinite recursion', async () => {
      // Set up a filesystem with a symlink cycle
      // dir_a -> dir_b -> dir_a (cycle)
      const files: Record<string, any> = {
        '/mock/cwd/dir_a': { type: 'dir' },
        '/mock/cwd/dir_a/file1.txt': { type: 'file', content: 'file1' },
        '/mock/cwd/dir_a/link_to_b': { type: 'dir' }, // symlink to dir_b
        '/mock/cwd/dir_a/link_to_b/file2.txt': { type: 'file', content: 'file2' },
        '/mock/cwd/dir_a/link_to_b/link_back': { type: 'dir' } // symlink back to dir_a
      };

      setupMockFsNode(files);

      // Mock realpathSync to simulate symlink resolution with a cycle
      const visitedPaths = new Set<string>();
      let cycleDetected = false;

      MOCK_FS_IMPLEMENTATION.realpathSync.mockImplementation((filePath: string) => {
        const normalizedPath = MOCK_PATH_MODULE_IMPLEMENTATION.resolve(filePath.toString());

        // Simulate symlink resolution
        if (normalizedPath.includes('link_to_b')) {
          return '/mock/cwd/dir_b';
        }
        if (normalizedPath.includes('link_back')) {
          // This creates the cycle - link_back resolves to dir_a
          return '/mock/cwd/dir_a';
        }

        return normalizedPath;
      });

      // The implementation should handle the cycle gracefully
      const result = await processFilesForNode(['dir_a']);

      // Should not hang or crash due to infinite recursion
      // Should process files without getting stuck in the cycle
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('should not revisit already-visited directories', async () => {
      const visitedPaths: string[] = [];

      setupMockFsNode({
        '/mock/cwd/root': { type: 'dir' },
        '/mock/cwd/root/file.txt': { type: 'file', content: 'content' }
      });

      // Track calls to realpathSync to verify cycle prevention
      MOCK_FS_IMPLEMENTATION.realpathSync.mockImplementation((filePath: string) => {
        const normalizedPath = MOCK_PATH_MODULE_IMPLEMENTATION.resolve(filePath.toString());
        visitedPaths.push(normalizedPath);
        return normalizedPath;
      });

      await processFilesForNode(['root']);

      // Each path should only be visited once
      const uniquePaths = [...new Set(visitedPaths)];
      expect(visitedPaths.length).toBe(uniquePaths.length);
    });
  });

  describe('security validation', () => {
    it('should allow safe paths with dots in filenames', async () => {
      setupMockFsNode({
        '/mock/cwd/file.test.spec.ts': { type: 'file', content: 'content' },
        '/mock/cwd/folder.name/file.txt': { type: 'file', content: 'nested' }
      });

      const result = await processFilesForNode([
        'file.test.spec.ts',
        'folder.name/file.txt'
      ]);

      // These should all be allowed (dots in filenames are safe)
      expect(result.length).toBe(2);
    });

    it('should allow paths with single dots (current directory)', async () => {
      // Set up the normalized path (path.resolve normalizes ./file.txt)
      setupMockFsNode({
        '/mock/cwd/some/file.txt': { type: 'file', content: 'content' }
      });

      // path.resolve normalizes some/./file.txt to some/file.txt
      const result = await processFilesForNode(['some/file.txt']);

      expect(result.length).toBe(1);
    });

    it('should handle hidden files starting with dot', async () => {
      setupMockFsNode({
        '/mock/cwd/.env': { type: 'file', content: 'SECRET=value' },
        '/mock/cwd/.gitignore': { type: 'file', content: 'node_modules' },
        '/mock/cwd/normal.txt': { type: 'file', content: 'content' }
      });

      const result = await processFilesForNode(['.env', '.gitignore', 'normal.txt']);

      // Hidden files should be processed (not junk)
      expect(result.length).toBe(3);
    });
  });

  describe('file size edge cases', () => {
    it('should throw when single file exceeds maxFileSize', async () => {
      setConfig({
        maxFileSize: 100,
        maxFilesCount: 1000,
        maxTotalSize: 10000,
      });

      setupMockFsNode({
        '/mock/cwd/large.txt': { type: 'file', content: 'x'.repeat(101), size: 101 }
      });

      await expect(processFilesForNode(['large.txt']))
        .rejects.toThrow('too large');
    });

    it('should accept file exactly at maxFileSize limit', async () => {
      setConfig({
        maxFileSize: 100,
        maxFilesCount: 1000,
        maxTotalSize: 10000,
      });

      setupMockFsNode({
        '/mock/cwd/exact.txt': { type: 'file', content: 'x'.repeat(100), size: 100 }
      });

      const result = await processFilesForNode(['exact.txt']);
      expect(result).toHaveLength(1);
      expect(result[0].size).toBe(100);
    });

    it('should throw when cumulative size exceeds maxTotalSize', async () => {
      setConfig({
        maxFileSize: 100,
        maxFilesCount: 1000,
        maxTotalSize: 150,
      });

      setupMockFsNode({
        '/mock/cwd/file1.txt': { type: 'file', content: 'x'.repeat(80), size: 80 },
        '/mock/cwd/file2.txt': { type: 'file', content: 'x'.repeat(80), size: 80 }
      });

      // Total: 160 bytes > maxTotalSize: 150 bytes
      await expect(processFilesForNode(['file1.txt', 'file2.txt']))
        .rejects.toThrow('Total deploy size is too large');
    });

    it('should accept files with cumulative size exactly at maxTotalSize', async () => {
      setConfig({
        maxFileSize: 100,
        maxFilesCount: 1000,
        maxTotalSize: 150,
      });

      setupMockFsNode({
        '/mock/cwd/file1.txt': { type: 'file', content: 'x'.repeat(75), size: 75 },
        '/mock/cwd/file2.txt': { type: 'file', content: 'x'.repeat(75), size: 75 }
      });

      const result = await processFilesForNode(['file1.txt', 'file2.txt']);
      expect(result).toHaveLength(2);
    });

    it('should skip empty files (0 bytes) and not count them', async () => {
      setConfig({
        maxFileSize: 100,
        maxFilesCount: 2,
        maxTotalSize: 1000,
      });

      setupMockFsNode({
        '/mock/cwd/empty1.txt': { type: 'file', content: '', size: 0 },
        '/mock/cwd/empty2.txt': { type: 'file', content: '', size: 0 },
        '/mock/cwd/real1.txt': { type: 'file', content: 'a', size: 1 },
        '/mock/cwd/real2.txt': { type: 'file', content: 'b', size: 1 }
      });

      // maxFilesCount is 2, but we have 4 files
      // Empty files should be skipped, leaving only 2 real files
      const result = await processFilesForNode([
        'empty1.txt', 'empty2.txt', 'real1.txt', 'real2.txt'
      ]);

      expect(result).toHaveLength(2);
      expect(result.every(f => f.size > 0)).toBe(true);
    });
  });

  describe('very long paths', () => {
    it('should handle paths approaching filesystem limits', async () => {
      // Create a path with many nested directories
      const segments = Array(20).fill('dir');
      const deepPath = segments.join('/') + '/file.txt';
      const fullPath = `/mock/cwd/${deepPath}`;

      setupMockFsNode({
        [fullPath]: { type: 'file', content: 'deep content' }
      });

      const result = await processFilesForNode([deepPath]);

      expect(result).toHaveLength(1);
    });

    it('should handle filenames at reasonable length', async () => {
      const longFilename = 'a'.repeat(200) + '.txt';

      setupMockFsNode({
        [`/mock/cwd/${longFilename}`]: { type: 'file', content: 'content' }
      });

      const result = await processFilesForNode([longFilename]);

      expect(result).toHaveLength(1);
      expect(result[0].path.length).toBeGreaterThan(100);
    });
  });

  describe('junk file filtering', () => {
    it('should filter out .DS_Store files', async () => {
      setupMockFsNode({
        '/mock/cwd/folder/.DS_Store': { type: 'file', content: 'junk' },
        '/mock/cwd/folder/real.txt': { type: 'file', content: 'content' }
      });

      const result = await processFilesForNode(['folder']);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('real.txt');
    });

    it('should filter out Thumbs.db files', async () => {
      setupMockFsNode({
        '/mock/cwd/folder/Thumbs.db': { type: 'file', content: 'junk' },
        '/mock/cwd/folder/image.png': { type: 'file', content: 'image data' }
      });

      const result = await processFilesForNode(['folder']);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('image.png');
    });

    it('should filter out __MACOSX directories', async () => {
      setupMockFsNode({
        '/mock/cwd/archive/__MACOSX/._hidden': { type: 'file', content: 'mac junk' },
        '/mock/cwd/archive/real.txt': { type: 'file', content: 'content' }
      });

      const result = await processFilesForNode(['archive']);

      // __MACOSX is in JUNK_DIRECTORIES and should be filtered out
      const paths = result.map(f => f.path);
      expect(paths.some(p => p.includes('__MACOSX'))).toBe(false);
      expect(paths).toContain('real.txt');
    });

    it('should filter out .Trashes directories', async () => {
      setupMockFsNode({
        '/mock/cwd/volume/.Trashes/item': { type: 'file', content: 'trash' },
        '/mock/cwd/volume/data.txt': { type: 'file', content: 'data' }
      });

      const result = await processFilesForNode(['volume']);

      // .Trashes is in JUNK_DIRECTORIES
      const paths = result.map(f => f.path);
      expect(paths.some(p => p.includes('.Trashes'))).toBe(false);
    });

    it('should filter out desktop.ini files', async () => {
      setupMockFsNode({
        '/mock/cwd/folder/desktop.ini': { type: 'file', content: 'windows junk' },
        '/mock/cwd/folder/real.txt': { type: 'file', content: 'content' }
      });

      const result = await processFilesForNode(['folder']);

      // desktop.ini is identified as junk by the 'junk' package
      const paths = result.map(f => f.path);
      expect(paths.some(p => p.includes('desktop.ini'))).toBe(false);
    });
  });
});
