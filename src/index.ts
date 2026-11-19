/**
 * @file The package's Node entry: `Ship` with paths and the `SHIP_*`
 * environment variables, which the `node` condition of the exports map
 * selects. Every other tool is handed `browser/index.ts`, the same SDK with
 * no filesystem code. There is one import path for both.
 */

export * from './node/index.js';
export { default } from './node/index.js';
