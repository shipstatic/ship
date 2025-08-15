import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processFilesForBrowser } from '@/lib/browser-files';
import { __setTestEnvironment } from '@/lib/env';
import { ShipError, ShipErrorType } from '@shipstatic/types';

// Define mock implementations using vi.hoisted()
const { MOCK_CALCULATE_MD5_FN } = vi.hoisted(() => ({ MOCK_CALCULATE_MD5_FN: vi.fn() }));

// Mock modules
vi.mock('@/lib/md5', () => ({ calculateMD5: MOCK_CALCULATE_MD5_FN }));

// Helper to create a mock File with webkitRelativePath
function mockFile(name: string, webkitRelativePath?: string): File {
  const file = new File(['content'], name, { type: 'text/plain' });
  if (webkitRelativePath) {
    Object.defineProperty(file, 'webkitRelativePath', {
      value: webkitRelativePath,
      writable: false,
      configurable: true,
      enumerable: true
    });
  }
  return file;
}

// Helper to create a mock FileList from an array of Files
function mockFileList(files: File[]): FileList {
  // FileList is not constructible, so we fake it as closely as possible
  // Create an object for our mock FileList that doesn't include the array's own properties
  const fileList = {
    length: files.length,
    item: (i: number) => files[i] || null,
    [Symbol.iterator]: function* () {
      for (let i = 0; i < files.length; i++) {
        yield files[i];
      }
    }
  };
  
  // Add numeric indices manually
  files.forEach((file, index) => {
    Object.defineProperty(fileList, index, {
      value: file,
      enumerable: true
    });
  });
  return fileList;
}

