/**
 * @file Base Ship SDK class - provides shared functionality across environments.
 */

import { ApiHttp } from './api/http.js';
import { ShipError } from '@shipstatic/types';
import type { ShipClientOptions } from './types.js';
import type { Deployment } from '@shipstatic/types';

// Resource imports
import { 
  createDeploymentResource, 
  createAliasResource, 
  createAccountResource,
  type DeployInput
} from './resources.js';
import type { 
  DeploymentResource, 
  AliasResource, 
  AccountResource
} from '@shipstatic/types';

import type { StaticFile } from '@shipstatic/types';
import type { DeploymentOptions } from './types.js';

/**
 * Abstract base class for Ship SDK implementations.
 * 
 * Provides shared functionality while allowing environment-specific
 * implementations to handle configuration loading and deployment processing.
 */
export abstract class Ship {
  protected http: ApiHttp;
  protected readonly clientOptions: ShipClientOptions;
  protected initPromise: Promise<void> | null = null;
  
  // Resource instances (initialized during creation)
  protected _deployments: DeploymentResource;
  protected _aliases: AliasResource;
  protected _account: AccountResource;

  constructor(options: ShipClientOptions = {}) {
    this.clientOptions = options;
    
    // Initialize HTTP client with constructor options for immediate use
    const config = this.resolveInitialConfig(options);
    this.http = new ApiHttp({ ...options, ...config });
    
    // Initialize resources with lazy loading support
    const initCallback = () => this.ensureInitialized();
    const getApi = () => this.http;
    
    // Pass the processInput method to deployment resource
    this._deployments = createDeploymentResource(
      getApi, 
      this.clientOptions, 
      initCallback,
      (input, options) => this.processInput(input, options)
    );
    this._aliases = createAliasResource(getApi, initCallback);
    this._account = createAccountResource(getApi, initCallback);
  }

  // Abstract methods that environments must implement
  protected abstract resolveInitialConfig(options: ShipClientOptions): any;
  protected abstract loadFullConfig(): Promise<void>;
  protected abstract processInput(input: DeployInput, options: DeploymentOptions): Promise<StaticFile[]>;

  /**
   * Ensure full initialization is complete - called lazily by resources
   */
  protected async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.loadFullConfig();
    }
    return this.initPromise;
  }

  /**
   * Ping the API server to check connectivity
   */
  async ping(): Promise<boolean> {
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
  
}