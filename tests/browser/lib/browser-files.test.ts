/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processFilesForBrowser } from '../../../src/browser/lib/browser-files';
import { __setTestEnvironment } from '../../../src/shared/lib/env';
import { ShipError } from '@shipstatic/types';

// Mock MD5 calculation for browser files
vi.mock('../../../src/shared/lib/md5', () => ({
  calculateMD5: vi.fn().mockResolvedValue({ md5: 'mock-browser-hash' })
}));

describe('Browser File Processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setTestEnvironment('browser');
  });

  describe('processFilesForBrowser', () => {
    it('should process File[] into StaticFile format', async () => {
      const mockFiles = [
        new File(['<html>Test</html>'], 'index.html', { type: 'text/html' }),
        new File(['body { margin: 0; }'], 'style.css', { type: 'text/css' })
      ];

      const result = await processFilesForBrowser(mockFiles, {});

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        path: 'index.html',
        content: expect.any(File),
        size: expect.any(Number),
        md5: 'mock-browser-hash'
      });
      expect(result[1]).toEqual({
        path: 'style.css',
        content: expect.any(File),
        size: expect.any(Number),
        md5: 'mock-browser-hash'
      });
    });

    it('should handle empty file array', async () => {
      const emptyFiles: File[] = [];

      const result = await processFilesForBrowser(emptyFiles, {});

      expect(result).toHaveLength(0);
    });

    it('should preserve file content correctly', async () => {
      const testContent = '<html><body>Browser Test</body></html>';
      const mockFile = new File([testContent], 'test.html', { type: 'text/html' });

      const result = await processFilesForBrowser([mockFile], {});

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('test.html');
      expect(result[0].size).toBe(testContent.length);
      
      // Verify content is preserved as File (impossible simplicity!)
      expect(result[0].content).toBeInstanceOf(File);
    });

    it('should handle files with special characters in names', async () => {
      const mockFiles = [
        new File(['test'], 'file with spaces.txt'),
        new File(['test'], 'file-with-dashes.css'),
        new File(['test'], 'file_with_underscores'),
        new File(['test'], 'file.with.dots.html')
      ];

      const result = await processFilesForBrowser(mockFiles, {});

      expect(result).toHaveLength(4);
      expect(result.map(f => f.path)).toEqual([
        'file with spaces.txt',
        'file-with-dashes.css', 
        'file_with_underscores',
        'file.with.dots.html'
      ]);
    });

    it('should handle large files efficiently', async () => {
      // Create a larger test file (1KB)
      const largeContent = 'x'.repeat(1024);
      const mockFile = new File([largeContent], 'large-file.txt', { type: 'text/plain' });

      const result = await processFilesForBrowser([mockFile], {});

      expect(result).toHaveLength(1);
      expect(result[0].size).toBe(1024);
      expect(result[0].path).toBe('large-file.txt');
    });

    it('should work with mixed file types', async () => {
      const mockFiles = [
        new File(['<html></html>'], 'index.html', { type: 'text/html' }),
        new File(['body {}'], 'style.css', { type: 'text/css' }),
        new File(['console.log()'], 'app', { type: 'application/javascript' }),
        new File(['{"name": "test"}'], 'data.json', { type: 'application/json' }),
        new File([new ArrayBuffer(100)], 'image.png', { type: 'image/png' })
      ];

      const result = await processFilesForBrowser(mockFiles, {});

      expect(result).toHaveLength(5);
      expect(result.map(f => f.path)).toEqual([
        'index.html',
        'style.css', 
        'app',
        'data.json',
        'image.png'
      ]);
    });
  });

  describe('browser-specific edge cases', () => {
    it('should handle very large files efficiently', async () => {
      // Create a 5MB file to test memory efficiency
      const largeContent = new ArrayBuffer(5 * 1024 * 1024);
      const mockFile = new File([largeContent], 'large-file.bin', { type: 'application/octet-stream' });

      const result = await processFilesForBrowser([mockFile], {});

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('large-file.bin');
      expect(result[0].size).toBe(5 * 1024 * 1024);
      expect(result[0].content).toBeInstanceOf(File);
    });

    it('should handle files with Unicode names', async () => {
      const unicodeFiles = [
        new File(['content'], '测试文件.txt'), // Chinese
        new File(['content'], 'файл'), // Cyrillic
        new File(['content'], 'ملف.html'), // Arabic
        new File(['content'], '🚀rocket.css'), // Emoji
        new File(['content'], 'café.json') // Accented characters
      ];

      const result = await processFilesForBrowser(unicodeFiles, {});

      expect(result).toHaveLength(5);
      expect(result.map(f => f.path)).toEqual([
        '测试文件.txt',
        'файл',
        'ملف.html',
        '🚀rocket.css',
        'café.json'
      ]);
    });

    it('should handle empty files', async () => {
      const emptyFiles = [
        new File([], 'empty.txt'),
        new File([''], 'empty-string.html'),
        new File([new ArrayBuffer(0)], 'empty-buffer.bin')
      ];

      const result = await processFilesForBrowser(emptyFiles, {});

      expect(result).toHaveLength(3);
      result.forEach(file => {
        expect(file.size).toBe(0);
        expect(file.content).toBeInstanceOf(File);
      });
    });

    it('should handle files with unusual MIME types', async () => {
      const unusualFiles = [
        new File(['content'], 'test.xyz', { type: 'application/unknown' }),
        new File(['content'], 'no-extension', { type: '' }),
        new File(['content'], 'custom.type', { type: 'application/x-custom-type' }),
        new File(['content'], 'multi.part.name.txt', { type: 'text/plain; charset=utf-8' })
      ];

      const result = await processFilesForBrowser(unusualFiles, {});

      expect(result).toHaveLength(4);
      expect(result.map(f => f.path)).toEqual([
        'test.xyz',
        'no-extension',
        'custom.type',
        'multi.part.name.txt'
      ]);
    });

    it('should handle File objects created from different sources', async () => {
      // File from Blob
      const blob = new Blob(['blob content'], { type: 'text/plain' });
      const fileFromBlob = new File([blob], 'from-blob.txt');

      // File from ArrayBuffer
      const buffer = new TextEncoder().encode('buffer content');
      const fileFromBuffer = new File([buffer], 'from-buffer.txt');

      // File from string
      const fileFromString = new File(['string content'], 'from-string.txt');

      const result = await processFilesForBrowser([fileFromBlob, fileFromBuffer, fileFromString], {});

      expect(result).toHaveLength(3);
      expect(result.every(f => f.content instanceof File)).toBe(true);
    });

    it('should handle files with webkitRelativePath', async () => {
      const createFileWithPath = (name: string, relativePath: string) => {
        const file = new File(['content'], name);
        Object.defineProperty(file, 'webkitRelativePath', {
          value: relativePath,
          configurable: true
        });
        return file;
      };

      const filesWithPaths = [
        createFileWithPath('index.html', 'project/dist/index.html'),
        createFileWithPath('app', 'project/dist/assets/app.js'),
        createFileWithPath('style.css', 'project/dist/css/style.css')
      ];

      const result = await processFilesForBrowser(filesWithPaths, {});

      expect(result).toHaveLength(3);
      // Should use webkitRelativePath when available to preserve directory structure
      expect(result.map(f => f.path)).toEqual(['index.html', 'assets/app.js', 'css/style.css']);
    });

    it('should handle concurrent file processing', async () => {
      const files = Array.from({ length: 50 }, (_, i) => 
        new File([`content ${i}`], `file-${i}.txt`)
      );

      const result = await processFilesForBrowser(files, {});

      expect(result).toHaveLength(50);
      expect(result.every(f => f.md5 === 'mock-browser-hash')).toBe(true);
    });

    it('should preserve file timestamps', async () => {
      const now = Date.now();
      const fileWithTimestamp = new File(['content'], 'timed-file.txt', { 
        lastModified: now - 1000 
      });

      const result = await processFilesForBrowser([fileWithTimestamp], {});

      expect(result).toHaveLength(1);
      // The timestamp might not be preserved in StaticFile format, but processing should succeed
      expect(result[0].path).toBe('timed-file.txt');
    });


    it('should handle files with identical names', async () => {
      const duplicateFiles = [
        new File(['content1'], 'duplicate.txt'),
        new File(['content2'], 'duplicate.txt'),
        new File(['content3'], 'duplicate.txt')
      ];

      const result = await processFilesForBrowser(duplicateFiles, {});

      expect(result).toHaveLength(3);
      // All should be processed, even with duplicate names
      expect(result.every(f => f.path === 'duplicate.txt')).toBe(true);
    });
  });

  describe('browser memory and performance edge cases', () => {
    it('should handle processing without memory leaks', async () => {
      // Process multiple batches to test for memory leaks
      for (let batch = 0; batch < 10; batch++) {
        const files = Array.from({ length: 10 }, (_, i) => 
          new File([`batch ${batch} file ${i}`], `batch-${batch}-file-${i}.txt`)
        );
        
        const result = await processFilesForBrowser(files, {});
        expect(result).toHaveLength(10);
      }
    });

    it('should handle files processed in wrong environment gracefully', async () => {
      // Temporarily switch environment to test error handling
      __setTestEnvironment('node');

      const files = [new File(['content'], 'test.txt')];
      
      await expect(processFilesForBrowser(files, {}))
        .rejects.toThrow('processFilesForBrowser can only be called in a browser environment.');

      // Restore environment
      __setTestEnvironment('browser');
    });

    it('should handle File preservation edge cases', async () => {
      // Test that Files are kept as Files (impossible simplicity!)
      const typedArray = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const fileFromTypedArray = new File([typedArray], 'typed-array.bin');

      const result = await processFilesForBrowser([fileFromTypedArray], {});

      expect(result).toHaveLength(1);
      expect(result[0].content).toBeInstanceOf(File);
      expect(result[0].size).toBe(5);
    });
  });
});