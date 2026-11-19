/**
 * @file Ship SDK for browsers, Workers and every runtime without a filesystem.
 *
 * It is the shared SDK and nothing more: a deploy takes `File`s, and the
 * credential is the `token` option (or, for first-party browser apps, the
 * cookie session via `session: true`). Nothing is read from the environment.
 *
 * @example
 * ```typescript
 * const ship = new Ship({ token: 'deploy-xxxx' });
 * await ship.deploy(Array.from(fileInput.files));
 * ```
 */

export { Ship as default } from '../shared/base-ship.js';
export * from '../shared/index.js';
