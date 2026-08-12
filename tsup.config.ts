import * as fs from 'node:fs';
import * as path from 'node:path';
import { defineConfig, type Options } from 'tsup';

/**
 * An esbuild plugin, named through tsup's own option type rather than by
 * importing `esbuild` — which is tsup's dependency, not ours, and typechecking
 * against a package this manifest does not declare is the same class of quiet
 * lie the bundle boundary fence exists to catch.
 */
type EsbuildPlugin = NonNullable<Options['esbuildPlugins']>[number];

/**
 * Where each bundle's esbuild metafile is written — OUTSIDE `dist`, because a
 * metafile is build telemetry rather than product and `files: ["dist", …]` was
 * shipping 78 KB of them to every consumer.
 */
const META_DIR = 'build-meta';

/**
 * Write THIS bundle's metafile to a path nothing else writes.
 *
 * tsup names its own metafile `metafile-{format}.json` inside `outDir`, and the
 * three configs below share one `outDir` — so `index` and `browser` both
 * claimed `metafile-esm.json`, and `index` and `cli` both claimed
 * `metafile-cjs.json`. tsup runs the configs CONCURRENTLY, so that was two
 * writers per path with no coordination, and it behaved exactly as that
 * predicts: measured over 24 builds, roughly one in nine under CPU load ended
 * with a half-overwritten file that `scripts/third-party-licenses.cjs` could
 * not parse, failing the build — and `prepack` is `build`, so a publish
 * inherited the coin flip.
 *
 * The loud failure was the lucky one. The quiet outcome is a metafile that
 * survives INTACT but describes the wrong bundle, leaving the licence list
 * derived from a subset of what the artifact actually bundles — a legal notice
 * that under-reports, with a green build. It was correct only because the CLI
 * bundle happened to be a superset of the index bundle.
 *
 * Keyed by entry name AND format, the paths cannot collide. The coverage check
 * in the licence script is the half that notices if one goes missing anyway.
 */
const writeMetafile = (name: string): EsbuildPlugin => ({
  name: 'ship-metafile',
  setup(build) {
    // esbuild only populates `result.metafile` when asked; tsup's own
    // `metafile: true` is deliberately NOT set, so nothing writes the shared
    // `dist/metafile-{format}.json` paths any more.
    build.initialOptions.metafile = true;
    build.onEnd((result) => {
      if (!result.metafile) return;
      fs.mkdirSync(META_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(META_DIR, `${name}-${build.initialOptions.format}.json`),
        JSON.stringify(result.metafile),
      );
    });
  },
});

/**
 * The SDK's runtime dependencies: declared in `package.json` and REQUIRED at
 * runtime by `dist/index.*`, so a consumer installs them.
 *
 * This list is exactly `dependencies`, and `tests/package/bundle-boundary.test.ts`
 * holds it to that in both directions — an external naming a package that is
 * not a dependency, or a dependency nothing imports, fails the suite. It named
 * `cosmiconfig` and `cli-table3` until 2026-08-12, both deleted with 2.0, and
 * nothing noticed because nothing was checking.
 *
 * The CLI's four — `commander`, `columnify`, `yocto-spinner`, `yoctocolors` —
 * are deliberately ABSENT: they are devDependencies bundled into
 * `dist/cli.cjs`, so an embedded SDK consumer (the MCP, and through it the
 * vscode `.vsix`) no longer installs four packages it never executes.
 */
const nodeExternals = ['junk', 'spark-md5', 'zod'];

// Dependencies to be bundled into the browser build
const browserBundleDeps = ['spark-md5', 'junk', 'zod', '@shipstatic/types'];

export default defineConfig((tsupOptions: Options): Options[] => [
  // 1. SDK for Node.js (ESM and CJS, main entry)
  {
    entry: {
      index: 'src/index.ts',
    },
    outDir: 'dist',
    format: ['esm', 'cjs'],
    platform: 'node',
    target: 'node18',
    // `@shipstatic/types` is a devDependency bundled into the artifact — the
    // declaration files must inline it too, or consumers get a runtime surface
    // whose types reference a package they don't have.
    dts: { resolve: ['@shipstatic/types'] },
    sourcemap: true,
    splitting: false,
    clean: true,
    external: nodeExternals,
    minify: !tsupOptions.watch,
    esbuildPlugins: [writeMetafile('index')],
  },
  // 2. Browser SDK (ESM, browser entry, with polyfills/shims)
  {
    entry: {
      browser: 'src/browser/index.ts',
    },
    outDir: 'dist',
    format: ['esm'],
    platform: 'browser',
    target: 'es2020',
    dts: { resolve: ['@shipstatic/types'] },
    sourcemap: true,
    splitting: false,
    clean: false,
    noExternal: browserBundleDeps,
    minify: !tsupOptions.watch,
    esbuildPlugins: [writeMetafile('browser')],
    esbuildOptions(options, _context) {
      // Build-time aliasing for Node.js modules. esbuild aliases match BARE
      // specifiers only (`node:`-prefixed ones bypass alias resolution), so
      // node-builtin imports in shared source must use the bare form — the
      // two md5.ts sites carry biome-ignore comments for exactly this, and
      // the post-build fence (scripts/post-build.cjs) fails the build if any
      // builtin survives into dist/browser.js.
      options.alias = {
        ...options.alias,
        fs: path.resolve('./build-shims/empty.cjs'),
        crypto: path.resolve('./build-shims/empty.cjs'),
        os: path.resolve('./build-shims/empty.cjs'),
        module: path.resolve('./build-shims/empty.cjs'),
      };
      // Define NODE_ENV for any dependency that might need it
      options.define = {
        ...options.define,
        'process.env.NODE_ENV': JSON.stringify(tsupOptions.watch ? 'development' : 'production'),
      };
    },
  },
  // 3. CLI (CJS for Node.js, cli entry)
  {
    entry: {
      // The BIN, not the library: importing the command tree must have no
      // side effects (see src/node/cli/bin.ts).
      cli: 'src/node/cli/bin.ts',
    },
    outDir: 'dist',
    format: ['cjs'],
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    clean: false,
    // The CLI bundles EVERYTHING — no `external` at all, so `dist/cli.cjs`
    // requires nothing but node builtins and runs from a bare tarball. That is
    // what lets the four CLI-only packages leave `dependencies`, and it is
    // fenced rather than trusted (`tests/package/bundle-boundary.test.ts`).
    noExternal: [/.*/],
    minify: !tsupOptions.watch,
    esbuildPlugins: [writeMetafile('cli')],
    esbuildOptions(options) {
      // Bundling MIT code carries its copyright notices with it. esbuild keeps
      // `/*! … */` and `@license` blocks at the end of the file; the notices
      // that use no such marker are collected into THIRD-PARTY-LICENSES.md by
      // `scripts/third-party-licenses.cjs`, which the build runs and the
      // package ships.
      options.legalComments = 'eof';
    },
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);
