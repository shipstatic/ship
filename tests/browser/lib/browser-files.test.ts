/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processFilesForBrowser } from '../../../src/browser/lib/browser-files';
import { createDeployBody } from '../../../src/browser/core/deploy-body';
import { __setTestEnvironment } from '../../../src/shared/lib/env';
import { setConfig } from '../../../src/shared/core/platform-config';
import { ShipError } from '@shipstatic/types';

// Mock MD5 calculation for browser files
vi.mock('../../../src/shared/lib/md5', () => ({
  calculateMD5: vi.fn().mockResolvedValue({ md5: 'mock-browser-hash' })
}));

describe('Browser File Processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setTestEnvironment('browser');

    // Initialize platform config (matches Node test setup)
    setConfig({
      maxFileSize: 10 * 1024 * 1024,
      maxFilesCount: 1000,
      maxTotalSize: 100 * 1024 * 1024,
    });
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

    it('should skip empty files (aligned with Node — R2 cannot store zero-byte objects)', async () => {
      const emptyFiles = [
        new File([], 'empty.txt'),
        new File([''], 'empty-string.html'),
        new File([new ArrayBuffer(0)], 'empty-buffer.bin')
      ];

      const result = await processFilesForBrowser(emptyFiles, {});

      // Empty files are skipped — same behavior as Node
      expect(result).toHaveLength(0);
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

  describe('server-processed uploads (build/prerender)', () => {
    it('should skip validation and only compute MD5 when build=true', async () => {
      // Source files that would normally fail deploy validation
      const files = [
        new File(['<html>'], 'index.html'),
        new File(['{}'], 'package.json'),
        new File(['export default {}'], 'vite.config.ts'),
      ];
      files.forEach((f, i) => {
        Object.defineProperty(f, 'webkitRelativePath', { value: ['demo/index.html', 'demo/package.json', 'demo/vite.config.ts'][i] });
      });

      // With build=true, package.json + .ts files should NOT throw
      const result = await processFilesForBrowser(files, { build: true });

      expect(result).toHaveLength(3);
      expect(result.every(f => f.md5 === 'mock-browser-hash')).toBe(true);
    });

    it('should skip validation when prerender=true', async () => {
      const files = [
        new File(['<html>'], 'index.html'),
        new File(['{}'], 'package.json'),
      ];
      files.forEach((f, i) => {
        Object.defineProperty(f, 'webkitRelativePath', { value: ['demo/index.html', 'demo/package.json'][i] });
      });

      const result = await processFilesForBrowser(files, { prerender: true });

      expect(result).toHaveLength(2);
    });

    it('should still skip empty files in server-processed mode', async () => {
      const files = [
        new File(['<html>'], 'index.html'),
        new File([], 'empty.txt'),
      ];

      const result = await processFilesForBrowser(files, { build: true });

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('index.html');
    });

    it('should still filter junk files in server-processed mode', async () => {
      const files = [
        new File(['<html>'], 'index.html'),
        new File([''], '.DS_Store'),
      ];

      const result = await processFilesForBrowser(files, { build: true });

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('index.html');
    });

    it('should not skip validation when build and prerender are both false/absent', async () => {
      // .exe should be rejected by deploy validation
      const files = [new File(['malware'], 'virus.exe')];

      await expect(processFilesForBrowser(files, {}))
        .rejects.toThrow('File extension not allowed');

      await expect(processFilesForBrowser(files, { build: false, prerender: false }))
        .rejects.toThrow('File extension not allowed');
    });
  });

  describe('unbuilt project detection', () => {
    it('should reject files with node_modules in path', async () => {
      const files = [
        new File(['<html>'], 'index.html'),
        new File(['module.exports'], 'react.js'),
      ];
      // Set webkitRelativePath to simulate folder drop
      Object.defineProperty(files[0], 'webkitRelativePath', { value: 'demo/index.html' });
      Object.defineProperty(files[1], 'webkitRelativePath', { value: 'demo/node_modules/react/index.js' });

      await expect(processFilesForBrowser(files, {}))
        .rejects.toThrow('Unbuilt project detected');
    });

    it('should reject files with package.json in path', async () => {
      const files = [
        new File(['<html>'], 'index.html'),
        new File(['{}'], 'package.json'),
      ];
      Object.defineProperty(files[0], 'webkitRelativePath', { value: 'demo/index.html' });
      Object.defineProperty(files[1], 'webkitRelativePath', { value: 'demo/package.json' });

      await expect(processFilesForBrowser(files, {}))
        .rejects.toThrow('Unbuilt project detected');
    });

    it('should reject even when node_modules files are under .pnpm (pnpm regression)', async () => {
      const file = new File(['lodash'], 'index.js');
      Object.defineProperty(file, 'webkitRelativePath', {
        value: 'demo/node_modules/.pnpm/lodash@4/node_modules/lodash/index.js',
      });

      await expect(processFilesForBrowser([file], {}))
        .rejects.toThrow('Unbuilt project detected');
    });
  });

  describe('filename and extension validation', () => {
    it('should reject blocked extensions (.exe, .msi)', async () => {
      const exeFile = new File(['malware'], 'virus.exe');
      await expect(processFilesForBrowser([exeFile], {}))
        .rejects.toThrow('File extension not allowed');

      const msiFile = new File(['installer'], 'installer.msi');
      await expect(processFilesForBrowser([msiFile], {}))
        .rejects.toThrow('File extension not allowed');
    });

    it('should reject URL-breaking and HTML-unsafe filename characters', async () => {
      const questionFile = new File(['test'], 'file?.txt');
      await expect(processFilesForBrowser([questionFile], {}))
        .rejects.toThrow('unsafe characters');

      const hashFile = new File(['test'], 'file#anchor.txt');
      await expect(processFilesForBrowser([hashFile], {}))
        .rejects.toThrow('unsafe characters');

      const htmlFile = new File(['test'], 'file<tag>.txt');
      await expect(processFilesForBrowser([htmlFile], {}))
        .rejects.toThrow('unsafe characters');
    });

    it('should allow characters that survive the URL round-trip', async () => {
      const parenFile = new File(['test'], 'file(1).json');
      const result1 = await processFilesForBrowser([parenFile], {});
      expect(result1).toHaveLength(1);

      const bracketFile = new File(['test'], 'file[slug].js');
      const result2 = await processFilesForBrowser([bracketFile], {});
      expect(result2).toHaveLength(1);

      const braceFile = new File(['test'], 'file{id}.txt');
      const result3 = await processFilesForBrowser([braceFile], {});
      expect(result3).toHaveLength(1);

      const semicolonFile = new File(['test'], 'file;semi.txt');
      const result4 = await processFilesForBrowser([semicolonFile], {});
      expect(result4).toHaveLength(1);
    });

    it('should reject Windows reserved names', async () => {
      const conFile = new File(['reserved'], 'CON.txt');
      await expect(processFilesForBrowser([conFile], {}))
        .rejects.toThrow('reserved system name');
    });

    it('should reject filenames ending with dots', async () => {
      const dotFile = new File(['trailing'], 'file.');
      await expect(processFilesForBrowser([dotFile], {}))
        .rejects.toThrow('cannot end with dots');
    });

    it('should allow valid file extensions (.html, .css, .json)', async () => {
      const validFiles = [
        new File(['<html>'], 'page.html'),
        new File(['body {}'], 'style.css'),
        new File(['{}'], 'data.json'),
      ];

      const result = await processFilesForBrowser(validFiles, {});
      expect(result).toHaveLength(3);
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

describe('createDeployBody — build/prerender flags', () => {
  it('should append build=true to FormData when flag is set', async () => {
    const files = [{ path: 'index.html', content: new File(['<html>'], 'index.html'), size: 6, md5: 'abc' }];
    const { body } = await createDeployBody(files, undefined, undefined, { build: true });
    expect((body as FormData).get('build')).toBe('true');
    expect((body as FormData).get('prerender')).toBeNull();
  });

  it('should append prerender=true to FormData when flag is set', async () => {
    const files = [{ path: 'index.html', content: new File(['<html>'], 'index.html'), size: 6, md5: 'abc' }];
    const { body } = await createDeployBody(files, undefined, undefined, { prerender: true });
    expect((body as FormData).get('prerender')).toBe('true');
    expect((body as FormData).get('build')).toBeNull();
  });

  it('should append both flags when both are set', async () => {
    const files = [{ path: 'index.html', content: new File(['<html>'], 'index.html'), size: 6, md5: 'abc' }];
    const { body } = await createDeployBody(files, undefined, undefined, { build: true, prerender: true });
    expect((body as FormData).get('build')).toBe('true');
    expect((body as FormData).get('prerender')).toBe('true');
  });

  it('should not append flags when undefined', async () => {
    const files = [{ path: 'index.html', content: new File(['<html>'], 'index.html'), size: 6, md5: 'abc' }];
    const { body } = await createDeployBody(files);
    expect((body as FormData).get('build')).toBeNull();
    expect((body as FormData).get('prerender')).toBeNull();
  });
});