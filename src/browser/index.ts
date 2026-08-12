/**
 * @file Ship SDK for browser environments.
 *
 * Configuration is fully explicit — the browser has no env vars or config files
 * to inherit. The credential is supplied via the `token` constructor option
 * (or, for first-party browser apps, the cookie session via `session: true`).
 */

import { ShipError } from '@shipstatic/types';
import { Ship as BaseShip } from '../shared/base-ship.js';
import type {
  DeployInput,
  DeploymentCreateResponse,
  DeploymentOptions,
  StaticFile,
} from '../shared/types.js';

// Export all shared functionality
export * from '../shared/index.js';

/**
 * Ship SDK Client for browser environments.
 *
 * @example
 * ```typescript
 * // Deploy with a token obtained from your server
 * const ship = new Ship({
 *   token: 'deploy-xxxx',
 *   apiUrl: 'https://api.shipstatic.com',
 * });
 *
 * const files = Array.from(fileInput.files);
 * await ship.deploy(files);
 * ```
 */
export class Ship extends BaseShip {
  // No constructor override — the base class accepts `ShipClientOptions` and
  // browsers have no ambient credential source (no env vars, no filesystem).

  /**
   * Deploy `File[]` (typically from `<input type="file">` or drag-and-drop)
   * to ShipStatic. Convenience shortcut for `ship.deployments.upload()`.
   *
   * Wrong-platform inputs (e.g. string paths) fail at compile time. For
   * platform-neutral code, use `ship.deployments.upload()`, which accepts
   * the wider `DeployInput` and validates at runtime — that asymmetry is
   * intentional: the convenience shortcut narrows; the resource-layer
   * contract stays platform-neutral.
   */
  async deploy(input: File[], options?: DeploymentOptions): Promise<DeploymentCreateResponse> {
    return super.deploy(input, options);
  }

  protected async processInput(
    input: DeployInput,
    options: DeploymentOptions,
  ): Promise<StaticFile[]> {
    if (!Array.isArray(input) || !input.every((item) => item instanceof File)) {
      throw ShipError.business('Invalid input type for browser environment. Expected File[].');
    }

    if (input.length === 0) {
      throw ShipError.business('No files to deploy.');
    }

    const { processFilesForBrowser } = await import('./core/browser-files.js');
    return processFilesForBrowser(input, options, this.platformLimits ?? undefined);
  }
}

// Default export (for `import Ship from '@shipstatic/ship'`)
export default Ship;

// Browser-only utilities (validation + MD5 over `File` / `Blob` inputs)
export { processFilesForBrowser } from './core/browser-files.js';
