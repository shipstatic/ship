/**
 * @file Ship SDK for Node.js environments.
 *
 * The Node-side `Ship` adds two things on top of the base class:
 *   1. Environment detection — refuses to construct outside Node.
 *   2. `SHIP_TOKEN` / `SHIP_API_URL` env-var resolution as the universal
 *      "process boundary" credential source — the industry's one-token
 *      convention. Constructor arguments win over env vars.
 *
 * The SDK does NOT read `~/.shiprc` or `package.json` `"ship"` keys — that's
 * the CLI's job (see `cli/shiprc.ts`). Keeping file resolution out of the SDK
 * is what lets embedded consumers (MCP, n8n, GitHub Action) safely write
 * `new Ship({})` for anonymous public deployments without inheriting the host
 * developer's personal credentials.
 */

import { ShipError } from '@shipstatic/types';
import { Ship as BaseShip } from '../shared/base-ship.js';
import { getENV } from '../shared/lib/env.js';
import type {
  DeployBodyCreator,
  DeployInput,
  DeploymentCreateResponse,
  DeploymentOptions,
  ShipClientOptions,
  StaticFile,
} from '../shared/types.js';
import { readEnvConfig } from './core/config.js';
import { createDeployBody } from './core/deploy-body.js';

// Export all shared functionality
export * from '../shared/index.js';

/**
 * Ship SDK Client for Node.js environments.
 *
 * @example
 * ```typescript
 * // Authenticated — explicit token (API key, deploy token, or OAuth bearer)
 * const ship = new Ship({ token: 'ship-xxxx' });
 *
 * // Authenticated — picks up SHIP_TOKEN from env
 * const ship = new Ship({});
 *
 * // Anonymous public deploy — works when neither constructor nor env provides a token
 * const ship = new Ship({});
 * await ship.deploy('./dist');
 * ```
 */
export class Ship extends BaseShip {
  constructor(options: ShipClientOptions = {}) {
    if (getENV() !== 'node') {
      throw ShipError.business('Node.js Ship class can only be used in Node.js environment.');
    }

    // Layer env vars under constructor options. The merged result is what the
    // base class sees, so the credential and the HTTP client are fully formed
    // by the time the constructor returns — no async config phase needed.
    //
    // Truthiness (not `??`) is deliberate: an empty-string token is absence
    // (shell expansion of unset CI variables), so `token: ''` falls through
    // to `SHIP_TOKEN` instead of locking in a phantom credential. A client
    // constructed with `session: true` has chosen its identity — the ambient
    // token does not ride along.
    const env = readEnvConfig();
    super({
      ...options,
      apiUrl: options.apiUrl || env.apiUrl,
      token: options.token || (options.session ? undefined : env.token),
    });
  }

  /**
   * Deploy file or directory paths to ShipStatic. Convenience shortcut for
   * `ship.deployments.upload()`.
   *
   * Wrong-platform inputs (e.g. `File[]`) fail at compile time. For
   * platform-neutral code, use `ship.deployments.upload()`, which accepts
   * the wider `DeployInput` and validates at runtime — that asymmetry is
   * intentional: the convenience shortcut narrows; the resource-layer
   * contract stays platform-neutral.
   */
  async deploy(
    input: string | string[],
    options?: DeploymentOptions,
  ): Promise<DeploymentCreateResponse> {
    return super.deploy(input, options);
  }

  protected async processInput(
    input: DeployInput,
    options: DeploymentOptions,
  ): Promise<StaticFile[]> {
    // Normalize string to string[] and validate.
    const paths = typeof input === 'string' ? [input] : input;

    if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string')) {
      throw ShipError.business(
        'Invalid input type for Node.js environment. Expected string or string[].',
      );
    }

    if (paths.length === 0) {
      throw ShipError.business('No files to deploy.');
    }

    const { processFilesForNode } = await import('./core/node-files.js');
    return processFilesForNode(paths, options, this.platformLimits ?? undefined);
  }

  protected getDeployBodyCreator(): DeployBodyCreator {
    return createDeployBody;
  }
}

// Default export (for `import Ship from '@shipstatic/ship'`)
export default Ship;

// Node-only utilities (path-walking + MD5 over the local filesystem)
export { processFilesForNode } from './core/node-files.js';
