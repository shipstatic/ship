import { defineConfig, Options } from 'tsup';
import * as path from 'path';

// Define a base set of external dependencies for Node.js environments
const nodeExternals = [
  'cli-table3',
  'commander',
  'cosmiconfig',
  'form-data-encoder',
  'formdata-node',
  'junk',
  'mime-types',
  'spark-md5',
  'path-browserify',
  'yocto-spinner',
  'yoctocolors',
  'columnify',
  'zod'
];

// Dependencies to be bundled into the browser build
const browserBundleDeps = [
  'spark-md5',
  'mime-types', 
  'form-data-encoder',
  'junk',
  'zod',
  '@shipstatic/types'
];

export default defineConfig((tsupOptions: Options): Options[] => [
  // 1. SDK for Node.js (ESM and CJS, main entry)
  {
    entry: {
      index: 'src/index.ts'
    },
    outDir: 'dist',
    format: ['esm', 'cjs'],
    platform: 'node',
    target: 'node18',
    dts: true,
    sourcemap: true,
    splitting: false,
    clean: true,
    external: nodeExternals,
    minify: tsupOptions.watch ? false : true,
  },
  // 2. Browser SDK (ESM, browser entry, with polyfills/shims)
  {
    entry: {
      browser: 'src/index.ts',
    },
    outDir: 'dist',
    format: ['esm'],
    platform: 'browser',
    target: 'es2020',
    sourcemap: true,
    splitting: false,
    clean: false,
    noExternal: browserBundleDeps,
    minify: tsupOptions.watch ? false : true,
    esbuildOptions(options, context) {
      // Use build-time aliasing for Node.js modules
      options.alias = {
        ...options.alias,
        path: 'path-browserify',
        fs: path.resolve('./build-shims/empty.cjs'),
        crypto: path.resolve('./build-shims/empty.cjs'),
        os: path.resolve('./build-shims/empty.cjs'),
        module: path.resolve('./build-shims/empty.cjs'),
        cosmiconfig: path.resolve('./build-shims/cosmiconfig.mjs'),
      };
      // Define NODE_ENV for any dependency that might need it
      options.define = {
        ...options.define,
        'process.env.NODE_ENV': JSON.stringify(
          tsupOptions.watch ? 'development' : 'production'
        ),
      };
    },
  },
  // 3. CLI (CJS for Node.js, cli entry)
  {
    entry: {
      cli: 'src/cli/index.ts'
    },
    outDir: 'dist',
    format: ['cjs'],
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    clean: false,
    external: nodeExternals,
    minify: tsupOptions.watch ? false : true,
    banner: {
      js: '#!/usr/bin/env node',
    },
    // Copy completion scripts to dist
    onSuccess: async () => {
      const fs = await import('fs');
      const path = await import('path');
      
      // Create completions directory in dist
      const completionsDir = path.resolve('./dist/completions');
      if (!fs.existsSync(completionsDir)) {
        fs.mkdirSync(completionsDir, { recursive: true });
      }
      
      // Copy completion scripts
      const scripts = ['ship.bash', 'ship.zsh', 'ship.fish'];
      for (const script of scripts) {
        const src = path.resolve(`./src/completions/${script}`);
        const dest = path.resolve(`./dist/completions/${script}`);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      }
    },
  },
]);