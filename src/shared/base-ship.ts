/**
 * @file Base Ship SDK class - provides shared functionality across environments.
 */

import { ApiHttp } from './api/http.js';
import { ShipError } from '@shipstatic/types';
import type { ShipClientOptions, ShipEvents } from './types.js';
import type { Deployment } from '@shipstatic/types';

// Resource imports
import {
  createDeploymentResource,
  createDomainResource,
  createAccountResource,
  createTokenResource,
  type DeployInput
} from './resources.js';
import type {
  DeploymentResource,
  DomainResource,
  AccountResource,
  TokenResource
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
  protected _domains: DomainResource;
  protected _account: AccountResource;
  protected _tokens: TokenResource;

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
    this._domains = createDomainResource(getApi, initCallback);
    this._account = createAccountResource(getApi, initCallback);
    this._tokens = createTokenResource(getApi, initCallback);
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
   * Get domains resource
   */
  get domains(): DomainResource {
    return this._domains;
  }

  /**
   * Get account resource
   */
  get account(): AccountResource {
    return this._account;
  }

  /**
   * Get tokens resource
   */
  get tokens(): TokenResource {
    return this._tokens;
  }

  /**
   * Add event listener
   * @param event - Event name
   * @param handler - Event handler function
   */
  on<K extends keyof ShipEvents>(event: K, handler: (...args: ShipEvents[K]) => void): void {
    this.http.on(event, handler);
  }

  /**
   * Remove event listener
   * @param event - Event name
   * @param handler - Event handler function
   */
  off<K extends keyof ShipEvents>(event: K, handler: (...args: ShipEvents[K]) => void): void {
    this.http.off(event, handler);
  }

  /**
   * Replace HTTP client while preserving event listeners
   * Used during initialization to maintain user event subscriptions
   * @protected
   */
  protected replaceHttpClient(newClient: ApiHttp): void {
    if (this.http?.transferEventsTo) {
      try {
        this.http.transferEventsTo(newClient);
      } catch (error) {
        // Event transfer failed - log but continue (better than crashing initialization)
        console.warn('Event transfer failed during client replacement:', error);
      }
    }
    this.http = newClient;
  }
  
}