describe('Browser File Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setTestEnvironment('browser');
    MOCK_CALCULATE_MD5_FN.mockResolvedValue({ md5: 'mocked-md5-for-file-utils' });
  });

  afterEach(() => {
    __setTestEnvironment(null);
  });

  describe('processFilesForBrowser', () => {
    it('should process FileList and call calculateMD5', async () => {
      const files = [ mockFile('img.png', 'folder/img.png') ];
      const fileList = mockFileList(files);
      const result = await processFilesForBrowser(fileList);
      expect(result[0].path).toBe('img.png'); // Now flattened by default
      expect(MOCK_CALCULATE_MD5_FN).toHaveBeenCalledWith(files[0]);
    });

    it('should process File[]', async () => {
      const files = [
        mockFile('file1.txt', 'path/to/file1.txt'),
        mockFile('file2.txt', 'path/to/file2.txt')
      ];
      const result = await processFilesForBrowser(files);
      expect(result).toHaveLength(2);
      expect(result[0].path).toBe('file1.txt'); // Now flattened by default
      expect(result[1].path).toBe('file2.txt'); // Now flattened by default
    });

    it('should throw ShipClientError if called in non-browser env', async () => {
      __setTestEnvironment('node');
      await expect(processFilesForBrowser(mockFileList([]))).rejects.toThrow(
        ShipError.business('processFilesForBrowser can only be called in a browser environment.')
      );
    });
    
    it('should preserve exact paths when pathDetect is false', async () => {
      __setTestEnvironment('browser');
      const mockFiles = [
        mockFile('orig/path/file1.txt', 'orig/path/file1.txt'),
        mockFile('orig/path/dir/file2.txt', 'orig/path/dir/file2.txt')
      ];
      
      const result = await processFilesForBrowser(mockFiles, { pathDetect: false });
      
      // When pathDetect is false, exact directory structure is preserved
      expect(result[0].path).toBe('orig/path/file1.txt');
      expect(result[1].path).toBe('orig/path/dir/file2.txt');
    });

    describe('pathDetect: false (path preservation)', () => {
      it('should preserve Vite build structure exactly', async () => {
        const files = [
          mockFile('index.html', 'dist/index.html'),
          mockFile('vite.svg', 'dist/vite.svg'),
          mockFile('browser-SQEQcwkt.js', 'dist/assets/browser-SQEQcwkt.js'),
          mockFile('index-BaplGdt4.js', 'dist/assets/index-BaplGdt4.js'),
          mockFile('style-CuqkljXd.css', 'dist/assets/style-CuqkljXd.css')
        ];

        const result = await processFilesForBrowser(files, { pathDetect: false });
        const paths = result.map(f => f.path);

        expect(paths).toEqual([
          'dist/index.html',
          'dist/vite.svg',
          'dist/assets/browser-SQEQcwkt.js',
          'dist/assets/index-BaplGdt4.js',
          'dist/assets/style-CuqkljXd.css'
        ]);
      });

      it('should preserve React build structure exactly', async () => {
        const files = [
          mockFile('index.html', 'build/index.html'),
          mockFile('main.abc123.css', 'build/static/css/main.abc123.css'),
          mockFile('main.def456.js', 'build/static/js/main.def456.js'),
          mockFile('logo.789xyz.png', 'build/static/media/logo.789xyz.png'),
          mockFile('manifest.json', 'build/manifest.json')
        ];

        const result = await processFilesForBrowser(files, { pathDetect: false });
        const paths = result.map(f => f.path);

        expect(paths).toEqual([
          'build/index.html',
          'build/static/css/main.abc123.css',
          'build/static/js/main.def456.js',
          'build/static/media/logo.789xyz.png',
          'build/manifest.json'
        ]);
      });

      it('should preserve complex nested structure', async () => {
        const files = [
          mockFile('Header.tsx', 'project/src/components/Header.tsx'),
          mockFile('Footer.tsx', 'project/src/components/Footer.tsx'),
          mockFile('helpers.ts', 'project/src/utils/helpers.ts'),
          mockFile('favicon.ico', 'project/public/favicon.ico'),
          mockFile('config.json', 'project/config/env/production/config.json')
        ];

        const result = await processFilesForBrowser(files, { pathDetect: false });
        const paths = result.map(f => f.path);

        expect(paths).toEqual([
          'project/src/components/Header.tsx',
          'project/src/components/Footer.tsx', 
          'project/src/utils/helpers.ts',
          'project/public/favicon.ico',
          'project/config/env/production/config.json'
        ]);
      });

      it('should preserve mixed depth files without common parent', async () => {
        const files = [
          mockFile('index.html', 'index.html'),
          mockFile('app.js', 'assets/js/app.js'),
          mockFile('styles.css', 'assets/css/styles.css'),
          mockFile('logo.png', 'images/logo.png'),
          mockFile('config.js', 'deep/nested/folder/config.js')
        ];

        const result = await processFilesForBrowser(files, { pathDetect: false });
        const paths = result.map(f => f.path);

        expect(paths).toEqual([
          'index.html',
          'assets/js/app.js',
          'assets/css/styles.css',
          'images/logo.png',
          'deep/nested/folder/config.js'
        ]);
      });

      it('should handle files with no webkitRelativePath', async () => {
        const files = [
          mockFile('standalone1.txt'), // No webkitRelativePath
          mockFile('standalone2.txt'), // No webkitRelativePath
          mockFile('nested.txt', 'folder/nested.txt') // Has webkitRelativePath
        ];

        const result = await processFilesForBrowser(files, { pathDetect: false });
        const paths = result.map(f => f.path);

        expect(paths).toEqual([
          'standalone1.txt',
          'standalone2.txt', 
          'folder/nested.txt'
        ]);
      });

      it('should normalize path separators but preserve structure', async () => {
        const files = [
          mockFile('file1.txt', 'folder\\subfolder\\file1.txt'), // Windows-style
          mockFile('file2.txt', 'folder/subfolder/file2.txt'),   // Unix-style
          mockFile('file3.txt', 'folder\\subfolder/file3.txt')   // Mixed-style
        ];

        const result = await processFilesForBrowser(files, { pathDetect: false });
        const paths = result.map(f => f.path);

        // Should normalize to forward slashes but preserve full structure
        expect(paths).toEqual([
          'folder/subfolder/file1.txt',
          'folder/subfolder/file2.txt',
          'folder/subfolder/file3.txt'
        ]);

        // Verify no backslashes remain
        paths.forEach(path => {
          expect(path).not.toContain('\\');
        });
      });

      it('should preserve empty directory names in paths', async () => {
        const files = [
          mockFile('file.txt', 'valid/path/file.txt'),
          mockFile('file2.txt', 'path//with//double//slashes/file2.txt')
        ];

        const result = await processFilesForBrowser(files, { pathDetect: false });
        const paths = result.map(f => f.path);

        // Should normalize but preserve the intended structure
        expect(paths).toEqual([
          'valid/path/file.txt',
          'path/with/double/slashes/file2.txt' // Double slashes normalized
        ]);
      });

      it('should handle very deep nested structures', async () => {
        const files = [
          mockFile('deep.txt', 'a/very/deep/nested/folder/structure/that/goes/many/levels/deep.txt'),
          mockFile('shallow.txt', 'shallow.txt')
        ];

        const result = await processFilesForBrowser(files, { pathDetect: false });
        const paths = result.map(f => f.path);

        expect(paths).toEqual([
          'a/very/deep/nested/folder/structure/that/goes/many/levels/deep.txt',
          'shallow.txt'
        ]);
      });
    });
  });

});
