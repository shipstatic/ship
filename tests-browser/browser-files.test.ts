/**
 * @file `processFilesForBrowser` on REAL browser primitives.
 *
 * jsdom carries the bulk of the browser-files suite; what it cannot certify
 * is the runtime itself: that `getENV()` detects a real browser without the
 * test override, that `webkitRelativePath` behaves as an instance-definable
 * property on real `File` objects (which is exactly how drag-and-drop
 * populates it), and that the full pipeline — path optimization, junk
 * filtering, validation, spark-md5 — runs on Chromium's own primitives.
 */

import type { PlatformLimits } from '@shipstatic/types';
import { describe, expect, it } from 'vitest';
import { processFilesForBrowser } from '../src/browser/core/browser-files';

/** A real File carrying the relative path drag-and-drop would give it. */
function fileAt(relativePath: string, content = 'content'): File {
  const name = relativePath.split('/').pop() ?? relativePath;
  const file = new File([content], name, { type: 'text/plain' });
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

const LIMITS: PlatformLimits = {
  maxFileSize: 1024 * 1024,
  maxFilesCount: 50,
  maxTotalSize: 4 * 1024 * 1024,
};

describe('processFilesForBrowser in Chromium', () => {
  it('runs without the test environment override — the runtime IS a browser', async () => {
    // In the Node suite this call path needs `__setTestEnvironment('browser')`;
    // here, detection succeeds on the real global surface.
    const files = await processFilesForBrowser(
      [fileAt('site/index.html', '<html></html>')],
      {},
      LIMITS,
    );
    expect(files).toHaveLength(1);
  });

  it('preserves nested asset paths after stripping the common root (the Vite regression)', async () => {
    const files = await processFilesForBrowser(
      [
        fileAt('dist/index.html', '<html></html>'),
        fileAt('dist/assets/index-8ac629b0.css', 'body{}'),
        fileAt('dist/assets/vue-logo-a1b2c3d4.png', 'png-bytes'),
      ],
      {},
      LIMITS,
    );
    expect(files.map((f) => f.path).sort()).toEqual([
      'assets/index-8ac629b0.css',
      'assets/vue-logo-a1b2c3d4.png',
      'index.html',
    ]);
  });

  it('filters junk files the platform never serves', async () => {
    const files = await processFilesForBrowser(
      [fileAt('site/index.html', '<html></html>'), fileAt('site/.DS_Store', 'junk')],
      {},
      LIMITS,
    );
    expect(files.map((f) => f.path)).toEqual(['index.html']);
  });

  it('attaches a real spark-md5 digest and byte-accurate size to every file', async () => {
    const [file] = await processFilesForBrowser([fileAt('site/hello.txt', 'hello')], {}, LIMITS);
    expect(file.md5).toBe('5d41402abc4b2a76b9719d911017c592');
    expect(file.size).toBe(5);
  });

  it('enforces platform limits on real File sizes', async () => {
    const tight: PlatformLimits = { maxFileSize: 1024, maxFilesCount: 5, maxTotalSize: 4096 };
    const oversized = fileAt('site/big.bin', 'x'.repeat(2048));
    await expect(processFilesForBrowser([oversized], {}, tight)).rejects.toThrow(/exceeds|size/i);
  });

  it('falls back to file.name when webkitRelativePath is empty (file-picker input)', async () => {
    // A plain `new File` has webkitRelativePath '' — the real value of
    // asserting this HERE is that it is Chromium's own property, not a shim.
    const plain = new File(['<html></html>'], 'index.html');
    expect(plain.webkitRelativePath).toBe('');
    const files = await processFilesForBrowser([plain], {}, LIMITS);
    expect(files.map((f) => f.path)).toEqual(['index.html']);
  });
});
