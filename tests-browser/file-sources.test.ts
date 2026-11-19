/**
 * @file `File`s as deploy sources, on REAL browser primitives.
 *
 * jsdom carries the bulk of the file-sources suite; what it cannot certify
 * is the runtime itself: that `webkitRelativePath` behaves as an
 * instance-definable property on real `File` objects (which is exactly how
 * drag-and-drop populates it), and that the full pipeline (path
 * optimization, junk filtering, validation, spark-md5) runs on Chromium's
 * own primitives.
 */

import type { PlatformLimits } from '@shipstatic/types';
import { describe, expect, it } from 'vitest';
import { processDeployFiles } from '../src/shared/core/deploy-files';
import { fileSources } from '../src/shared/core/file-sources';
import type { DeploymentOptions } from '../src/shared/types';

/** A deploy of `File`s, up to the request: sources, then the one pipeline. */
const deployFiles = (files: File[], options?: DeploymentOptions, limits?: PlatformLimits) =>
  processDeployFiles(fileSources(files), options, limits);

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

describe('a deploy of Files in Chromium', () => {
  it('takes a real File', async () => {
    const files = await deployFiles([fileAt('site/index.html', '<html></html>')], {}, LIMITS);
    expect(files).toHaveLength(1);
  });

  it('preserves nested asset paths after stripping the common root (the Vite regression)', async () => {
    const files = await deployFiles(
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
    const files = await deployFiles(
      [fileAt('site/index.html', '<html></html>'), fileAt('site/.DS_Store', 'junk')],
      {},
      LIMITS,
    );
    expect(files.map((f) => f.path)).toEqual(['index.html']);
  });

  it('attaches a real spark-md5 digest and byte-accurate size to every file', async () => {
    const [file] = await deployFiles([fileAt('site/index.html', 'hello')], {}, LIMITS);
    expect(file.md5).toBe('5d41402abc4b2a76b9719d911017c592');
    expect(file.size).toBe(5);
  });

  it('enforces platform limits on real File sizes', async () => {
    const tight: PlatformLimits = { maxFileSize: 1024, maxFilesCount: 5, maxTotalSize: 4096 };
    const oversized = fileAt('site/big.bin', 'x'.repeat(2048));
    // The sentence is the one the platform's `FILE_RULES` authors, byte for
    // byte: the point of the table is that this reads the same here as from
    // the Node pipeline, `validateFiles` and the API.
    await expect(deployFiles([oversized], {}, tight)).rejects.toThrow(
      'File "big.bin" is too large. Maximum 1 KB allowed.',
    );
  });

  it('falls back to file.name when webkitRelativePath is empty (file-picker input)', async () => {
    // A plain `new File` has webkitRelativePath '' — the real value of
    // asserting this HERE is that it is Chromium's own property, not a shim.
    const plain = new File(['<html></html>'], 'index.html');
    expect(plain.webkitRelativePath).toBe('');
    const files = await deployFiles([plain], {}, LIMITS);
    expect(files.map((f) => f.path)).toEqual(['index.html']);
  });
});
