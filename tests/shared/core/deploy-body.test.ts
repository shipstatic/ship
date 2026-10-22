/**
 * @file Subject: `src/shared/core/deploy-body.ts`, the deploy request bodies.
 *
 * A real `FormData` can be READ BACK, so every assertion below observes the
 * artifact the API will receive rather than the calls that built it.
 *
 * Both platforms' content shapes run through the same rows — `Buffer` is
 * Node's, `Blob`/`File` are the browser's, because one builder takes all
 * three and the platform seam lives in how files are COLLECTED, not how they
 * are sent.
 */

import { ShipError } from '@shipstatic/types';
import { describe, expect, it } from 'vitest';
import {
  createDeployBody,
  createFillBody,
  deployFields,
  deployManifest,
} from '../../../src/shared/core/deploy-body';
import type { StaticFile } from '../../../src/shared/types';

const MD5 = 'c83301425b2ad1d496473a5ff3d9ecca';

/** A file the pipeline could plausibly have produced, on either platform. */
const file = (path: string, content: StaticFile['content'], md5 = MD5): StaticFile => ({
  path,
  content,
  size: 1,
  md5,
});

/** The `files[]` parts, as the API will see them. */
const filesOf = (fd: FormData) => fd.getAll('files[]') as File[];

/** The declaration's fields for a context, as a body carries them. */
const body = (context: Parameters<typeof deployFields>[1]) =>
  createDeployBody([file('f.txt', Buffer.from('x'))], deployFields([], context));

describe('deployManifest', () => {
  it('states every file by path, size and MD5, in order', () => {
    expect(
      deployManifest([
        { path: 'index.html', content: Buffer.from('<p>'), size: 3, md5: 'a'.repeat(32) },
        { path: 'assets/app.js', content: Buffer.from('1;'), size: 2, md5: 'b'.repeat(32) },
      ]),
    ).toEqual([
      { path: 'index.html', size: 3, md5: 'a'.repeat(32) },
      { path: 'assets/app.js', size: 2, md5: 'b'.repeat(32) },
    ]);
  });

  it('refuses a file with no MD5, naming the path', () => {
    // Built inline: the helper above DEFAULTS `md5`, so passing `undefined`
    // through it produces one and tests nothing.
    const files: StaticFile[] = [
      { path: 'missing.txt', content: Buffer.from('x'), size: 1, md5: undefined as never },
    ];

    expect(() => deployManifest(files)).toThrow('MD5 missing for file: missing.txt');
  });
});

