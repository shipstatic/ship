/**
 * @file Subject: `src/shared/core/deploy-body.ts` — the one multipart builder.
 *
 * This replaces a pair: a browser file that used the real `FormData`, and a
 * 400-line Node file that mocked `formdata-node` and `form-data-encoder` and
 * asserted on `append` CALLS. Both packages are gone, so the mocks have
 * nothing left to stand in for — and their absence is the improvement worth
 * naming: a real `FormData` can be READ BACK, so every assertion below
 * observes the artifact the API will receive rather than the calls that built
 * it. The old Node file could not tell a body that was assembled correctly
 * from one that was merely appended to correctly.
 *
 * Both platforms' content shapes run through the same rows — `Buffer` is
 * Node's, `Blob`/`File` are the browser's — because one builder now takes all
 * three and the seam moved to how files are COLLECTED, not how they are sent.
 */

import { ShipError } from '@shipstatic/types';
import { describe, expect, it } from 'vitest';
import { createDeployBody } from '../../../src/shared/core/deploy-body';
import type { StaticFile } from '../../../src/shared/types';

/** A file the pipeline could plausibly have produced, on either platform. */
const file = (path: string, content: StaticFile['content'], md5 = 'md5'): StaticFile => ({
  path,
  content,
  size: 1,
  md5,
});

/** The `files[]` parts, as the API will see them. */
const filesOf = (fd: FormData) => fd.getAll('files[]') as File[];

describe('createDeployBody', () => {
  describe('the files', () => {
    it('carries the deploy PATH as the filename — the whole wire contract', async () => {
      // The API reads `File.name` and stores the file there, so a nested path
      // must survive verbatim. Captured on node 22 and bun 1.3 before this
      // builder replaced the hand-encoder: `filename="assets/nested/app.css"`.
      const fd = await createDeployBody([
        file('index.html', Buffer.from('<html></html>')),
        file('assets/nested/app.css', Buffer.from('body{}')),
      ]);

      expect(filesOf(fd).map((f) => f.name)).toEqual(['index.html', 'assets/nested/app.css']);
    });

    it('keeps the bytes', async () => {
      const fd = await createDeployBody([file('index.html', Buffer.from('<h1>hi</h1>'))]);

      expect(await filesOf(fd)[0]!.text()).toBe('<h1>hi</h1>');
    });

    it('takes every content shape the two pipelines produce', async () => {
      // Node hands it a Buffer; the browser hands it a File or a Blob. One
      // builder, so this row is what says the platform seam is gone.
      const fd = await createDeployBody([
        file('buffer.txt', Buffer.from('from node')),
        file('blob.txt', new Blob(['from a blob'])),
        file('file.txt', new File(['from a file'], 'ignored.txt')),
      ]);

      const parts = filesOf(fd);
      expect(parts.map((f) => f.name)).toEqual(['buffer.txt', 'blob.txt', 'file.txt']);
      // The path wins over a File's own name — the pipeline decided the path.
      expect(await parts[2]!.text()).toBe('from a file');
    });

    it('marks every part application/octet-stream — the API derives the real type', async () => {
      const fd = await createDeployBody([file('script.js', Buffer.from('x'))]);

      expect(filesOf(fd)[0]!.type).toBe('application/octet-stream');
    });
  });

  describe('the checksums', () => {
    it('rides one JSON array, index-aligned with the files', async () => {
      const fd = await createDeployBody([
        file('a.txt', Buffer.from('a'), 'first'),
        file('b.txt', Buffer.from('b'), 'second'),
        file('c.txt', Buffer.from('c'), 'third'),
      ]);

      expect(JSON.parse(fd.get('checksums') as string)).toEqual(['first', 'second', 'third']);
      expect(filesOf(fd)).toHaveLength(3);
    });

    it('is an empty array when there are no files', async () => {
      const fd = await createDeployBody([]);

      expect(fd.get('checksums')).toBe('[]');
      expect(filesOf(fd)).toHaveLength(0);
    });
  });

  describe('the metadata beside the files', () => {
    it.each([
      ['labels', { labels: ['production', 'v1.0.0'] }, JSON.stringify(['production', 'v1.0.0'])],
      ['via', { via: 'cli' as const }, 'cli'],
      ['password', { password: 'secret123' }, 'secret123'],
      ['ttl', { ttl: 3600 }, '3600'],
      ['build', { flags: { build: true } }, 'true'],
      ['prerender', { flags: { prerender: true } }, 'true'],
      ['spa', { flags: { spa: true } }, 'true'],
      ['captcha', { captcha: 'recaptcha-proof' }, 'recaptcha-proof'],
    ])('sends %s when it is given', async (field, context, expected) => {
      const fd = await createDeployBody([file('f.txt', Buffer.from('x'))], context);

      expect(fd.get(field)).toBe(expected);
    });

    it.each([
      ['labels', {}],
      ['labels', { labels: [] }],
      ['via', {}],
      ['password', {}],
      ['ttl', {}],
      ['build', { flags: { build: false } }],
      ['prerender', { flags: { prerender: false } }],
      ['spa', { flags: { spa: false } }],
      ['captcha', {}],
    ])('omits %s when it is absent or off', async (field, context) => {
      const fd = await createDeployBody([file('f.txt', Buffer.from('x'))], context);

      expect(fd.has(field)).toBe(false);
    });

    it('sends ttl: 0 rather than dropping it, so the caller hears why', async () => {
      // `!== undefined`, not truthiness. Zero is out of range and the shared
      // rule refuses it by name; a truthiness test would drop it silently and
      // deploy forever instead.
      const fd = await createDeployBody([file('f.txt', Buffer.from('x'))], { ttl: 0 });

      expect(fd.get('ttl')).toBe('0');
    });
  });

  describe('assertions — states a correct caller cannot reach', () => {
    it('refuses content the pipelines cannot have produced, naming the path', async () => {
      const files = [file('specific/path/file.txt', 'a string' as never)];

      await expect(createDeployBody(files)).rejects.toThrow(ShipError);
      await expect(createDeployBody(files)).rejects.toThrow('specific/path/file.txt');
    });

    it('refuses a file with no checksum, naming the path', async () => {
      // Built inline: the helper above DEFAULTS `md5`, so passing `undefined`
      // through it produces a checksum and tests nothing.
      const files: StaticFile[] = [
        { path: 'missing.txt', content: Buffer.from('x'), size: 1, md5: undefined as never },
      ];

      await expect(createDeployBody(files)).rejects.toThrow('File missing md5 checksum');
      await expect(createDeployBody(files)).rejects.toThrow('missing.txt');
    });
  });
});
