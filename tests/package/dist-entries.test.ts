/**
 * @file Package-artifact fence: consume `dist/` exactly the way a user does.
 *
 * Nothing verified the BUILT package before 2026-07-27 — a broken `exports`
 * map, a bad CJS interop shim, or a dts regression would have shipped silently,
 * and `@shipstatic/ship` is a Stable published package. `publint` and
 * `attw` (run by `pnpm check:package`) read the manifest; this reads the
 * artifact.
 *
 * Recorded artifact-tier exception in the integrity fence: it deliberately
 * imports `dist/`, not `src/` — that IS its subject.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const DIST = resolve(__dirname, '../../dist');
const require = createRequire(import.meta.url);

describe('built package entries', () => {
  it('emits every entry the exports map promises', () => {
    for (const file of [
      'index.js',
      'index.cjs',
      'index.d.ts',
      'index.d.cts',
      'browser.js',
      'browser.d.ts',
      'cli.cjs',
    ]) {
      expect(existsSync(resolve(DIST, file)), `dist/${file} is missing`).toBe(true);
    }
  });

  it('require() of the CJS entry yields a constructible Ship', () => {
    // The post-build shim reassigns module.exports to the class so
    // `const Ship = require('@shipstatic/ship')` works (the axios convention).
    const required = require(resolve(DIST, 'index.cjs'));

    expect(typeof required).toBe('function');
    expect(new required({ apiUrl: 'https://api.example.com' })).toBeDefined();
    // …while the named and default forms keep working alongside it.
    expect(required.Ship).toBe(required);
    expect(required.default).toBe(required);
    expect(required.ShipError).toBeDefined();
  });

  it('import() of the ESM entry yields a constructible Ship', async () => {
    const mod = await import(pathToFileURL(resolve(DIST, 'index.js')).href);

    expect(typeof mod.Ship).toBe('function');
    expect(new mod.Ship({ apiUrl: 'https://api.example.com' })).toBeDefined();
    expect(mod.default).toBe(mod.Ship);
  });

  it('the browser bundle loads and constructs', async () => {
    const mod = await import(pathToFileURL(resolve(DIST, 'browser.js')).href);

    expect(typeof mod.Ship).toBe('function');
    expect(mod.default).toBe(mod.Ship);
    expect(new mod.Ship({ token: `deploy-${'a'.repeat(32)}` })).toBeInstanceOf(mod.Ship);
  });

  it('bundles @shipstatic/types rather than depending on it', () => {
    // types is a devDependency, so a consumer does not install it — a runtime
    // reference to it in the artifact would be an unresolvable import.
    const required = require(resolve(DIST, 'index.cjs'));

    expect(required.ShipError).toBeDefined();
    expect(required.ErrorType?.Validation).toBe('validation_failed');
  });

  it('publishes the whole vocabulary and six names of its own, the same on every build', async () => {
    // Every name a consumer can import, compared whole: the `@shipstatic/types`
    // vocabulary, which reaches the entries through one star, and the six
    // names this package adds. A name joins the six when a consumer reads it,
    // and the transport, the resource factories and the helpers the pipeline
    // keeps to itself are no part of it. Compared whole, because a build that
    // drops one name of the vocabulary breaks the consumer that imports it.
    const own = [
      'Ship',
      'optimizeDeployPaths',
      'pluralize',
      'sitePaths',
      'unreadable',
      'validateFiles',
    ];
    const vocabulary = Object.keys(await import('@shipstatic/types'));
    const expected = [...vocabulary, ...own, 'default'].sort();
    const published = (mod: object) => Object.keys(mod).sort();

    expect(vocabulary.length).toBeGreaterThan(50);
    expect(published(await import(pathToFileURL(resolve(DIST, 'index.js')).href))).toEqual(
      expected,
    );
    expect(published(await import(pathToFileURL(resolve(DIST, 'browser.js')).href))).toEqual(
      expected,
    );
    expect(published(require(resolve(DIST, 'index.cjs')))).toEqual(expected);
  });

  it('@shipstatic/types is NEVER a runtime dependency', () => {
    // The manifest half of the same 2026-08-07 escape: tsup auto-externalizes
    // `dependencies`, so a types entry there flips the bundler from "inline
    // the vocabulary" to "leave an import a consumer cannot resolve" — the
    // exact mechanism that broke beta.16, via a version bump applied to the
    // wrong key. Bundling requires the pin to live in devDependencies alone.
    const pkg = require(resolve(DIST, '../package.json'));

    expect(pkg.dependencies).not.toHaveProperty('@shipstatic/types');
    expect(pkg.devDependencies).toHaveProperty('@shipstatic/types');
  });
});

/**
 * Which build a tool is handed, read from the manifest's own `exports` map.
 *
 * The package has two builds. One holds no filesystem code and runs wherever
 * `File`, `FormData` and `fetch` exist. The other adds paths, and imports
 * `fs`, so it loads only where Node's modules do. A tool states what it is by
 * its conditions, and a tool that states nothing must get the build that
 * cannot fail to load: only `node` selects the one that needs Node.
 *
 * The resolver below is the standard's own rule and nothing more: an object's
 * keys are tried in the order written, a key matches when the tool set that
 * condition or the key is `default`, and a string is the answer.
 */
