import * as path from 'node:path';
import { defineConfig, type Options } from 'tsup';

// Define a base set of external dependencies for Node.js environments
const nodeExternals = [
  'cli-table3',
  'commander',
  'cosmiconfig',
  'form-data-encoder',
  'formdata-node',
  'junk',
  'spark-md5',
  'yocto-spinner',
  'yoctocolors',
  'columnify',
  'zod',
];

// Dependencies to be bundled into the browser build
const browserBundleDeps = ['spark-md5', 'form-data-encoder', 'junk', 'zod', '@shipstatic/types'];

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
        cosmiconfig: path.resolve('./build-shims/cosmiconfig.mjs'),
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
      cli: 'src/node/cli/index.ts',
    },
    outDir: 'dist',
    format: ['cjs'],
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    clean: false,
    external: nodeExternals,
    minify: !tsupOptions.watch,
    banner: {
      js: '#!/usr/bin/env node',
    },
    // Copy completion scripts to dist
    onSuccess: async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');

      // Create completions directory in dist
      const completionsDir = path.resolve('./dist/completions');
      if (!fs.existsSync(completionsDir)) {
        fs.mkdirSync(completionsDir, { recursive: true });
      }

      // Copy completion scripts
      const scripts = ['ship.bash', 'ship.zsh', 'ship.fish'];
      for (const script of scripts) {
        const src = path.resolve(`./src/node/completions/${script}`);
        const dest = path.resolve(`./dist/completions/${script}`);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      }
    },
  },
]);
