/**
 * @file Ship SDK for Node.js environments with full file system support.
 */

import { Ship as BaseShip } from '../shared/base-ship.js';
import { ShipError } from '@shipstatic/types';
import { getENV } from '../shared/lib/env.js';
import { loadConfig } from './core/config.js';
import { resolveConfig } from '../shared/core/config.js';
import { setConfig } from './core/platform-config.js';
import { ApiHttp } from '../shared/api/http.js';
import type { ShipClientOptions, DeployInput, DeploymentOptions, StaticFile } from '../shared/types.js';

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

  protected resolveInitialConfig(options: ShipClientOptions): any {
    return resolveConfig(options, {});
  }

  protected async loadFullConfig(): Promise<void> {
    try {
      // Load config from file/env
      const loadedConfig = await loadConfig(this.clientOptions.configFile);
      // Re-resolve and re-create the http client with the full config
      const finalConfig = resolveConfig(this.clientOptions, loadedConfig);
      this.http = new ApiHttp({ ...this.clientOptions, ...finalConfig });
      
      const platformConfig = await this.http.getConfig();
      setConfig(platformConfig);
    } catch (error) {
      // Reset initialization promise so it can be retried
      this.initPromise = null;
      throw error;
    }
  }

  protected async processInput(input: DeployInput, options: DeploymentOptions): Promise<StaticFile[]> {
    // Validate input type for Node.js environment
    if (!this.#isValidNodeInput(input)) {
      throw ShipError.business('Invalid input type for Node.js environment. Expected string[] file paths.');
    }
    
    // Check for empty array specifically
    if (Array.isArray(input) && input.length === 0) {
      throw ShipError.business('No files to deploy.');
    }
    
    const { convertDeployInput } = await import('./core/prepare-input.js');
    return convertDeployInput(input, options, this.http);
  }

  /**
   * Validates that input is appropriate for Node.js environment
   * @private
   */
  #isValidNodeInput(input: DeployInput): boolean {
    // Check for string or string array (file paths)
    if (typeof input === 'string') {
      return true;
    }
    
    if (Array.isArray(input)) {
      // Allow empty arrays (will be handled as "No files to deploy") 
      // and arrays of strings only
      return input.every(item => typeof item === 'string');
    }
    
    return false;
  }
}

// Default export (for import Ship from 'ship')
export default Ship;

// Node.js specific exports
export { loadConfig } from './core/config.js';
export { setConfig, getCurrentConfig } from './core/platform-config.js';

// Node.js utilities
export { processFilesForNode } from './core/node-files.js';
export { __setTestEnvironment, getENV } from '../shared/lib/env.js';