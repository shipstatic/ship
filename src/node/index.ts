/**
 * @file Ship SDK for Node.js environments with full file system support.
 */

import { Ship as BaseShip } from '../shared/base-ship.js';
import { ShipError } from '@shipstatic/types';
import { getENV } from '../shared/lib/env.js';
import { loadConfig } from './core/config.js';
import { resolveConfig, type ResolvedConfig } from '../shared/core/config.js';
import { setConfig } from '../shared/core/platform-config.js';
import { ApiHttp } from '../shared/api/http.js';
import type { ShipClientOptions, DeployInput, DeploymentOptions, StaticFile, DeployBodyCreator } from '../shared/types.js';
import { createDeployBody } from './core/deploy-body.js';

// Export all shared functionality
export * from '../shared/index.js';

/**
 * Ship SDK Client for Node.js environments.
 * 
 * Provides full file system access, configuration file loading,
 * and environment variable support.
 * 
 * @example
 * ```typescript
 * // Authenticated deployments with API key
 * const ship = new Ship({ apiKey: "ship-xxxx" });
 * 
 * // Single-use deployments with deploy token
 * const ship = new Ship({ deployToken: "token-xxxx" });
 * 
 * // Deploy a directory
 * await ship.deploy('./dist');
 * ```
 */
export class Ship extends BaseShip {
  constructor(options: ShipClientOptions = {}) {
    const environment = getENV();

    if (environment !== 'node') {
      throw ShipError.business('Node.js Ship class can only be used in Node.js environment.');
    }

    super(options);
  }

  protected resolveInitialConfig(options: ShipClientOptions): ResolvedConfig {
    return resolveConfig(options, {});
  }

  protected async loadFullConfig(): Promise<void> {
    try {
      // Load config from file/env
      const loadedConfig = await loadConfig(this.clientOptions.configFile);
      // Re-resolve and re-create the http client with the full config
      const finalConfig = resolveConfig(this.clientOptions, loadedConfig);

      // Update auth state with loaded credentials (if not already set by constructor)
      // This ensures hasAuth() returns true after loading from env/config files
      if (finalConfig.deployToken && !this.clientOptions.deployToken) {
        this.setDeployToken(finalConfig.deployToken);
      } else if (finalConfig.apiKey && !this.clientOptions.apiKey) {
        this.setApiKey(finalConfig.apiKey);
      }

      // Replace HTTP client while preserving event listeners (clean intentional API)
      // Use the same getAuthHeaders callback as the initial client
      const newClient = new ApiHttp({
        ...this.clientOptions,
        ...finalConfig,
        getAuthHeaders: this.authHeadersCallback,
        createDeployBody: this.getDeployBodyCreator()
      });
      this.replaceHttpClient(newClient);

      const platformConfig = await this.http.getConfig();
      setConfig(platformConfig);
    } catch (error) {
      // Reset initialization promise so it can be retried
      this.initPromise = null;
      throw error;
    }
  }

  protected async processInput(input: DeployInput, options: DeploymentOptions): Promise<StaticFile[]> {
    // Normalize string to string[] and validate
    const paths = typeof input === 'string' ? [input] : input;

    if (!Array.isArray(paths) || !paths.every(p => typeof p === 'string')) {
      throw ShipError.business('Invalid input type for Node.js environment. Expected string or string[].');
    }

    if (paths.length === 0) {
      throw ShipError.business('No files to deploy.');
    }

    // Process files directly - no intermediate conversion layer
    const { processFilesForNode } = await import('./core/node-files.js');
    return processFilesForNode(paths, options);
  }

  protected getDeployBodyCreator(): DeployBodyCreator {
    return createDeployBody;
  }
}

// Default export (for import Ship from 'ship')
export default Ship;

// Node.js specific exports
export { loadConfig } from './core/config.js';
export { setConfig as setPlatformConfig, getCurrentConfig } from '../shared/core/platform-config.js';

// Node.js utilities
export { processFilesForNode } from './core/node-files.js';
export { __setTestEnvironment, getENV } from '../shared/lib/env.js';