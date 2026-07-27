/**
 * @file Subject: `src/shared/lib/md5.ts` — one entry point, three backends
 * chosen by input type: spark-md5 for a `Blob`, node crypto for a `Buffer`,
 * a streaming node crypto hash for a path.
 *
 * **No mocks.** Every backend is exercised for real against published MD5
 * vectors. The previous revision mocked all three and asserted that
 * `'mocked-spark-md5-hash'` came back — which meant a wrong algorithm, a
 * truncated read, or a chunking bug would all have passed. The whole value of
 * a checksum test is that the number is checkable, so this file checks it.
 *
 * Node environment, not jsdom, deliberately: jsdom has no
 * `Blob.prototype.arrayBuffer`, so `tests/setup.ts` polyfills it through
 * `FileReader` — and then the Blob path would be testing the polyfill rather
 * than the production code path every real browser takes.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShipError } from '@shipstatic/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calculateMD5 } from '../../../src/shared/lib/md5';

/** Published MD5 vectors — verifiable against any independent implementation. */
const EMPTY = 'd41d8cd98f00b204e9800998ecf8427e';
const HELLO = '5d41402abc4b2a76b9719d911017c592';
const ABC = '900150983cd24fb0d6963f7d28e17f72';
/** Every byte 0x00–0xFF once, in order — catches text-coercion of binary input. */
const ALL_BYTES = 'e2c865db4162bed963bfaa9ef6ac18f0';
const allBytes = new Uint8Array(Array.from({ length: 256 }, (_, i) => i));

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ship-md5-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('calculateMD5', () => {
  describe('Blob (spark-md5)', () => {
    it.each([
      ['empty', '', EMPTY],
      ['hello', 'hello', HELLO],
      ['abc', 'abc', ABC],
    ])('hashes a %s blob', async (_name, content, expected) => {
      expect((await calculateMD5(new Blob([content]))).md5).toBe(expected);
    });

    it('hashes binary content without text coercion', async () => {
      expect((await calculateMD5(new Blob([allBytes]))).md5).toBe(ALL_BYTES);
    });

    it('hashes across the 2 MB chunk boundary', async () => {
      // md5Blob slices in 2 MB chunks and appends each; an off-by-one in the
      // loop bounds produces a plausible-looking but wrong digest, which only
      // an input LARGER than one chunk can reveal.
      const threeMegabytes = new Uint8Array(3 * 1024 * 1024).fill(0x41);
      expect((await calculateMD5(new Blob([threeMegabytes]))).md5).toBe(
        'dce339bccbe03338086bb3432034a345',
      );
    });
  });

  describe('Buffer (node crypto)', () => {
    it.each([
      ['empty', Buffer.alloc(0), EMPTY],
      ['hello', Buffer.from('hello'), HELLO],
      ['binary', Buffer.from(allBytes), ALL_BYTES],
    ])('hashes a %s buffer', async (_name, buffer, expected) => {
      expect((await calculateMD5(buffer)).md5).toBe(expected);
    });

    it('agrees with the Blob backend on identical bytes', async () => {
      // The two backends serve the same wire contract: the API verifies the
      // client's checksum on R2 put, so a browser upload and a Node upload of
      // the same file must present the same digest.
      const bytes = Buffer.from(allBytes);
      const fromBuffer = await calculateMD5(bytes);
      const fromBlob = await calculateMD5(new Blob([bytes]));

      expect(fromBuffer.md5).toBe(fromBlob.md5);
    });
  });

  describe('file path (streaming node crypto)', () => {
    it('hashes a file off disk', async () => {
      const file = join(dir, 'hello.txt');
      writeFileSync(file, 'hello');

      expect((await calculateMD5(file)).md5).toBe(HELLO);
    });

    it('hashes an empty file', async () => {
      const file = join(dir, 'empty.txt');
      writeFileSync(file, '');

      expect((await calculateMD5(file)).md5).toBe(EMPTY);
    });

    it('hashes binary content identically to the in-memory backends', async () => {
      const file = join(dir, 'bytes.bin');
      writeFileSync(file, Buffer.from(allBytes));

      expect((await calculateMD5(file)).md5).toBe(ALL_BYTES);
    });

    it('rejects with a ShipError naming the read failure', async () => {
      await expect(calculateMD5(join(dir, 'does-not-exist'))).rejects.toThrow(
        /Failed to read file for MD5/,
      );
    });
  });

  describe('invalid input', () => {
    it('throws for inputs that are neither Blob, Buffer, nor string', async () => {
      await expect(calculateMD5(42 as never)).rejects.toThrow(
        ShipError.business('Invalid input for MD5 calculation'),
      );
    });
  });
});
