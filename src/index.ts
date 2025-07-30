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
 * ```
 * const ship = new Ship({ apiKey: "your-api-key" });
 * ```
 * 
 * Automatically detects the environment and handles Node.js and browser deploys directly.
 * In Node.js environments, loads configuration from files and environment variables.
 * In browser environments, uses only the provided options.
 */
export class Ship {
  private http: ApiHttp;
  private environment: 'node' | 'browser';
  private readonly clientOptions: ShipClientOptions;
  private initPromise: Promise<void> | null = null;
  
  // Resource instances (initialized during creation)
  private _deployments: DeploymentResource;
  private _aliases: AliasResource;
  private _account: AccountResource;
  private _keys: KeysResource;

  constructor(options: ShipClientOptions = {}) {
    this.clientOptions = options;
    this.environment = getENV() as 'node' | 'browser';
    
    if (this.environment !== 'node' && this.environment !== 'browser') {
      throw ShipError.business('Unsupported execution environment.');
    }
    
    // Initialize HTTP client with constructor options for immediate use
    const config = resolveConfig(options, {});
    this.http = new ApiHttp({ ...options, ...config });
    
    // Initialize resources with lazy loading support
    const initCallback = this.getInitCallback();
    const getApi = () => this.http; // Dynamic getter for current HTTP client
    this._deployments = createDeploymentResource(getApi, this.clientOptions, initCallback);
    this._aliases = createAliasResource(getApi, initCallback);
    this._account = createAccountResource(getApi, initCallback);
    this._keys = createKeysResource(getApi, initCallback);
  }

  /**
   * Ensure full initialization is complete - called lazily by resources
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeConfig();
    }
    return this.initPromise;
  }

  /**
   * Helper method to create initialization callback for resources
   */
  private getInitCallback() {
    return () => this.ensureInitialized();
  }

  /**
   * Initialize config from file/env and platform config from API
   */
  private async initializeConfig(): Promise<void> {
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

  /**
   * Ping the API server to check connectivity
   */
  async ping(): Promise<boolean> {
    // Ensure initialization before any HTTP operations
    await this.ensureInitialized();
    return this.http.ping();
  }

  /**
   * Deploy project (convenience shortcut to ship.deployments.create())
   */
  async deploy(input: DeployInput, options?: DeploymentOptions): Promise<Deployment> {
    return this.deployments.create(input, options);
  }

  /**
   * Get current account information (convenience shortcut to ship.account.get())
   */
  async whoami() {
    return this.account.get();
  }

  /**
   * Get deployments resource (environment-specific)
   */
  get deployments(): DeploymentResource {
    return this._deployments;
  }
  
  /**
   * Get aliases resource
   */
  get aliases(): AliasResource {
    return this._aliases;
  }
  
  /**
   * Get account resource
   */
  get account(): AccountResource {
    return this._account;
  }
  
  /**
   * Get keys resource
   */
  get keys(): KeysResource {
    return this._keys;
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
export { processFilesForBrowser } from './lib/browser-files.js';

// Test utilities
/**
 * @internal
 * Test utility to set the execution environment (e.g., 'node', 'browser').
 * This should not be used in production code.
 */
export { __setTestEnvironment } from './lib/env.js';
