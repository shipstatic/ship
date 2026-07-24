/**
 * @file Main entry point for the Ship SDK.
 *
 * This is the Node.js entry: file-system deploy input plus the `SHIP_*`
 * env-var fallback. Browser consumers resolve this same package to the
 * browser build through the `browser` condition in the exports map —
 * bundlers select it automatically; there is no separate import path.
 */

// Re-export everything from the Node.js index, including both named and default exports
export * from './node/index.js';
export { default } from './node/index.js';
