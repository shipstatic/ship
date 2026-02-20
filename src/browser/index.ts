/**
 * @file Ship SDK for browser environments with streamlined configuration.
 */

import { Ship as BaseShip } from '../shared/base-ship.js';
import { setConfig as setPlatformConfig } from '../shared/core/platform-config.js';
import { resolveConfig, type ResolvedConfig } from '../shared/core/config.js';
import { ShipError } from '@shipstatic/types';
import type { ShipClientOptions, DeployInput, DeploymentOptions, StaticFile, DeployBodyCreator } from '../shared/types.js';
import { createDeployBody } from './core/deploy-body.js';

// Export all shared functionality
export * from '../shared/index.js';

/**
 * Ship SDK Client for browser environments.
 * 
 * Optimized for browser compatibility with no Node.js dependencies.
 * Configuration is provided explicitly through constructor options.
 * 
 * @example
 * ```typescript
 * // Deploy with token obtained from server
 * const ship = new Ship({
 *   deployToken: "token-xxxx",
 *   apiUrl: "https://api.shipstatic.dev"
 * });
 *
 * // Deploy files from input element
 * const files = Array.from(fileInput.files);
 * await ship.deploy(files);
 * ```
 */
export class Ship extends BaseShip {
  constructor(options: ShipClientOptions = {}) {
    super(options);
  }

  protected resolveInitialConfig(options: ShipClientOptions): ResolvedConfig {
    return resolveConfig(options, {});
  }

  protected async loadFullConfig(): Promise<void> {
    try {
      // Browser receives all client config through constructor options (no file loading needed)
      // Fetch platform configuration from API
      const platformConfig = await this.http.getConfig();
      setPlatformConfig(platformConfig);
    } catch (error) {
      // Reset initialization promise so it can be retried
      this.initPromise = null;
      throw error;
    }
  }

  protected async processInput(input: DeployInput, options: DeploymentOptions): Promise<StaticFile[]> {
    // Validate input - must be File[]
    if (!this.isFileArray(input)) {
      throw ShipError.business('Invalid input type for browser environment. Expected File[].');
    }

    if (input.length === 0) {
      throw ShipError.business('No files to deploy.');
    }

    // Process files directly
    const { processFilesForBrowser } = await import('./lib/browser-files.js');
    return processFilesForBrowser(input, options);
  }

  /** Type guard that validates all elements are File objects */
  private isFileArray(input: DeployInput): input is File[] {
    return Array.isArray(input) && input.every(item => item instanceof File);
  }

  protected getDeployBodyCreator(): DeployBodyCreator {
    return createDeployBody;
  }
}

// Default export (for import Ship from 'ship')
export default Ship;

// Browser specific exports
export { setConfig as setPlatformConfig, getCurrentConfig } from '../shared/core/platform-config.js';

// Browser utilities
export { processFilesForBrowser } from './lib/browser-files.js';