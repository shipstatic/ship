/**
 * @file Subject: `src/shared/lib/md5.ts`, one function with two hashes
 * behind it: Node's own, and `spark-md5` where the runtime has none.
 *
 * **No mocks of the hashes.** Both are run for real against published MD5
 * vectors: a wrong algorithm, a truncated read or a slicing bug would each
 * give a plausible digest, and the whole value of a checksum test is that the
 * number can be checked.
 *
 * Node environment, not jsdom, on purpose: jsdom has no
 * `Blob.prototype.arrayBuffer`, so `tests/setup.ts` polyfills it, and the
 * rows below would then test the polyfill.
 */

import { openAsBlob } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Published MD5 vectors, checkable against any independent implementation. */
const EMPTY = 'd41d8cd98f00b204e9800998ecf8427e';
const HELLO = '5d41402abc4b2a76b9719d911017c592';
const ABC = '900150983cd24fb0d6963f7d28e17f72';
/** Every byte 0x00 to 0xFF once, in order: catches bytes read as text. */
const ALL_BYTES = 'e2c865db4162bed963bfaa9ef6ac18f0';
const allBytes = new Uint8Array(Array.from({ length: 256 }, (_, i) => i));
/** Three megabytes of `A`: more than one slice, so the loop's bounds are in the digest. */
const THREE_MEGABYTES = 'dce339bccbe03338086bb3432034a345';
const threeMegabytes = new Uint8Array(3 * 1024 * 1024).fill(0x41);

/** The module, loaded fresh so each block meets the `crypto` it set up. */
const load = async () => (await import('../../../src/shared/lib/md5')).calculateMD5;

afterEach(() => {
  vi.doUnmock('crypto');
  vi.resetModules();
});

describe.each([
  ['with the runtime’s own hash, as in Node', () => {}],
  // The browser build resolves `crypto` to an empty module (tsup.config.ts),
  // which is how the same source finds no hash there.
  [
    'with spark-md5, as where the runtime has none',
    () => vi.doMock('crypto', () => ({ createHash: undefined })),
  ],
])('calculateMD5 %s', (_which, arrange) => {
  it.each([
    ['empty', '', EMPTY],
    ['hello', 'hello', HELLO],
    ['abc', 'abc', ABC],
  ])('hashes a %s blob', async (_name, content, expected) => {
    arrange();
    const calculateMD5 = await load();

    expect(await calculateMD5(new Blob([content]))).toBe(expected);
  });

  it('hashes binary content as bytes, never as text', async () => {
    arrange();
    const calculateMD5 = await load();

    expect(await calculateMD5(new Blob([allBytes]))).toBe(ALL_BYTES);
  });

  it('hashes across the slice boundary', async () => {
    arrange();
    const calculateMD5 = await load();

    expect(await calculateMD5(new Blob([threeMegabytes]))).toBe(THREE_MEGABYTES);
  });
});

describe('calculateMD5 over a file on disk', () => {
  it('hashes the file Node hands the pipeline, which is read only as it is hashed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ship-md5-'));
    try {
      await writeFile(join(dir, 'bytes.bin'), allBytes);
      await writeFile(join(dir, 'large.bin'), threeMegabytes);
      const calculateMD5 = await load();

      expect(await calculateMD5(await openAsBlob(join(dir, 'bytes.bin')))).toBe(ALL_BYTES);
      expect(await calculateMD5(await openAsBlob(join(dir, 'large.bin')))).toBe(THREE_MEGABYTES);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
