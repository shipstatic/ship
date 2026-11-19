/**
 * @file What this package publishes beside its `Ship` class, on every build.
 *
 * The list is written out, never a star over a module: a name is published
 * because a consumer reads it, and `tests/package/dist-entries.test.ts` holds
 * the built entries to exactly these. The one star is `./types.js`, which
 * carries the `@shipstatic/types` vocabulary and this SDK's option types.
 */

// What a person is told when a file cannot be read: `@shipstatic/drop` says it too.
export { unreadable } from './core/deploy-files.js';
// How a site's files are named and judged, which `@shipstatic/drop` shows
// before a deploy exactly as the deploy does.
export { optimizeDeployPaths, sitePaths } from './lib/deploy-paths.js';
export { validateFiles } from './lib/file-validation.js';
export { pluralize } from './lib/text.js';
export * from './types.js';
