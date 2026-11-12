/**
 * @file Subject: `src/shared/core/deploy-body.ts`, the deploy request bodies.
 *
 * A real `FormData` can be READ BACK, so every assertion below observes the
 * artifact the API will receive rather than the calls that built it.
 *
 * A file's content is a `Blob` on both platforms, so one builder sends them
 * all and the platform seam lives in how files are COLLECTED, not how they
 * are sent.
 */

import { openAsBlob } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const file = (path: string, content: string | Blob, md5 = MD5): StaticFile => ({
  path,
  content: typeof content === 'string' ? new Blob([content]) : content,
  size: 1,
  md5,
});

/** The `files[]` parts, as the API will see them. */
const filesOf = (fd: FormData) => fd.getAll('files[]') as File[];

/** The declaration's fields for a context, as a body carries them. */
const body = (context: Parameters<typeof deployFields>[1]) =>
  createDeployBody([file('f.txt', 'x')], deployFields([], context));

describe('deployManifest', () => {
  it('states every file by path, size and MD5, in order', () => {
    expect(
      deployManifest([
        { path: 'index.html', content: new Blob(['<p>']), size: 3, md5: 'a'.repeat(32) },
        { path: 'assets/app.js', content: new Blob(['1;']), size: 2, md5: 'b'.repeat(32) },
      ]),
    ).toEqual([
      { path: 'index.html', size: 3, md5: 'a'.repeat(32) },
      { path: 'assets/app.js', size: 2, md5: 'b'.repeat(32) },
    ]);
  });
});

describe('createDeployBody: the declaration', () => {
  describe('the files', () => {
    it('carries the deploy PATH as the filename, the whole wire contract', () => {
      // The API reads `File.name` and stores the file there, so a nested path
      // must survive verbatim. Captured on node 22 and bun 1.3:
      // `filename="assets/nested/app.css"`.
      const fd = createDeployBody(
        [file('index.html', '<html></html>'), file('assets/nested/app.css', 'body{}')],
        [],
      );

      expect(filesOf(fd).map((f) => f.name)).toEqual(['index.html', 'assets/nested/app.css']);
    });

    it('keeps the bytes', async () => {
      const fd = createDeployBody([file('index.html', '<h1>hi</h1>')], []);

      expect(await filesOf(fd)[0]!.text()).toBe('<h1>hi</h1>');
    });

    it('names a part by its deploy path, whatever the File it was picked as is called', async () => {
      const picked = new File(['from a file'], 'ignored.txt', { type: 'text/plain' });
      const [part] = filesOf(createDeployBody([file('site/page.txt', picked)], []));

      expect(part!.name).toBe('site/page.txt');
      expect(await part!.text()).toBe('from a file');
    });

    it('sends a file on disk under its deploy path, never its path on disk', async () => {
      // Node hands the pipeline the file itself (`fs.openAsBlob`). The name
      // is given to `append`: a `File` built around such a blob is named by
      // its disk path on Bun.
      const dir = await mkdtemp(join(tmpdir(), 'ship-body-'));
      try {
        await writeFile(join(dir, 'on-disk.css'), 'body{}');
        const onDisk = await openAsBlob(join(dir, 'on-disk.css'));
        const [part] = filesOf(createDeployBody([file('assets/app.css', onDisk)], []));

        expect(part!.name).toBe('assets/app.css');
        expect(await part!.text()).toBe('body{}');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('marks every part application/octet-stream, a typed File included', () => {
      // The API reads a file's type from its path and never from the part,
      // so a browser's guess about a `File` is not sent.
      const page = new File(['<p>'], 'index.html', { type: 'text/html; charset=utf-16' });
      const fd = createDeployBody([file('script.js', 'x'), file('index.html', page)], []);

      expect(filesOf(fd).map((f) => f.type)).toEqual([
        'application/octet-stream',
        'application/octet-stream',
      ]);
    });

    it('may carry none of the files, which a bare declaration is', () => {
      const manifest = deployManifest([file('a.txt', 'a')]);
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
        spa: true,
        build: true,
        prerender: true,
        buildCommand: 'make',
        outputDir: 'out',
        captcha: 'proof',
      }).map(([name]) => name);

      expect(names).toEqual([
        'manifest',
        'labels',
        'via',
        'password',
        'ttl',
        'spa',
        'build',
        'prerender',
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
      ['build', { build: true }, 'true'],
      ['prerender', { prerender: true }, 'true'],
      ['spa', { spa: true }, 'true'],
      ['buildCommand', { build: true, buildCommand: 'npm run build:site' }, 'npm run build:site'],
      ['outputDir', { build: true, outputDir: 'public' }, 'public'],
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
      ['build', { build: false }],
      ['prerender', { prerender: false }],
      ['spa', {}],
      ['spa', { spa: false }],
      ['buildCommand', { build: true }],
      ['outputDir', { build: true }],
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

    it("sends a build setting without the build flag: whether it may ride alone is the API's to say", () => {
      expect(body({ buildCommand: 'make' }).get('buildCommand')).toBe('make');
      expect(body({ outputDir: 'out' }).get('outputDir')).toBe('out');
    });
  });
});

describe('createFillBody: a fill', () => {
  it('carries the files and nothing else, since the declaration stated the rest', () => {
    const fd = createFillBody([file('a.txt', 'a'), file('nested/b.txt', 'b')]);

    expect(filesOf(fd).map((f) => f.name)).toEqual(['a.txt', 'nested/b.txt']);
    for (const [name] of deployFields([], { labels: ['a'], via: 'cli', ttl: 60 })) {
      expect(fd.has(name)).toBe(false);
    }
  });
});
