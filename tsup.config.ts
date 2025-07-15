import { defineConfig } from 'tsup';

export default defineConfig([
  // Main SDK
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    minify: true,
    external: [
      'cli-table3',
      'commander', 
      'cosmiconfig',
      'form-data-encoder',
      'formdata-node',
      'junk',
      'mime-types',
      'spark-md5',
      'zod'
    ]
  },
  // CLI
  {
    entry: { cli: 'src/cli/index.ts' },
    format: ['cjs'],
    dts: false,
    clean: false,
    sourcemap: true,
    minify: true,
    banner: {
      js: '#!/usr/bin/env node'
    },
    external: [
      'cli-table3',
      'commander',
      'cosmiconfig', 
      'form-data-encoder',
      'formdata-node',
      'junk',
      'mime-types',
      'spark-md5',
      'zod'
    ]
  },
  // Browser bundle
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: false,
    clean: false,
    sourcemap: true,
    minify: true,
    outExtension: () => ({ js: '.browser.js' }),
    define: {
      'process.env.NODE_ENV': '"production"'
    },
    noExternal: [
      'spark-md5',
      'mime-types',
      'form-data-encoder',
      'junk'
    ]
  }
]);