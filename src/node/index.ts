/**
 * @file Ship SDK for Node.js, and the runtimes that speak its API (Bun).
 *
 * The shared SDK, with the two things a process on a computer adds:
 *   1. Paths. A deploy takes a file or folder path, or a list of them, as
 *      well as the `File`s it takes everywhere.
 *   2. `SHIP_TOKEN` / `SHIP_API_URL`, the one-token convention of a process
 *      boundary. Constructor arguments win over them.
 *
 * The SDK reads no config file: `~/.shiprc` is the CLI's (see
 * `cli/shiprc.ts`). Keeping file resolution out of the SDK is what lets
 * embedded consumers (the MCP server, the GitHub Action) safely write
 * `new Ship({})` for anonymous public deployments without inheriting the host
 * developer's personal credentials.
 */

import { type DeployInput, ShipError } from '@shipstatic/types';
import type { DeploySource } from '../shared/core/deploy-files.js';
import { isFiles, isPaths } from '../shared/core/deploy-input.js';
import { Ship as BaseShip } from '../shared/ship.js';
import type { ShipClientOptions } from '../shared/types.js';
import { readEnvConfig } from './core/config.js';
import { findSources } from './core/node-files.js';

export * from '../shared/index.js';

/** What a deploy is told here when its input is no list of `File`s and no path. */
const FILES_OR_PATHS_EXPECTED =
  'A deploy takes a list of File objects, a path, or a list of paths.';

/**
 * Ship SDK client for Node.js.
 *
 * @example
 * ```typescript
 * // Authenticated: an explicit token (API key, deploy token, or OAuth bearer)
 * const ship = new Ship({ token: 'ship-your-api-key' });
 *
 * // Authenticated from SHIP_TOKEN, or anonymous when there is none
 * const ship = new Ship();
 *
 * await ship.deploy('./dist');
 * ```
 */
export class Ship extends BaseShip {
  constructor(options: ShipClientOptions = {}) {
    // Env vars sit under constructor options, so the credential and the HTTP
    // client are fully formed when the constructor returns.
    //
    // Truthiness (not `??`) is deliberate: an empty-string token is absence
    // (shell expansion of an unset CI variable), so `token: ''` falls through
    // to `SHIP_TOKEN` and never locks in a phantom credential. A client
    // constructed with `session: true` has chosen its identity, so the
    // ambient token does not ride along.
    const env = readEnvConfig();
    super({
      ...options,
      apiUrl: options.apiUrl || env.apiUrl,
      token: options.token || (options.session ? undefined : env.token),
    });
  }

  /**
   * `File`s as everywhere, and the files under a path or a list of paths.
   *
   * @internal
   */
  protected override async sources(input: DeployInput): Promise<DeploySource[]> {
    if (isPaths(input)) return findSources(typeof input === 'string' ? [input] : input);
    if (isFiles(input)) return super.sources(input);
    throw ShipError.business(FILES_OR_PATHS_EXPECTED);
  }
}

export default Ship;