describe('createDeployBody: the declaration', () => {
  describe('the files', () => {
    it('carries the deploy PATH as the filename, the whole wire contract', () => {
      // The API reads `File.name` and stores the file there, so a nested path
      // must survive verbatim. Captured on node 22 and bun 1.3:
      // `filename="assets/nested/app.css"`.
      const fd = createDeployBody(
        [
          file('index.html', Buffer.from('<html></html>')),
          file('assets/nested/app.css', Buffer.from('body{}')),
        ],
        [],
      );

      expect(filesOf(fd).map((f) => f.name)).toEqual(['index.html', 'assets/nested/app.css']);
    });

    it('keeps the bytes', async () => {
      const fd = createDeployBody([file('index.html', Buffer.from('<h1>hi</h1>'))], []);

      expect(await filesOf(fd)[0]!.text()).toBe('<h1>hi</h1>');
    });

    it('takes every content shape the two pipelines produce', async () => {
      const fd = createDeployBody(
        [
          file('buffer.txt', Buffer.from('from node')),
          file('blob.txt', new Blob(['from a blob'])),
          file('file.txt', new File(['from a file'], 'ignored.txt')),
        ],
        [],
      );

      const parts = filesOf(fd);
      expect(parts.map((f) => f.name)).toEqual(['buffer.txt', 'blob.txt', 'file.txt']);
      // The path wins over a File's own name — the pipeline decided the path.
      expect(await parts[2]!.text()).toBe('from a file');
    });

    it('marks every part application/octet-stream: the API derives the real type', () => {
      const fd = createDeployBody([file('script.js', Buffer.from('x'))], []);

      expect(filesOf(fd)[0]!.type).toBe('application/octet-stream');
    });

    it('may carry none of the files, which a bare declaration is', () => {
      const manifest = deployManifest([file('a.txt', Buffer.from('a'))]);
      const fd = createDeployBody([], deployFields(manifest));

      expect(filesOf(fd)).toHaveLength(0);
      expect(JSON.parse(fd.get('manifest') as string)).toEqual(manifest);
    });
  });

  describe('the fields beside the files', () => {
    it('opens with the manifest, then each option in a fixed order', () => {
      const names = deployFields([], {
        labels: ['a'],
        via: 'cli',
        password: 'secret123',
        ttl: 60,
        flags: { build: true, buildCommand: 'make', outputDir: 'out' },
        captcha: 'proof',
      }).map(([name]) => name);

      expect(names).toEqual([
        'manifest',
        'labels',
        'via',
        'password',
        'ttl',
        'build',
        'buildCommand',
        'outputDir',
        'captcha',
      ]);
    });

    it.each([
      ['labels', { labels: ['production', 'v1.0.0'] }, JSON.stringify(['production', 'v1.0.0'])],
      ['via', { via: 'cli' as const }, 'cli'],
      ['password', { password: 'secret123' }, 'secret123'],
      ['ttl', { ttl: 3600 }, '3600'],
      ['build', { flags: { build: true } }, 'true'],
      ['prerender', { flags: { prerender: true } }, 'true'],
      ['spa', { spa: false }, 'false'],
      [
        'buildCommand',
        { flags: { build: true, buildCommand: 'npm run build:site' } },
        'npm run build:site',
      ],
      ['outputDir', { flags: { build: true, outputDir: 'public' } }, 'public'],
      ['captcha', { captcha: 'recaptcha-proof' }, 'recaptcha-proof'],
    ])('sends %s when it is given', (field, context, expected) => {
      expect(body(context).get(field)).toBe(expected);
    });

    it.each([
      ['labels', {}],
      ['labels', { labels: [] }],
      ['via', {}],
      ['password', {}],
      ['ttl', {}],
      ['build', { flags: { build: false } }],
      ['prerender', { flags: { prerender: false } }],
      ['spa', {}],
      ['spa', { spa: true }],
      ['buildCommand', { flags: { build: true } }],
      ['outputDir', { flags: { build: true } }],
      ['captcha', {}],
    ])('omits %s when it is absent or off', (field, context) => {
      expect(body(context).has(field)).toBe(false);
    });

    it('sends ttl: 0 rather than dropping it, so the caller hears why', () => {
      // `!== undefined`, not truthiness. Zero is out of range and the shared
      // rule refuses it by name; a truthiness test would drop it silently and
      // deploy forever instead.
      expect(body({ ttl: 0 }).get('ttl')).toBe('0');
    });

    it('carries no checksums field: the manifest states each digest once, by path', () => {
      expect(body({}).has('checksums')).toBe(false);
    });
  });

  describe('assertions — states a correct caller cannot reach', () => {
    it('refuses content the pipelines cannot have produced, naming the path', () => {
      const files = [file('specific/path/file.txt', 'a string' as never)];

      expect(() => createDeployBody(files, [])).toThrow(ShipError);
      expect(() => createDeployBody(files, [])).toThrow('specific/path/file.txt');
    });
  });
});

describe('createFillBody: a fill', () => {
  it('carries the files and nothing else, since the declaration stated the rest', () => {
    const fd = createFillBody([
      file('a.txt', Buffer.from('a')),
      file('nested/b.txt', Buffer.from('b')),
    ]);

    expect(filesOf(fd).map((f) => f.name)).toEqual(['a.txt', 'nested/b.txt']);
    for (const [name] of deployFields([], { labels: ['a'], via: 'cli', ttl: 60 })) {
      expect(fd.has(name)).toBe(false);
    }
  });
});
