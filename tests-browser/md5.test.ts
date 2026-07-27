/**
 * @file spark-md5 in a REAL browser — the digest contract, cross-runtime.
 *
 * The Node suite proves these exact vectors through `calculateMD5`'s Blob
 * backend with a polyfilled `Blob.prototype.arrayBuffer`. This tier removes
 * the polyfill from the equation: real Chromium `Blob`, real `arrayBuffer`,
 * real typed-array slicing. The API verifies the client's checksum on R2 put,
 * so a browser upload and a Node upload of the same bytes MUST present the
 * same digest — same constants here as in `tests/shared/lib/md5.test.ts`,
 * deliberately.
 */

import { describe, expect, it } from 'vitest';
import { calculateMD5 } from '../src/shared/lib/md5';

/** Published MD5 vectors — verifiable against any independent implementation. */
const EMPTY = 'd41d8cd98f00b204e9800998ecf8427e';
const HELLO = '5d41402abc4b2a76b9719d911017c592';
const ABC = '900150983cd24fb0d6963f7d28e17f72';
/** Every byte 0x00–0xFF once, in order — catches text-coercion of binary input. */
const ALL_BYTES = 'e2c865db4162bed963bfaa9ef6ac18f0';

describe('calculateMD5 in Chromium', () => {
  it.each([
    ['empty', '', EMPTY],
    ['hello', 'hello', HELLO],
    ['abc', 'abc', ABC],
  ])('hashes a %s blob', async (_name, content, expected) => {
    expect((await calculateMD5(new Blob([content]))).md5).toBe(expected);
  });

  it('hashes binary content without text coercion', async () => {
    const allBytes = new Uint8Array(Array.from({ length: 256 }, (_, i) => i));
    expect((await calculateMD5(new Blob([allBytes]))).md5).toBe(ALL_BYTES);
  });

  it('hashes across the 2 MB chunk boundary', async () => {
    // Same constant as the Node tier: an off-by-one in the chunked slicing
    // loop produces a plausible-looking wrong digest that only an input
    // larger than one chunk can reveal.
    const threeMegabytes = new Uint8Array(3 * 1024 * 1024).fill(0x41);
    expect((await calculateMD5(new Blob([threeMegabytes]))).md5).toBe(
      'dce339bccbe03338086bb3432034a345',
    );
  });

  it('hashes a real File the way it hashes its Blob', async () => {
    const file = new File(['hello'], 'hello.txt');
    expect((await calculateMD5(file)).md5).toBe(HELLO);
  });
});
