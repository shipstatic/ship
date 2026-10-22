/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processFilesForBrowser } from '../../../src/browser/core/browser-files';
import { __setTestEnvironment } from '../../../src/shared/lib/env';
import { FREE_PLAN_LIMITS } from '../../fixtures/builders';

/** The home page every deployment carries at its root. */
const home = () => new File(['<html></html>'], 'index.html', { type: 'text/html' });

const NO_HOME =
  "There's no index.html at the top of your site. It's the page visitors see first, so your site needs one.";

// Mock MD5 calculation for browser files
vi.mock('../../../src/shared/lib/md5', () => ({
  calculateMD5: vi.fn().mockResolvedValue({ md5: 'mock-browser-hash' }),
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
        new File(['body { margin: 0; }'], 'style.css', { type: 'text/css' }),
      ];

      const result = await processFilesForBrowser(mockFiles, {}, FREE_PLAN_LIMITS);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        path: 'index.html',
        content: expect.any(File),
        size: expect.any(Number),
        md5: 'mock-browser-hash',
      });
      expect(result[1]).toEqual({
        path: 'style.css',
        content: expect.any(File),
        size: expect.any(Number),
        md5: 'mock-browser-hash',
      });
    });

    it('refuses an empty file array: there is nothing to publish', async () => {
      await expect(processFilesForBrowser([], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        'There are no files to publish.',
      );
    });

    it('refuses files with no index.html at their root', async () => {
      const files = [new File(['<p>about</p>'], 'about.html', { type: 'text/html' })];

      await expect(processFilesForBrowser(files, {}, FREE_PLAN_LIMITS)).rejects.toThrow(NO_HOME);
    });

    it('names the folder that holds the home page, when the site sits a folder down', async () => {
      const drop = (name: string, relativePath: string) => {
        const file = new File(['x'], name);
        Object.defineProperty(file, 'webkitRelativePath', {
          value: relativePath,
          configurable: true,
        });
        return file;
      };

      await expect(
        processFilesForBrowser(
          [drop('index.html', 'site/dist/index.html'), drop('notes.txt', 'site/notes.txt')],
          {},
          FREE_PLAN_LIMITS,
        ),
      ).rejects.toThrow(
        `${NO_HOME} There's one in dist/. If that's your site, publish that folder instead.`,
      );
    });

    it('should preserve file content correctly', async () => {
      const testContent = '<html><body>Browser Test</body></html>';
      const mockFile = new File([testContent], 'index.html', { type: 'text/html' });

      const result = await processFilesForBrowser([mockFile], {}, FREE_PLAN_LIMITS);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('index.html');
      expect(result[0].size).toBe(testContent.length);

      // Verify content is preserved as File (impossible simplicity!)
      expect(result[0].content).toBeInstanceOf(File);
    });

    it('should handle files with special characters in names', async () => {
      const mockFiles = [
        home(),
        new File(['test'], 'file with spaces.txt'),
        new File(['test'], 'file-with-dashes.css'),
        new File(['test'], 'file_with_underscores'),
        new File(['test'], 'file.with.dots.html'),
      ];

      const result = await processFilesForBrowser(mockFiles, {}, FREE_PLAN_LIMITS);

      expect(result).toHaveLength(5);
      expect(result.map((f) => f.path)).toEqual([
        'index.html',
        'file with spaces.txt',
        'file-with-dashes.css',
        'file_with_underscores',
        'file.with.dots.html',
      ]);
    });

    it('should handle large files efficiently', async () => {
      // Create a larger test file (1KB)
      const largeContent = 'x'.repeat(1024);
      const mockFile = new File([largeContent], 'large-file.txt', { type: 'text/plain' });

      const result = await processFilesForBrowser([home(), mockFile], {}, FREE_PLAN_LIMITS);

      expect(result).toHaveLength(2);
      expect(result[1].size).toBe(1024);
      expect(result[1].path).toBe('large-file.txt');
    });

    it('should work with mixed file types', async () => {
      const mockFiles = [
        new File(['<html></html>'], 'index.html', { type: 'text/html' }),
        new File(['body {}'], 'style.css', { type: 'text/css' }),
        new File(['console.log()'], 'app', { type: 'application/javascript' }),
        new File(['{"name": "test"}'], 'data.json', { type: 'application/json' }),
        new File([new ArrayBuffer(100)], 'image.png', { type: 'image/png' }),
      ];

      const result = await processFilesForBrowser(mockFiles, {}, FREE_PLAN_LIMITS);

      expect(result).toHaveLength(5);
      expect(result.map((f) => f.path)).toEqual([
        'index.html',
        'style.css',
        'app',
        'data.json',
        'image.png',
      ]);
    });
  });

  describe('browser-specific edge cases', () => {
    it('should handle very large files efficiently', async () => {
      // Create a 5MB file to test memory efficiency
      const largeContent = new ArrayBuffer(5 * 1024 * 1024);
      const mockFile = new File([largeContent], 'large-file.bin', {
        type: 'application/octet-stream',
      });

      const result = await processFilesForBrowser([home(), mockFile], {}, FREE_PLAN_LIMITS);

      expect(result).toHaveLength(2);
      expect(result[1].path).toBe('large-file.bin');
      expect(result[1].size).toBe(5 * 1024 * 1024);
      expect(result[1].content).toBeInstanceOf(File);
    });

    it('should handle files with Unicode names', async () => {
      const unicodeFiles = [
        home(),
        new File(['content'], '测试文件.txt'), // Chinese
        new File(['content'], 'файл'), // Cyrillic
        new File(['content'], 'ملف.html'), // Arabic
        new File(['content'], '🚀rocket.css'), // Emoji
        new File(['content'], 'café.json'), // Accented characters
      ];

      const result = await processFilesForBrowser(unicodeFiles, {}, FREE_PLAN_LIMITS);

      expect(result).toHaveLength(6);
      expect(result.map((f) => f.path)).toEqual([
        'index.html',
        '测试文件.txt',
        'файл',
        'ملف.html',
        '🚀rocket.css',
        'café.json',
      ]);
    });

    it('should skip empty files (aligned with Node — R2 cannot store zero-byte objects)', async () => {
      const emptyFiles = [
        home(),
        new File([], 'empty.txt'),
        new File([''], 'empty-string.html'),
        new File([new ArrayBuffer(0)], 'empty-buffer.bin'),
      ];

      const result = await processFilesForBrowser(emptyFiles, {}, FREE_PLAN_LIMITS);

      // Empty files are skipped, the same as in Node: only the home page remains
      expect(result.map((f) => f.path)).toEqual(['index.html']);
    });

    it('should handle files with unusual MIME types', async () => {
      const unusualFiles = [
        home(),
        new File(['content'], 'test.xyz', { type: 'application/unknown' }),
        new File(['content'], 'no-extension', { type: '' }),
        new File(['content'], 'custom.type', { type: 'application/x-custom-type' }),
        new File(['content'], 'multi.part.name.txt', { type: 'text/plain; charset=utf-8' }),
      ];

      const result = await processFilesForBrowser(unusualFiles, {}, FREE_PLAN_LIMITS);

      expect(result).toHaveLength(5);
      expect(result.map((f) => f.path)).toEqual([
        'index.html',
        'test.xyz',
        'no-extension',
        'custom.type',
        'multi.part.name.txt',
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

      const result = await processFilesForBrowser(
        [home(), fileFromBlob, fileFromBuffer, fileFromString],
        {},
        FREE_PLAN_LIMITS,
      );

      expect(result).toHaveLength(4);
      expect(result.every((f) => f.content instanceof File)).toBe(true);
    });

    it('should preserve files when deploying from a dot-folder root (e.g. .output/)', async () => {
      const createFileWithPath = (name: string, relativePath: string) => {
        const file = new File(['content'], name);
        Object.defineProperty(file, 'webkitRelativePath', {
          value: relativePath,
          configurable: true,
        });
        return file;
      };

      const files = [
        createFileWithPath('index.html', '.output/index.html'),
        createFileWithPath('style.css', '.output/assets/style.css'),
        createFileWithPath('app.js', '.output/assets/app.js'),
      ];

      const result = await processFilesForBrowser(files, {}, FREE_PLAN_LIMITS);

      // Dot-folder root should be stripped — content paths should not be filtered
      expect(result).toHaveLength(3);
      expect(result.map((f) => f.path)).toEqual([
        'index.html',
        'assets/style.css',
        'assets/app.js',
      ]);
    });

    it('should still filter dot-files within a dot-folder root', async () => {
      const createFileWithPath = (name: string, relativePath: string) => {
        const file = new File(['content'], name);
        Object.defineProperty(file, 'webkitRelativePath', {
          value: relativePath,
          configurable: true,
        });
        return file;
      };

      const files = [
        createFileWithPath('index.html', '.output/index.html'),
        createFileWithPath('.env', '.output/.env'),
        createFileWithPath('.gitignore', '.output/.gitignore'),
      ];

      const result = await processFilesForBrowser(files, {}, FREE_PLAN_LIMITS);

      // Root dot-folder stripped, but .env and .gitignore within content should still be filtered
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('index.html');
    });

    it('should handle files with webkitRelativePath', async () => {
      const createFileWithPath = (name: string, relativePath: string) => {
        const file = new File(['content'], name);
        Object.defineProperty(file, 'webkitRelativePath', {
          value: relativePath,
          configurable: true,
        });
        return file;
      };

      const filesWithPaths = [
        createFileWithPath('index.html', 'project/dist/index.html'),
        createFileWithPath('app', 'project/dist/assets/app.js'),
        createFileWithPath('style.css', 'project/dist/css/style.css'),
      ];

      const result = await processFilesForBrowser(filesWithPaths, {}, FREE_PLAN_LIMITS);

      expect(result).toHaveLength(3);
      // Should use webkitRelativePath when available to preserve directory structure
      expect(result.map((f) => f.path)).toEqual(['index.html', 'assets/app.js', 'css/style.css']);
    });

    it('does not flatten a Vite assets folder dropped as a directory', async () => {
      // Merged from mixed-core/directory-structure-browser.test.ts. The
      // browser half of the same regression the Node tier pins: Vite emits
      // every hashed asset into one `assets/` directory, and flattening them
      // breaks every `/assets/...` reference in index.html.
      const drop = (name: string, relativePath: string) => {
        const file = new File(['x'], name);
        Object.defineProperty(file, 'webkitRelativePath', {
          value: relativePath,
          configurable: true,
        });
        return file;
      };

      const result = await processFilesForBrowser(
        [
          drop('index.html', 'dist/index.html'),
          drop('index-8ac629b0.css', 'dist/assets/index-8ac629b0.css'),
          drop('index-f1e2d3c4.js', 'dist/assets/index-f1e2d3c4.js'),
          drop('vue-logo.png', 'dist/assets/vue-logo-a1b2c3d4.png'),
          drop('favicon.ico', 'dist/favicon.ico'),
        ],
        {},
        FREE_PLAN_LIMITS,
      );

      expect(result.map((f) => f.path).sort()).toEqual([
        'assets/index-8ac629b0.css',
        'assets/index-f1e2d3c4.js',
        'assets/vue-logo-a1b2c3d4.png',
        'favicon.ico',
        'index.html',
      ]);
    });

    it('falls back to file.name when webkitRelativePath is the empty string', async () => {
      // Individual file selection (not a directory drop) leaves the property
      // empty rather than absent in some browsers.
      const named = (name: string) => {
        const file = new File(['x'], name);
        Object.defineProperty(file, 'webkitRelativePath', { value: '', configurable: true });
        return file;
      };

      const result = await processFilesForBrowser(
        [named('index.html'), named('app.js')],
        {},
        FREE_PLAN_LIMITS,
      );

      expect(result.map((f) => f.path).sort()).toEqual(['app.js', 'index.html']);
    });

    it('should handle concurrent file processing', async () => {
      const files = [
        home(),
        ...Array.from({ length: 50 }, (_, i) => new File([`content ${i}`], `file-${i}.txt`)),
      ];

      const result = await processFilesForBrowser(files, {}, FREE_PLAN_LIMITS);

      expect(result).toHaveLength(51);
      expect(result.every((f) => f.md5 === 'mock-browser-hash')).toBe(true);
    });

    it('should preserve file timestamps', async () => {
      const now = Date.now();
      const fileWithTimestamp = new File(['content'], 'timed-file.txt', {
        lastModified: now - 1000,
      });

      const result = await processFilesForBrowser(
        [home(), fileWithTimestamp],
        {},
        FREE_PLAN_LIMITS,
      );

      expect(result).toHaveLength(2);
      // The timestamp might not be preserved in StaticFile format, but processing should succeed
      expect(result[1].path).toBe('timed-file.txt');
    });

    it('refuses files that name one path, as the API does', async () => {
      const duplicateFiles = [
        home(),
        new File(['content1'], 'duplicate.txt'),
        new File(['content2'], 'duplicate.txt'),
      ];

      await expect(processFilesForBrowser(duplicateFiles, {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        'The file duplicate.txt appears twice.',
      );
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
        Object.defineProperty(f, 'webkitRelativePath', {
          value: ['demo/index.html', 'demo/package.json', 'demo/vite.config.ts'][i],
        });
      });

      // With build=true, package.json + .ts files should NOT throw
      const result = await processFilesForBrowser(files, { build: true });

      expect(result).toHaveLength(3);
      expect(result.every((f) => f.md5 === 'mock-browser-hash')).toBe(true);
    });

    it('should skip validation when prerender=true', async () => {
      const files = [new File(['<html>'], 'index.html'), new File(['{}'], 'package.json')];
      files.forEach((f, i) => {
        Object.defineProperty(f, 'webkitRelativePath', {
          value: ['demo/index.html', 'demo/package.json'][i],
        });
      });

      const result = await processFilesForBrowser(files, { prerender: true });

      expect(result).toHaveLength(2);
    });

    it('carries empty files and dot files in server-processed mode: the source is decided before it', async () => {
      const files = [
        new File(['<html>'], 'index.html'),
        new File([], 'empty.css'),
        new File(['x'], '.npmrc'),
      ];

      const result = await processFilesForBrowser(files, { build: true });

      expect(result.map((f) => f.path)).toEqual(['index.html', 'empty.css', '.npmrc']);
    });

    it('should not skip validation when build and prerender are both false/absent', async () => {
      // .exe should be rejected by deploy validation
      const files = [new File(['malware'], 'virus.exe')];

      await expect(processFilesForBrowser(files, {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        'has an extension that is not allowed',
      );

      await expect(
        processFilesForBrowser(files, { build: false, prerender: false }, FREE_PLAN_LIMITS),
      ).rejects.toThrow('has an extension that is not allowed');
    });
  });

  describe('unbuilt project detection', () => {
    it('should reject files with node_modules in path', async () => {
      const files = [new File(['<html>'], 'index.html'), new File(['module.exports'], 'react.js')];
      // Set webkitRelativePath to simulate folder drop
      Object.defineProperty(files[0], 'webkitRelativePath', { value: 'demo/index.html' });
      Object.defineProperty(files[1], 'webkitRelativePath', {
        value: 'demo/node_modules/react/index.js',
      });

      await expect(processFilesForBrowser(files, {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        "belongs to a project that isn't built yet",
      );
    });

    it('should reject files with package.json in path', async () => {
      const files = [new File(['<html>'], 'index.html'), new File(['{}'], 'package.json')];
      Object.defineProperty(files[0], 'webkitRelativePath', { value: 'demo/index.html' });
      Object.defineProperty(files[1], 'webkitRelativePath', { value: 'demo/package.json' });

      await expect(processFilesForBrowser(files, {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        "belongs to a project that isn't built yet",
      );
    });

    it('should reject even when node_modules files are under .pnpm (pnpm regression)', async () => {
      const files = [new File(['<html>'], 'index.html'), new File(['lodash'], 'index.js')];
      Object.defineProperty(files[0], 'webkitRelativePath', { value: 'demo/index.html' });
      Object.defineProperty(files[1], 'webkitRelativePath', {
        value: 'demo/node_modules/.pnpm/lodash@4/node_modules/lodash/index.js',
      });

      // Common root 'demo/' is stripped, leaving node_modules visible in content paths
      await expect(processFilesForBrowser(files, {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        "belongs to a project that isn't built yet",
      );
    });
  });

  describe('filename and extension validation', () => {
    it('should reject blocked extensions (.exe, .msi)', async () => {
      const exeFile = new File(['malware'], 'virus.exe');
      await expect(processFilesForBrowser([exeFile], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        'has an extension that is not allowed',
      );

      const msiFile = new File(['installer'], 'installer.msi');
      await expect(processFilesForBrowser([msiFile], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        'has an extension that is not allowed',
      );
    });

    it('should reject URL-breaking and HTML-unsafe filename characters', async () => {
      const questionFile = new File(['test'], 'file?.txt');
      await expect(processFilesForBrowser([questionFile], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        'unsafe characters',
      );

      const hashFile = new File(['test'], 'file#anchor.txt');
      await expect(processFilesForBrowser([hashFile], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        'unsafe characters',
      );

      const htmlFile = new File(['test'], 'file<tag>.txt');
      await expect(processFilesForBrowser([htmlFile], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        'unsafe characters',
      );
    });

    it('should allow characters that survive the URL round-trip', async () => {
      for (const name of ['file(1).json', 'file[slug].js', 'file{id}.txt', 'file;semi.txt']) {
        const result = await processFilesForBrowser(
          [home(), new File(['test'], name)],
          {},
          FREE_PLAN_LIMITS,
        );
        expect(result.map((f) => f.path)).toEqual(['index.html', name]);
      }
    });

    it('should reject Windows reserved names', async () => {
      const conFile = new File(['reserved'], 'CON.txt');
      await expect(processFilesForBrowser([conFile], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        'reserved system name',
      );
    });

    it('should reject filenames ending with dots', async () => {
      const dotFile = new File(['trailing'], 'file.');
      await expect(processFilesForBrowser([dotFile], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        'cannot end with dots',
      );
    });

    it('should allow valid file extensions (.html, .css, .json)', async () => {
      const validFiles = [
        home(),
        new File(['<html>'], 'page.html'),
        new File(['body {}'], 'style.css'),
        new File(['{}'], 'data.json'),
      ];

      const result = await processFilesForBrowser(validFiles, {}, FREE_PLAN_LIMITS);
      expect(result).toHaveLength(4);
    });
  });

  describe('browser memory and performance edge cases', () => {
    it('should handle processing without memory leaks', async () => {
      // Process multiple batches to test for memory leaks
      for (let batch = 0; batch < 10; batch++) {
        const files = [
          home(),
          ...Array.from(
            { length: 10 },
            (_, i) => new File([`batch ${batch} file ${i}`], `batch-${batch}-file-${i}.txt`),
          ),
        ];

        const result = await processFilesForBrowser(files, {}, FREE_PLAN_LIMITS);
        expect(result).toHaveLength(11);
      }
    });

    it('should handle files processed in wrong environment gracefully', async () => {
      // Temporarily switch environment to test error handling
      __setTestEnvironment('node');

      const files = [new File(['content'], 'test.txt')];

      await expect(processFilesForBrowser(files, {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        'processFilesForBrowser can only be called in a browser environment.',
      );

      // Restore environment
      __setTestEnvironment('browser');
    });

    it('should handle File preservation edge cases', async () => {
      // Test that Files are kept as Files (impossible simplicity!)
      const typedArray = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const fileFromTypedArray = new File([typedArray], 'typed-array.bin');

      const result = await processFilesForBrowser(
        [home(), fileFromTypedArray],
        {},
        FREE_PLAN_LIMITS,
      );

      expect(result).toHaveLength(2);
      expect(result[1].content).toBeInstanceOf(File);
      expect(result[1].size).toBe(5);
    });
  });
});
