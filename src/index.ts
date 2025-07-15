/**
 * @file Main entry point for the Ship SDK.
 * This module provides a simplified class-based SDK interface similar to Vercel's approach.
 */

// Core imports
import { getENV } from './lib/env.js';
import { loadConfig, resolveConfig } from './core/config.js';
import { ApiHttp } from './api/http.js';
import { ShipError } from '@shipstatic/types';
import { setConfig } from './core/platform-config.js';
import type { ShipClientOptions } from './types.js';

// Resource imports
import { createDeploymentResource, createAliasResource, createAccountResource, createKeysResource } from './resources.js';
import type { DeploymentResource, AliasResource, AccountResource, KeysResource, DeployInput } from './resources.js';
import type { DeploymentOptions } from './types.js';
import type { Deployment } from '@shipstatic/types';



// Re-export types from deploy types
export type { DeployInput, DeploymentOptions } from './types.js';


/**
 * Ship SDK Client - Universal class-based interface for both Node.js and browser environments.
 * 
 * Similar to Vercel's SDK approach:
 * ```
 * const ship = new Ship({ apiKey: "your-api-key" });
 * ```
 * 
 * Automatically detects the environment and handles Node.js and browser deploys directly.
 * In Node.js environments, loads configuration from files and environment variables.
 * In browser environments, uses only the provided options.
 */
/**
 * Ship SDK Client - Simplified single class supporting both Node.js and browser environments
 */
export class Ship {
  private http: ApiHttp;
  private environment: 'node' | 'browser';
  private configInitialized: boolean = false;
  private readonly clientOptions: ShipClientOptions;
  
  // Resource instances (lazy-loaded)
  private _deployments?: DeploymentResource;
  private _aliases?: AliasResource;
  private _account?: AccountResource;
  private _keys?: KeysResource;

  constructor(options: ShipClientOptions = {}) {
    this.clientOptions = options;
    this.environment = getENV() as 'node' | 'browser';
    
    if (this.environment !== 'node' && this.environment !== 'browser') {
      throw ShipError.business('Unsupported execution environment.');
    }
    
    // Load config synchronously and initialize HTTP client
    const loadedConfig = loadConfig();
    const config = resolveConfig(options, loadedConfig);
    this.http = new ApiHttp({ ...options, ...config });
  }

  /**
   * Initialize platform config from API (called automatically on first use)
   */
  private async initializeConfig(): Promise<void> {
    if (this.configInitialized) return;
    
    const config = await this.http.getConfig();
    setConfig(config);
    this.configInitialized = true;
  }

  /**
   * Ping the API server to check connectivity
   */
  async ping(): Promise<boolean> {
    return this.http.ping();
  }

  /**
   * Get deployments resource (environment-specific)
   */
  get deployments() {
    if (!this._deployments) {
      this._deployments = createDeploymentResource(this.http, () => this.initializeConfig(), this.clientOptions);
    }
    return this._deployments;
  }
  
  /**
   * Get aliases resource
   */
  get aliases(): AliasResource {
    if (!this._aliases) {
      this._aliases = createAliasResource(this.http);
    }
    return this._aliases;
  }
  
  /**
   * Get account resource
   */
  get account(): AccountResource {
    if (!this._account) {
      this._account = createAccountResource(this.http);
    }
    return this._account;
  }
  
  /**
   * Get keys resource
   */
  get keys(): KeysResource {
    if (!this._keys) {
      this._keys = createKeysResource(this.http);
    }
    return this._keys;
  }

  /**
   * Deploy files (convenience shortcut to ship.deployments.create())
   */
  async deploy(input: DeployInput, options?: DeploymentOptions): Promise<Deployment> {
    return this.deployments.create(input, options);
  }

}

// Default export (for import Ship from 'ship')
export default Ship;

// Export all public types
export type { StaticFile, ShipClientOptions, ApiDeployOptions, ProgressStats } from './types.js';
export type { PingResponse } from '@shipstatic/types';

// Export resource types
export type { DeploymentResource, AliasResource, AccountResource, KeysResource } from './resources.js';

// Export main error class and error type enum
export { ShipError, ShipErrorType } from '@shipstatic/types';

// Advanced/utility exports (for tests and power users; subject to change)
export { processFilesForNode } from './lib/node-files.js';
export { processFilesForBrowser, findBrowserCommonParentDirectory } from './lib/browser-files.js';

// Test utilities
/**
 * @internal
 * Test utility to set the execution environment (e.g., 'node', 'browser').
 * This should not be used in production code.
 */
export { __setTestEnvironment } from './lib/env.js';