type ExportsEntry = string | { [condition: string]: ExportsEntry };

function resolveExport(entry: ExportsEntry, conditions: string[]): string | undefined {
  if (typeof entry === 'string') return entry;
  for (const [condition, target] of Object.entries(entry)) {
    if (condition !== 'default' && !conditions.includes(condition)) continue;
    const resolved = resolveExport(target, conditions);
    if (resolved) return resolved;
  }
  return undefined;
}

const NO_FILESYSTEM = './dist/browser.js';
const NO_FILESYSTEM_TYPES = './dist/browser.d.ts';

describe('the exports map hands every tool a build it can load', () => {
  const root: ExportsEntry = require(resolve(DIST, '../package.json')).exports['.'];

  it.each([
    // What each tool sets is the tool's own documentation, written out.
    ['Node, an import', ['node', 'import'], './dist/index.js'],
    ['Node, a require', ['node', 'require'], './dist/index.cjs'],
    ['Bun', ['bun', 'node', 'import'], './dist/index.js'],
    ['Deno', ['deno', 'node', 'import'], './dist/index.js'],
    ['a bundler building for a browser', ['browser', 'import'], NO_FILESYSTEM],
    ['wrangler, for a Worker', ['workerd', 'worker', 'browser'], NO_FILESYSTEM],
    ['a Worker bundler that sets no browser condition', ['workerd', 'worker'], NO_FILESYSTEM],
    ['an edge runtime', ['edge-light', 'import'], NO_FILESYSTEM],
    ['a bundler that sets nothing of its own', ['import'], NO_FILESYSTEM],
    ['React Native', ['react-native', 'import'], NO_FILESYSTEM],
    // A tool that is both, a test runner in a browser environment under
    // Node, is handed the build every runtime can load.
    ['a tool that sets browser and node', ['browser', 'node', 'import'], NO_FILESYSTEM],
  ])('%s', (_tool, conditions, file) => {
    expect(resolveExport(root, conditions)).toBe(file);
  });

  it.each([
    ['TypeScript resolving as a bundler', ['types', 'import'], NO_FILESYSTEM_TYPES],
    ['TypeScript resolving as Node, an import', ['types', 'node', 'import'], './dist/index.d.ts'],
    ['TypeScript resolving as Node, a require', ['types', 'node', 'require'], './dist/index.d.cts'],
  ])('%s reads the types of the build it would load', (_tool, conditions, file) => {
    expect(resolveExport(root, conditions)).toBe(file);
  });

  describe('as the tools themselves resolve it', () => {
    // The table above reads the map by the standard's rule. These rows ask
    // the tools: Node in a process of its own, and TypeScript's resolver.
    const PACKAGE = resolve(DIST, '..');
    const node = (...args: string[]) =>
      execFileSync(process.execPath, args, { cwd: PACKAGE, encoding: 'utf-8' }).trim();

    it('Node resolves an import and a require to the build with paths', () => {
      expect(
        node('--input-type=module', '-e', "console.log(import.meta.resolve('@shipstatic/ship'))"),
      ).toBe(pathToFileURL(resolve(DIST, 'index.js')).href);
      expect(node('-e', "console.log(require.resolve('@shipstatic/ship'))")).toBe(
        resolve(DIST, 'index.cjs'),
      );
    });

    const resolutions: Array<[string, ts.ModuleResolutionKind, ts.ResolutionMode, string]> = [
      ['as a bundler', ts.ModuleResolutionKind.Bundler, ts.ModuleKind.ESNext, 'browser.d.ts'],
      ['as Node, an import', ts.ModuleResolutionKind.Node16, ts.ModuleKind.ESNext, 'index.d.ts'],
      ['as Node, a require', ts.ModuleResolutionKind.Node16, ts.ModuleKind.CommonJS, 'index.d.cts'],
    ];

    it.each(resolutions)(
      'TypeScript resolving %s reads %4$s',
      (_how, moduleResolution, format, file) => {
        const { resolvedModule } = ts.resolveModuleName(
          '@shipstatic/ship',
          resolve(PACKAGE, 'consumer.ts'),
          { moduleResolution },
          ts.sys,
          undefined,
          undefined,
          format,
        );

        expect(resolvedModule?.resolvedFileName).toBe(resolve(DIST, file));
      },
    );
  });

  it('the build handed to a tool that states nothing imports no module at all', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(resolve(DIST, 'browser.js'), 'utf-8');

    expect(source.match(/\bfrom\s*["'][^"']+["']|\brequire\(\s*["'][^"']+["']\s*\)/g)).toBeNull();
  });

  it('the check can see a defect: a map whose fallback is the Node build is named', () => {
    // The shape this package shipped until 3.12.0: `import` and `require` at
    // the top, so a tool that set neither `browser` nor `node` was handed the
    // build that imports `fs`.
    const fallsBackToNode: ExportsEntry = {
      browser: { default: './dist/browser.js' },
      import: { default: './dist/index.js' },
      require: { default: './dist/index.cjs' },
    };

    expect(resolveExport(fallsBackToNode, ['edge-light', 'import'])).toBe('./dist/index.js');
    expect(resolveExport(fallsBackToNode, ['browser', 'import'])).toBe(NO_FILESYSTEM);
  });
});
