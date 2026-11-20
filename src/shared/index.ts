/**
 * @file Ship SDK for browsers, Workers and every runtime without a
 * filesystem, and everything the Node entry publishes beside its own `Ship`.
 *
 * A deploy takes `File`s, and the credential is the `token` option (or, for
 * first-party browser apps, the cookie session via `session: true`). Nothing
 * is read from the environment.
 *
 * The list is written out, never a star over a module: a name is published
 * because a consumer reads it, and `tests/package/dist-entries.test.ts` holds
 * the built entries to exactly these. The one star is `./types.js`, which
 * carries the `@shipstatic/types` vocabulary and this SDK's option types.
 *
 * @example
 * ```typescript
 * const ship = new Ship({ token: 'deploy-xxxx' });
 * await ship.deploy(Array.from(fileInput.files));
 * ```
 */

// What a person is told when a file cannot be read: `@shipstatic/drop` says it too.
export { unreadable } from './core/deploy-files.js';
// How a site's files are named and judged, which `@shipstatic/drop` shows
// before a deploy exactly as the deploy does.
export { optimizeDeployPaths, sitePaths } from './lib/deploy-paths.js';
export { validateFiles } from './lib/file-validation.js';
export { pluralize } from './lib/text.js';
export { Ship, Ship as default } from './ship.js';
export * from './types.js';
