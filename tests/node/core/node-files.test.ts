/**
 * @file Subject: `src/node/core/node-files.ts` — `processFilesForNode` on
 * REAL temp filesystems. Nothing here can be faked into passing.
 *
 * Until 2026-07-27 this file installed a file-scoped `vi.mock('fs')` /
 * `vi.mock('path')` with ~190 lines of hand-rolled fake — the apparatus that
 * kept a `basePath` option that never existed green for months (the fake's
 * `path.relative` carried the expected answers for the test's own inputs).
 * The real-filesystem tier lived beside it as `node-files-walk.test.ts`
 * because `vi.mock` cannot be scoped to a describe. De-mocking dissolved the
 * split: one mirror file, zero filesystem mocking, real md5 digests.
 *
 * Ported honestly rather than literally — three mocked scenarios have no
 * real-filesystem equivalent and are deliberately gone:
 * - backslash-separated INPUT paths (`folder\\sub\\file`): a POSIX filesystem
 *   cannot host them; separator handling is pinned by the fast-check
 *   properties in `path.cross-env.test.ts`, and real Windows behaviour is
 *   the flagged Windows-runner decision (F8).
 * - the statSync call-count choreography ("throw a ShipError on call 3"):
 *   ShipError pass-through is proven by every exact-message validation test.
 * - a thrown STRING from readFileSync: same wrapping arm as the real EACCES
 *   case below, which exercises it against a genuine permission error.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processFilesForNode } from '../../../src/node/core/node-files';
import { __setTestEnvironment } from '../../../src/shared/lib/env';
import { FREE_PLAN_LIMITS, LIMITS_WITHOUT_BLOCKLIST } from '../../fixtures/builders';

let root: string;

/** Writes a real tree. Keys are POSIX-relative paths; values are contents. */
function writeTree(spec: Record<string, string>): void {
  for (const [rel, content] of Object.entries(spec)) {
    const full = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

/** Absolute path under the temp root. */
const at = (rel: string) => path.join(root, ...rel.split('/'));

const pathsOf = (files: Array<{ path: string }>) => files.map((f) => f.path).sort();

const MD5_HEX = /^[0-9a-f]{32}$/;

/** A home page, which every deployment has at its root. */
const HOME = '<html></html>';

const NO_INDEX =
  "There's no index.html at the top of your site. It's the page visitors see first, so your site needs one.";

/** Runs `fn` with the working directory switched — for the cwd-relative contract. */
async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
}

beforeEach(() => {
  // realpath: macOS tmpdir is a symlink (/var → /private/var); resolving up
  // front keeps every derived path on one canonical form.
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ship-node-files-')));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  __setTestEnvironment(null);
});

describe('processFilesForNode', () => {
  describe('environment guard', () => {
    it('throws ShipError.business outside a Node environment', async () => {
      __setTestEnvironment('browser');
      await expect(processFilesForNode([root], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        'processFilesForNode can only be called in Node.js environment.',
      );
    });
  });

  describe('default path flattening', () => {
    it('reads real bytes and attaches a real md5 and byte-accurate size', async () => {
      writeTree({ 'project/index.html': HOME, 'project/hello.txt': 'hello' });

      const result = await processFilesForNode(
        [at('project/index.html'), at('project/hello.txt')],
        {},
        FREE_PLAN_LIMITS,
      );

      expect(result).toHaveLength(2);
      const hello = result.find((f) => f.path === 'hello.txt');
      expect(hello?.content).toEqual(Buffer.from('hello'));
      expect(hello?.size).toBe(5);
      // The digest of bytes this test wrote: a truncated read cannot pass.
      expect(hello?.md5).toBe('5d41402abc4b2a76b9719d911017c592');
    });

    it('scans directories recursively, stripping the directory itself', async () => {
      writeTree({
        'dir/index.html': HOME,
        'dir/file1.txt': 'content1',
        'dir/file2.txt': 'content2',
        'dir/subdir/file3.txt': 'content3',
      });

      const result = await processFilesForNode([at('dir')], {}, FREE_PLAN_LIMITS);

      expect(pathsOf(result)).toEqual(['file1.txt', 'file2.txt', 'index.html', 'subdir/file3.txt']);
      expect(result.every((f) => MD5_HEX.test(f.md5 ?? ''))).toBe(true);
    });

    it('strips a deeply nested common parent by default', async () => {
      writeTree({
        'nested/asdf/index.html': HOME,
        'nested/asdf/README.md': 'read me',
        'nested/asdf/css/styles.css': 'css',
        'nested/asdf/js/dark-mode': 'js',
      });

      const result = await processFilesForNode([at('nested/asdf')], {}, FREE_PLAN_LIMITS);

      expect(pathsOf(result)).toEqual([
        'README.md',
        'css/styles.css',
        'index.html',
        'js/dark-mode',
      ]);
    });

    it('keeps subdirectory structure below the stripped parent', async () => {
      writeTree({
        'parent/index.html': HOME,
        'parent/sub1/file1.txt': 'content1',
        'parent/sub1/file2.txt': 'content2',
        'parent/sub2/file3.txt': 'content3',
      });

      const result = await processFilesForNode([at('parent')], {}, FREE_PLAN_LIMITS);

      expect(pathsOf(result)).toEqual([
        'index.html',
        'sub1/file1.txt',
        'sub1/file2.txt',
        'sub2/file3.txt',
      ]);
    });
  });

  describe('pathDetect: false — structure preserved verbatim', () => {
    it('keeps every nested path of a typical web app', async () => {
      writeTree({
        'index.html': '<!DOCTYPE html>',
        'assets/js/bundle.js': 'console.log("bundle");',
        'assets/css/main.css': 'body { margin: 0 }',
        'images/logo.png': 'fake-png-data',
        'components/ui/forms/input.tsx': 'export default {};',
      });

      const files = await processFilesForNode([root], { pathDetect: false }, FREE_PLAN_LIMITS);

      expect(pathsOf(files)).toEqual([
        'assets/css/main.css',
        'assets/js/bundle.js',
        'components/ui/forms/input.tsx',
        'images/logo.png',
        'index.html',
      ]);
    });

    it('does not flatten a Vite assets folder', async () => {
      // The original regression, and the reason five files used to exist:
      // Vite emits every hashed asset into one `assets/` directory, and
      // flattening them broke every `/assets/...` reference in index.html.
      writeTree({
        'dist/index.html': '<link rel="stylesheet" href="/assets/index-8ac629b0.css">',
        'dist/assets/index-8ac629b0.css': '/* Vite CSS */',
        'dist/assets/index-f1e2d3c4.js': '// Vite JS bundle',
        'dist/assets/vue-logo-a1b2c3d4.png': 'png-data',
        'dist/vite.svg': '<svg>',
      });

      const files = await processFilesForNode(
        [at('dist')],
        { pathDetect: false },
        FREE_PLAN_LIMITS,
      );

      expect(pathsOf(files)).toEqual([
        'assets/index-8ac629b0.css',
        'assets/index-f1e2d3c4.js',
        'assets/vue-logo-a1b2c3d4.png',
        'index.html',
        'vite.svg',
      ]);
    });

    it('preserves a React build exactly', async () => {
      writeTree({
        'build/index.html': '<!DOCTYPE html>',
        'build/static/css/main.abc123.css': '.App {}',
        'build/static/js/main.def456': 'React.render();',
        'build/static/media/logo.789xyz.png': 'PNG_DATA',
        'build/manifest.json': '{"name": "test"}',
      });

      const files = await processFilesForNode(
        [at('build')],
        { pathDetect: false },
        FREE_PLAN_LIMITS,
      );

      expect(pathsOf(files)).toEqual([
        'index.html',
        'manifest.json',
        'static/css/main.abc123.css',
        'static/js/main.def456',
        'static/media/logo.789xyz.png',
      ]);
    });

    it('does not truncate deep nesting', async () => {
      writeTree({
        'index.html': HOME,
        'src/components/ui/forms/inputs/text/TextInput.tsx': 'export const TextInput = () => {};',
        'src/utils/api/endpoints/v1/users.ts': 'export const userAPI = {};',
      });

      const files = await processFilesForNode([root], { pathDetect: false }, FREE_PLAN_LIMITS);

      expect(pathsOf(files)).toEqual([
        'index.html',
        'src/components/ui/forms/inputs/text/TextInput.tsx',
        'src/utils/api/endpoints/v1/users.ts',
      ]);
    });

    it('preserves every extension across mixed file types', async () => {
      writeTree({
        'index.html': HOME,
        'public/favicon.ico': 'ico-data',
        'public/manifest.json': '{"name":"test"}',
        'public/robots.txt': 'User-agent: *',
        'src/styles/globals.scss': '$primary: blue;',
        'src/app.tsx': 'import React from "react";',
        'docs/README.md': '# Documentation',
        'docs/api.yml': 'openapi: 3.0.0',
      });

      const files = await processFilesForNode([root], { pathDetect: false }, FREE_PLAN_LIMITS);

      expect(pathsOf(files)).toEqual([
        'docs/README.md',
        'docs/api.yml',
        'index.html',
        'public/favicon.ico',
        'public/manifest.json',
        'public/robots.txt',
        'src/app.tsx',
        'src/styles/globals.scss',
      ]);
    });

    it('gives each explicitly listed file a path relative to its own directory', async () => {
      writeTree({
        'some/deep/path/single-file.txt': 'standalone',
        'another/different/path/other-file.txt': 'other',
        'root-file.txt': 'root',
        'index.html': HOME,
      });

      const files = await processFilesForNode(
        [
          at('some/deep/path/single-file.txt'),
          at('another/different/path/other-file.txt'),
          at('root-file.txt'),
          at('index.html'),
        ],
        { pathDetect: false },
        FREE_PLAN_LIMITS,
      );

      expect(pathsOf(files)).toEqual([
        'index.html',
        'other-file.txt',
        'root-file.txt',
        'single-file.txt',
      ]);
    });

    it('preserves multiple directory structures across multiple inputs', async () => {
      writeTree({
        'frontend/dist/index.html': 'frontend',
        'frontend/dist/app': 'frontend app',
        'backend/build/server': 'backend server',
        'backend/build/config.json': '{"port": 3000}',
        'docs/api.md': '# API Documentation',
      });

      const files = await processFilesForNode(
        [at('frontend/dist'), at('backend/build'), at('docs/api.md')],
        { pathDetect: false },
        FREE_PLAN_LIMITS,
      );

      expect(pathsOf(files)).toEqual(['api.md', 'app', 'config.json', 'index.html', 'server']);
    });
  });

  describe('pathDetect: true — only a shared prefix is stripped', () => {
    it('leaves a tree with no common subdirectory untouched', async () => {
      // `index.html` sits at the root, so the common parent IS the root and
      // there is nothing to strip. Enabling pathDetect must not flatten.
      writeTree({
        'index.html': '<html></html>',
        'assets/js/app.js': 'console.log("app");',
        'assets/css/styles.css': 'body { margin: 0 }',
      });

      const files = await processFilesForNode([root], { pathDetect: true }, FREE_PLAN_LIMITS);

      expect(pathsOf(files)).toEqual(['assets/css/styles.css', 'assets/js/app.js', 'index.html']);
    });

    it('strips the shared build directory when every file is under it', async () => {
      writeTree({
        'dist/index.html': '<html></html>',
        'dist/assets/app.js': 'console.log("app");',
      });

      const files = await processFilesForNode([at('dist')], { pathDetect: true }, FREE_PLAN_LIMITS);

      expect(pathsOf(files)).toEqual(['assets/app.js', 'index.html']);
    });
  });

  describe('relative inputs and the working directory', () => {
    it('resolves cwd-relative inputs (the CLI contract: `ship ./dist`)', async () => {
      writeTree({ 'dist/index.html': '<html></html>', 'dist/assets/app.js': 'js' });

      const files = await withCwd(root, () =>
        processFilesForNode(['./dist'], {}, FREE_PLAN_LIMITS),
      );

      expect(pathsOf(files)).toEqual(['assets/app.js', 'index.html']);
    });

    it('resolves parent-directory references', async () => {
      writeTree({ 'index.html': HOME, 'parent-file.txt': 'Parent file', 'child/.keep': 'x' });

      const files = await withCwd(at('child'), () =>
        processFilesForNode(
          ['../index.html', '../parent-file.txt'],
          { pathDetect: false },
          FREE_PLAN_LIMITS,
        ),
      );

      expect(pathsOf(files)).toEqual(['index.html', 'parent-file.txt']);
    });

    it('deploys from a directory whose PARENT is dot-prefixed (`ship ./dist` inside .app/)', async () => {
      // Parent directory names above the upload root must not be filtered.
      writeTree({
        '.app/dist/index.html': '<html>hello</html>',
        '.app/dist/style.css': 'body {}',
      });

      const files = await withCwd(at('.app'), () =>
        processFilesForNode(['./dist'], {}, FREE_PLAN_LIMITS),
      );

      expect(pathsOf(files)).toEqual(['index.html', 'style.css']);
    });

    it('deploys from a directory with node_modules in the PARENT path', async () => {
      // Unbuilt markers above the upload root must not trigger rejection.
      writeTree({
        'node_modules/my-tool/dist/index.html': '<html>hello</html>',
        'node_modules/my-tool/dist/app.js': 'console.log("hi")',
      });

      const files = await withCwd(at('node_modules/my-tool'), () =>
        processFilesForNode(['./dist'], {}, FREE_PLAN_LIMITS),
      );

      expect(pathsOf(files)).toEqual(['app.js', 'index.html']);
    });
  });

  describe('unbuilt project detection', () => {
    it('rejects a directory containing node_modules', async () => {
      writeTree({
        'myproject/index.html': '<html></html>',
        'myproject/node_modules/pkg/index.js': 'x',
        'myproject/src/app.js': 'x',
      });

      await expect(processFilesForNode([at('myproject')], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        `"${at('myproject')}" is a project that isn't built yet: it has node_modules. Build it, then publish the folder the build makes, like dist.`,
      );
    });

    it('rejects a directory containing package.json', async () => {
      writeTree({
        'myproject/index.html': '<html></html>',
        'myproject/package.json': '{}',
      });

      await expect(processFilesForNode([at('myproject')], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        `"${at('myproject')}" is a project that isn't built yet: it has package.json. Build it, then publish the folder the build makes, like dist.`,
      );
    });

    it('accepts a build output directory without markers', async () => {
      writeTree({ 'dist/index.html': '<html>' });

      const result = await processFilesForNode([at('dist')], {}, FREE_PLAN_LIMITS);
      expect(result).toHaveLength(1);
    });
  });

  describe('the home page', () => {
    it('refuses a directory with no index.html at its root', async () => {
      writeTree({ 'site/about.html': HOME, 'site/app.js': 'js' });

      await expect(processFilesForNode([at('site')], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        NO_INDEX,
      );
    });

    it('names the folder that holds it when the site sits one folder down', async () => {
      writeTree({
        'project/dist/index.html': HOME,
        'project/dist/app.js': 'js',
        'project/README.md': 'read me',
      });

      await expect(processFilesForNode([at('project')], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        `${NO_INDEX} There's one in dist/. If that's your site, publish that folder instead.`,
      );
    });
  });

  describe('junk and hidden-file filtering', () => {
    it.each([
      ['.DS_Store', 'real.txt'],
      ['Thumbs.db', 'image.png'],
      ['desktop.ini', 'real.txt'],
    ])('filters %s from a walked directory', async (junkName, kept) => {
      writeTree({
        'folder/index.html': HOME,
        [`folder/${junkName}`]: 'junk',
        [`folder/${kept}`]: 'content',
      });

      const result = await processFilesForNode([at('folder')], {}, FREE_PLAN_LIMITS);

      expect(pathsOf(result)).toEqual([kept, 'index.html'].sort());
    });

    it.each([
      ['__MACOSX', '__MACOSX/._hidden'],
      ['.Trashes', '.Trashes/item'],
    ])('filters the %s junk directory', async (dirName, junkPath) => {
      writeTree({
        'archive/index.html': HOME,
        [`archive/${junkPath}`]: 'junk',
        'archive/real.txt': 'content',
      });

      const result = await processFilesForNode([at('archive')], {}, FREE_PLAN_LIMITS);

      expect(pathsOf(result)).toEqual(['index.html', 'real.txt']);
      expect(result.some((f) => f.path.includes(dirName))).toBe(false);
    });

    it('filters hidden dotfiles even as explicit inputs', async () => {
      writeTree({
        '.env': 'SECRET=value',
        '.gitignore': 'node_modules',
        'index.html': HOME,
        'normal.txt': 'content',
      });

      const result = await processFilesForNode(
        [at('.env'), at('.gitignore'), at('index.html'), at('normal.txt')],
        {},
        FREE_PLAN_LIMITS,
      );

      expect(pathsOf(result)).toEqual(['index.html', 'normal.txt']);
    });

    it('filters junk within the upload root while keeping content', async () => {
      writeTree({
        'dist/index.html': '<html>hello</html>',
        'dist/.DS_Store': 'junk',
        'dist/.env': 'SECRET=x',
      });

      const result = await processFilesForNode([at('dist')], {}, FREE_PLAN_LIMITS);

      expect(pathsOf(result)).toEqual(['index.html']);
    });

    it('preserves content when deploying FROM a dot-folder root (e.g. .output/)', async () => {
      // The dot-folder root is stripped by common-parent removal, so content
      // paths carry no dot prefix and survive the filter.
      writeTree({
        '.output/index.html': '<html>Hello</html>',
        '.output/assets/style.css': 'body {}',
      });

      const result = await processFilesForNode([at('.output')], {}, FREE_PLAN_LIMITS);

      expect(pathsOf(result)).toEqual(['assets/style.css', 'index.html']);
    });

    it('preserves content under dot-prefixed ANCESTOR dirs after root stripping (the n8n tree)', async () => {
      // n8n writes to a temp dir preserving the absolute source structure:
      // tmpdir/home/node/.n8n-files/dist/… — common-root stripping runs
      // before junk filtering, so `.n8n-files` never reaches the filter.
      writeTree({
        'tmpdir/home/node/.n8n-files/dist/index.html': '<html>Hello</html>',
        'tmpdir/home/node/.n8n-files/dist/assets/style.css': 'body {}',
      });

      const result = await processFilesForNode([at('tmpdir')], {}, FREE_PLAN_LIMITS);

      expect(pathsOf(result)).toEqual(['assets/style.css', 'index.html']);
    });
  });

  describe('validation through the pipeline', () => {
    it.each(['virus.exe', 'installer.msi'])('rejects the blocked extension of %s', async (name) => {
      writeTree({ [name]: 'payload' });

      await expect(processFilesForNode([at(name)], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        'has an extension that is not allowed',
      );
    });

    it('refuses only what the DELIVERED list names, not a compiled-in one', async () => {
      // The blocklist is the platform's and arrives via `GET /limits`. A client
      // that shipped its own copy would refuse this file, which is the exact
      // failure mode the list was moved server-side to prevent: a pinned client
      // enforcing a policy the platform has moved on from.
      writeTree({ 'index.html': HOME, 'virus.exe': 'payload' });

      const limits = { ...FREE_PLAN_LIMITS, blockedExtensions: ['dmg'] };
      await expect(
        processFilesForNode([at('index.html'), at('virus.exe')], {}, limits),
      ).resolves.toHaveLength(2);
    });

    it('checks nothing when the API sent no list — fail open, never guess', async () => {
      // An API predating `blockedExtensions` sends none. Absence means "no
      // client-side check", never "an empty policy": the deploy proceeds and
      // the API refuses the file at the boundary, where refusal belongs.
      writeTree({ 'index.html': HOME, 'virus.exe': 'payload' });

      await expect(
        processFilesForNode([at('index.html'), at('virus.exe')], {}, LIMITS_WITHOUT_BLOCKLIST),
      ).resolves.toHaveLength(2);
    });

    it.each(['file?.txt', 'file#anchor.txt', 'file<tag>.txt'])(
      'rejects URL-breaking characters in %s',
      async (name) => {
        writeTree({ [name]: 'content' });

        await expect(processFilesForNode([at(name)], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
          'unsafe characters',
        );
      },
    );

    it.each(['file(1).json', 'file[slug].js', 'file{id}.txt', 'file;semi.txt'])(
      'allows %s — characters that survive the URL round-trip',
      async (name) => {
        writeTree({ 'index.html': HOME, [name]: 'content' });

        const result = await processFilesForNode(
          [at('index.html'), at(name)],
          {},
          FREE_PLAN_LIMITS,
        );
        expect(result).toHaveLength(2);
      },
    );

    it('rejects Windows reserved names', async () => {
      writeTree({ 'CON.txt': 'reserved' });

      await expect(processFilesForNode([at('CON.txt')], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        'reserved system name',
      );
    });

    it('rejects filenames ending with dots', async () => {
      writeTree({ 'file.': 'trailing dot' });

      await expect(processFilesForNode([at('file.')], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        'cannot end with dots',
      );
    });

    it('allows ordinary web extensions', async () => {
      writeTree({ 'index.html': '<html>', 'style.css': 'body {}', 'data.json': '{}' });

      const result = await processFilesForNode(
        [at('index.html'), at('style.css'), at('data.json')],
        {},
        FREE_PLAN_LIMITS,
      );
      expect(result).toHaveLength(3);
    });

    it('allows dots inside filenames and directory names', async () => {
      writeTree({
        'index.html': HOME,
        'file.test.spec.ts': 'content',
        'folder.name/file.txt': 'nested',
      });

      const result = await processFilesForNode(
        [at('index.html'), at('file.test.spec.ts'), at('folder.name/file.txt')],
        {},
        FREE_PLAN_LIMITS,
      );
      expect(result).toHaveLength(3);
    });
  });

  describe('plan limits through the pipeline', () => {
    const limits = { maxFileSize: 100, maxFilesCount: 5, maxTotalSize: 150 };
    // A one-byte home page, which every deployment has, counted below.
    const page = { 'index.html': 'x' };

    it('rejects a single file over maxFileSize', async () => {
      writeTree({ 'large.txt': 'x'.repeat(101) });

      await expect(processFilesForNode([at('large.txt')], {}, limits)).rejects.toThrow('too large');
    });

    it('accepts a file exactly at maxFileSize', async () => {
      writeTree({ ...page, 'exact.txt': 'x'.repeat(100) });

      const result = await processFilesForNode([at('index.html'), at('exact.txt')], {}, limits);
      expect(result.find((f) => f.path === 'exact.txt')?.size).toBe(100);
    });

    it('rejects a cumulative size over maxTotalSize', async () => {
      writeTree({ 'file1.txt': 'x'.repeat(80), 'file2.txt': 'x'.repeat(80) });

      await expect(
        processFilesForNode([at('file1.txt'), at('file2.txt')], {}, limits),
      ).rejects.toThrow('Files add up to');
    });

    it('accepts a cumulative size exactly at maxTotalSize', async () => {
      writeTree({ ...page, 'file1.txt': 'x'.repeat(75), 'file2.txt': 'x'.repeat(74) });

      const result = await processFilesForNode(
        [at('index.html'), at('file1.txt'), at('file2.txt')],
        {},
        limits,
      );
      expect(result).toHaveLength(3);
    });

    it('rejects more results than maxFilesCount', async () => {
      const spec: Record<string, string> = {};
      for (let i = 1; i <= 6; i++) spec[`file${i}.txt`] = String(i);
      writeTree(spec);

      await expect(
        processFilesForNode(
          Object.keys(spec).map((rel) => at(rel)),
          {},
          { ...limits, maxTotalSize: 10_000 },
        ),
      ).rejects.toThrow('Too many files (6). Maximum 5 files allowed.');
    });

    it('accepts exactly maxFilesCount results, with empty files not counting', async () => {
      writeTree({
        'empty1.txt': '',
        'empty2.txt': '',
        'index.html': 'a',
        'real.txt': 'b',
      });

      const result = await processFilesForNode(
        [at('empty1.txt'), at('empty2.txt'), at('index.html'), at('real.txt')],
        {},
        { maxFileSize: 100, maxFilesCount: 2, maxTotalSize: 1000 },
      );

      expect(result).toHaveLength(2);
      expect(result.every((f) => f.size > 0)).toBe(true);
    });
  });

  describe('input shapes and file names', () => {
    it('handles Unicode names across scripts', async () => {
      writeTree({
        '测试文件.txt': 'Chinese file',
        'папка/файл': 'Cyrillic file',
        'مجلد/ملف.html': 'Arabic file',
        '🚀folder/rocket.css': 'Emoji folder',
        'café/menu.json': 'Accented folder',
        'index.html': HOME,
      });

      const result = await processFilesForNode(
        [
          at('index.html'),
          at('测试文件.txt'),
          at('папка/файл'),
          at('مجلد/ملف.html'),
          at('🚀folder/rocket.css'),
          at('café/menu.json'),
        ],
        {},
        FREE_PLAN_LIMITS,
      );

      expect(pathsOf(result)).toEqual([
        'index.html',
        'menu.json',
        'rocket.css',
        'файл',
        'ملف.html',
        '测试文件.txt',
      ]);
    });

    it('handles extensionless files', async () => {
      writeTree({
        'index.html': HOME,
        Dockerfile: 'FROM node:22',
        Makefile: 'all:',
        LICENSE: 'MIT',
        README: 'hi',
      });

      const result = await processFilesForNode(
        [at('index.html'), at('Dockerfile'), at('Makefile'), at('LICENSE'), at('README')],
        {},
        FREE_PLAN_LIMITS,
      );

      expect(result).toHaveLength(5);
    });

    it('handles spaces, dashes, underscores, and many dots', async () => {
      writeTree({
        'file with spaces.txt': 'a',
        'file-with-dashes': 'b',
        'file_with_underscores.css': 'c',
        'file.with.many.dots.html': 'd',
        'index.html': HOME,
      });

      const result = await processFilesForNode(
        [
          at('index.html'),
          at('file with spaces.txt'),
          at('file-with-dashes'),
          at('file_with_underscores.css'),
          at('file.with.many.dots.html'),
        ],
        {},
        FREE_PLAN_LIMITS,
      );

      expect(result).toHaveLength(5);
    });

    it('refuses empty directories: there is nothing to publish', async () => {
      fs.mkdirSync(at('empty-dir'));
      fs.mkdirSync(at('another-empty'));

      await expect(
        processFilesForNode([at('empty-dir'), at('another-empty')], {}, FREE_PLAN_LIMITS),
      ).rejects.toThrow('There are no files to publish.');
    });

    it('skips empty files entirely', async () => {
      writeTree({ 'index.html': HOME, 'empty.txt': '', 'another-empty': '', 'zero.html': '' });

      const result = await processFilesForNode(
        [at('index.html'), at('empty.txt'), at('another-empty'), at('zero.html')],
        {},
        FREE_PLAN_LIMITS,
      );
      expect(pathsOf(result)).toEqual(['index.html']);
    });

    it('refuses an empty index.html as empty: a published file is never empty', async () => {
      writeTree({ 'index.html': '', 'app.js': 'js' });

      await expect(
        processFilesForNode([at('index.html'), at('app.js')], {}, FREE_PLAN_LIMITS),
      ).rejects.toThrow(
        "The index.html at the top of your site is empty. It's the page visitors see first, so it needs content.",
      );
    });

    it('mixes file and directory inputs', async () => {
      writeTree({
        'single-file.txt': 'Single file',
        'directory/file1': 'Dir file 1',
        'directory/file2.css': 'Dir file 2',
        'another-single.html': 'Another single',
        'index.html': HOME,
      });

      const result = await processFilesForNode(
        [at('single-file.txt'), at('directory'), at('another-single.html'), at('index.html')],
        {},
        FREE_PLAN_LIMITS,
      );

      expect(pathsOf(result)).toEqual([
        'another-single.html',
        'file1',
        'file2.css',
        'index.html',
        'single-file.txt',
      ]);
    });

    it('refuses files from different directories that land on one path', async () => {
      // Files named one by one keep their basenames, so three config.json from
      // three folders are one deploy path, which the API refuses in these words.
      writeTree({
        'dir1/config.json': '{"env": "dir1"}',
        'dir2/config.json': '{"env": "dir2"}',
        'index.html': HOME,
      });

      await expect(
        processFilesForNode(
          [at('dir1/config.json'), at('dir2/config.json'), at('index.html')],
          {},
          FREE_PLAN_LIMITS,
        ),
      ).rejects.toThrow('The file config.json appears twice.');
    });

    it('is line-ending agnostic', async () => {
      writeTree({
        'unix.txt': 'line1\nline2',
        'windows.txt': 'line1\r\nline2',
        'oldmac.txt': 'line1\rline2',
        'index.html': HOME,
      });

      const result = await processFilesForNode(
        [at('unix.txt'), at('windows.txt'), at('oldmac.txt'), at('index.html')],
        {},
        FREE_PLAN_LIMITS,
      );

      expect(result).toHaveLength(4);
      for (const file of result) {
        expect(file.content).toBeInstanceOf(Buffer);
        expect(file.size).toBeGreaterThan(0);
      }
    });

    it('handles 100 files in one call', async () => {
      const spec: Record<string, string> = {};
      for (let i = 0; i < 99; i++) {
        spec[`file-${String(i).padStart(3, '0')}.txt`] = `Content of file ${i}`;
      }
      spec['index.html'] = HOME;
      writeTree(spec);

      const result = await processFilesForNode(
        Object.keys(spec).map((rel) => at(rel)),
        {},
        FREE_PLAN_LIMITS,
      );

      expect(result).toHaveLength(100);
      expect(result.every((f) => MD5_HEX.test(f.md5 ?? ''))).toBe(true);
    });

    it('handles concurrent batches without interference', async () => {
      const spec: Record<string, string> = {};
      for (let i = 0; i < 50; i++) spec[`concurrent-${i}.txt`] = `Concurrent file ${i}`;
      writeTree({ ...spec, 'index.html': HOME });
      const all = Object.keys(spec).map((rel) => at(rel));
      const home = at('index.html');

      const results = await Promise.all([
        processFilesForNode([home, ...all.slice(0, 17)], {}, FREE_PLAN_LIMITS),
        processFilesForNode([home, ...all.slice(17, 34)], {}, FREE_PLAN_LIMITS),
        processFilesForNode([home, ...all.slice(34, 50)], {}, FREE_PLAN_LIMITS),
      ]);

      expect(results.map((r) => r.length)).toEqual([18, 18, 17]);
    });

    it('handles very deep nesting and long filenames', async () => {
      const deep = `${Array(20).fill('dir').join('/')}/deep.txt`;
      const longName = `${'a'.repeat(200)}.txt`;
      writeTree({ [deep]: 'deep content', [longName]: 'long name', 'index.html': HOME });

      const result = await processFilesForNode(
        [at(deep), at(longName), at('index.html')],
        { pathDetect: false },
        FREE_PLAN_LIMITS,
      );

      expect(pathsOf(result)).toEqual([`${'a'.repeat(200)}.txt`, 'deep.txt', 'index.html']);
    });

    it('rejects nonexistent inputs', async () => {
      await expect(
        processFilesForNode([at('non-existent-file.txt')], {}, FREE_PLAN_LIMITS),
      ).rejects.toThrow();
    });
  });

  describe('symlinks', () => {
    it('walks through a symlink cycle exactly once — no hang, no duplicates', async () => {
      writeTree({ 'dir_a/index.html': HOME, 'dir_a/file1.txt': 'file1' });
      fs.mkdirSync(at('dir_a/sub'), { recursive: true });
      // sub/loop → dir_a: following it would recurse forever.
      fs.symlinkSync(at('dir_a'), at('dir_a/sub/loop'));

      const result = await processFilesForNode([at('dir_a')], {}, FREE_PLAN_LIMITS);

      expect(pathsOf(result)).toEqual(['file1.txt', 'index.html']);
    });

    it('visits a target reachable through two links only once', async () => {
      writeTree({ 'shared/file.txt': 'shared content', 'site/index.html': '<html>' });
      fs.symlinkSync(at('shared'), at('site/first'));
      fs.symlinkSync(at('shared'), at('site/second'));

      const result = await processFilesForNode([at('site')], {}, FREE_PLAN_LIMITS);

      // The realpath dedup admits the shared directory through ONE of the
      // links; the second resolves to an already-visited target.
      expect(result.filter((f) => f.path.endsWith('file.txt'))).toHaveLength(1);
    });
  });

  describe('filesystem errors', () => {
    // Root can read anything; the permission scenario cannot exist for it.
    it.skipIf(process.getuid?.() === 0)(
      'wraps an unreadable file into ShipError.file ("Failed to read file")',
      async () => {
        // A site the rules accept, so the pipeline reaches the read.
        writeTree({ 'index.html': HOME, 'locked.txt': 'cannot read me' });
        fs.chmodSync(at('locked.txt'), 0o000);

        await expect(
          processFilesForNode([at('index.html'), at('locked.txt')], {}, FREE_PLAN_LIMITS),
        ).rejects.toThrow('Failed to read file');
      },
    );
  });
});
