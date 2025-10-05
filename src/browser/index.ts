/**
 * @file Ship SDK for browser environments with streamlined configuration.
 */

import { Ship as BaseShip } from '../shared/base-ship.js';
import { setConfig as setPlatformConfig } from '../shared/core/platform-config.js';
import { resolveConfig } from '../shared/core/config.js';
import { ApiHttp } from '../shared/api/http.js';
import { ShipError } from '@shipstatic/types';
import type { ShipClientOptions, DeployInput, DeploymentOptions, StaticFile } from '../shared/types.js';

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
 * const files = fileInput.files;
 * await ship.deploy(files);
 * ```
 */
export class Ship extends BaseShip {
  constructor(options: ShipClientOptions = {}) {
    super(options);
  }

  protected resolveInitialConfig(options: ShipClientOptions): any {
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
    // Validate input type for browser environment
    if (!this.#isValidBrowserInput(input)) {
      throw ShipError.business('Invalid input type for browser environment. Expected File[], FileList, or HTMLInputElement.');
    }
    
    // Determine the actual files to process
    const filesToProcess = (input instanceof HTMLInputElement) 
      ? Array.from(input.files as FileList)
      : (input as File[] | FileList);
    
    const { processFilesForBrowser } = await import('./lib/browser-files.js');
    return processFilesForBrowser(filesToProcess, options);
  }

  /**
   * Validates that input is appropriate for browser environment
   * @private
   */
  #isValidBrowserInput(input: DeployInput): boolean {
    // Check for File array - must be array AND all items must be Files
    if (Array.isArray(input)) {
      return input.length === 0 || input.every(item => item instanceof File);
    }
    
    // Check for FileList (has length and item method)
    if (input && typeof input === 'object' && 'length' in input && typeof input.length === 'number') {
      // More specific check - FileList should have an item method or be a real FileList
      return 'item' in input || (input as any).constructor?.name === 'FileList';
    }
    
    // Check for HTMLInputElement (would have files property)
    if (input && typeof input === 'object' && 'files' in input) {
      return true;
    }
    
    return false;
  }
}

// Default export (for import Ship from 'ship')
export default Ship;

// Browser specific exports
export { loadConfig } from './core/config.js';
export { setConfig as setPlatformConfig, getCurrentConfig } from '../shared/core/platform-config.js';

// Browser utilities
export { processFilesForBrowser } from './lib/browser-files.js';