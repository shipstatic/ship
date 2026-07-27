/**
 * @file `createDeployBody` on Chromium's REAL `FormData` and `File`.
 *
 * The jsdom mirror asserts the same field layout; this tier proves the bytes:
 * a real browser `FormData` entry read back through `File.arrayBuffer()` must
 * contain exactly the content that went in, under the exact part name and
 * filename the API multipart parser expects.
 */

import { describe, expect, it } from 'vitest';
import { createDeployBody } from '../src/browser/core/deploy-body';
import type { StaticFile } from '../src/shared/types';

const HELLO_MD5 = '5d41402abc4b2a76b9719d911017c592';

function staticFile(path: string, content: string, md5: string): StaticFile {
  return { path, content: new Blob([content]), size: content.length, md5 };
}

describe('createDeployBody in Chromium', () => {
  it('appends every file under files[] with its deploy path as the filename', async () => {
    const { body } = await createDeployBody([
      staticFile('index.html', '<html></html>', 'a'.repeat(32)),
      staticFile('assets/app.js', 'console.log(1)', 'b'.repeat(32)),
    ]);

    const parts = body.getAll('files[]') as File[];
    expect(parts.map((p) => p.name)).toEqual(['index.html', 'assets/app.js']);
    expect(parts.every((p) => p instanceof File)).toBe(true);
    expect(parts.every((p) => p.type === 'application/octet-stream')).toBe(true);
  });

  it('round-trips the exact bytes through the real FormData', async () => {
    const { body } = await createDeployBody([staticFile('hello.txt', 'hello', HELLO_MD5)]);
    const [part] = body.getAll('files[]') as File[];
    const bytes = new Uint8Array(await part.arrayBuffer());
    expect(new TextDecoder().decode(bytes)).toBe('hello');
  });

  it('carries the checksums in file order', async () => {
    const { body } = await createDeployBody([
      staticFile('a.txt', 'aaa', '1'.repeat(32)),
      staticFile('b.txt', 'bbb', '2'.repeat(32)),
    ]);
    expect(JSON.parse(body.get('checksums') as string)).toEqual(['1'.repeat(32), '2'.repeat(32)]);
  });

  it('appends labels, via, and password only when present', async () => {
    const withAll = await createDeployBody([staticFile('i.html', 'x', HELLO_MD5)], {
      labels: ['production'],
      via: 'cli',
      password: 'secret-123',
    });
    expect(JSON.parse(withAll.body.get('labels') as string)).toEqual(['production']);
    expect(withAll.body.get('via')).toBe('cli');
    expect(withAll.body.get('password')).toBe('secret-123');

    const bare = await createDeployBody([staticFile('i.html', 'x', HELLO_MD5)]);
    expect(bare.body.get('labels')).toBeNull();
    expect(bare.body.get('via')).toBeNull();
    expect(bare.body.get('password')).toBeNull();
  });
});
