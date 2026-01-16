/**
 * @file Base Ship SDK class - provides shared functionality across environments.
 */

import { ApiHttp } from './api/http.js';
import { ShipError } from '@shipstatic/types';
import type { ShipClientOptions, ShipEvents } from './types.js';
import type { Deployment, ConfigResponse } from '@shipstatic/types';
import { getCurrentConfig } from './core/platform-config.js';
import type { ResolvedConfig } from './core/config.js';

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
 * Authentication state for the Ship instance
 * Discriminated union ensures only one auth method is active at a time
 */
type AuthState =
  | { type: 'token'; value: string }
  | { type: 'apiKey'; value: string }
  | null;

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
  protected _config: ConfigResponse | null = null;

  // Authentication state management
  private auth: AuthState = null;

  // Store the auth headers callback to reuse when replacing HTTP client
  protected readonly authHeadersCallback: () => Record<string, string>;

  // Resource instances (initialized during creation)
  protected _deployments: DeploymentResource;
  protected _domains: DomainResource;
  protected _account: AccountResource;
  protected _tokens: TokenResource;

  constructor(options: ShipClientOptions = {}) {
    this.clientOptions = options;

    // Initialize auth state from constructor options
    // Prioritize deployToken over apiKey if both are provided
    if (options.deployToken) {
      this.auth = { type: 'token', value: options.deployToken };
    } else if (options.apiKey) {
      this.auth = { type: 'apiKey', value: options.apiKey };
    }

    // Create the auth headers callback once and reuse it
    this.authHeadersCallback = () => this.getAuthHeaders();

    // Initialize HTTP client with constructor options for immediate use
    const config = this.resolveInitialConfig(options);
    this.http = new ApiHttp({
      ...options,
      ...config,
      getAuthHeaders: this.authHeadersCallback
    });

    // Initialize resources with lazy loading support
    const initCallback = () => this.ensureInitialized();
    const getApi = () => this.http;

    // Pass the processInput method to deployment resource
    this._deployments = createDeploymentResource(
      getApi,
      this.clientOptions,
      initCallback,
      (input, options) => this.processInput(input, options),
      () => this.hasAuth()
    );
    this._domains = createDomainResource(getApi, initCallback);
    this._account = createAccountResource(getApi, initCallback);
    this._tokens = createTokenResource(getApi, initCallback);
  }

  // Abstract methods that environments must implement
  protected abstract resolveInitialConfig(options: ShipClientOptions): ResolvedConfig;
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
   * Get API configuration (file upload limits, etc.)
   * Reuses platform config fetched during initialization, then caches the result
   */
  async getConfig(): Promise<ConfigResponse> {
    if (this._config) {
      return this._config;
    }

    await this.ensureInitialized();
    // After initialization, platform config is already fetched - reuse it instead of making another API call
    this._config = getCurrentConfig();
    return this._config;
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

  /**
   * Sets the deploy token for authentication.
   * This will override any previously set API key or deploy token.
   * @param token The deploy token (format: token-<64-char-hex>)
   */
  public setDeployToken(token: string): void {
    if (!token || typeof token !== 'string') {
      throw ShipError.business('Invalid deploy token provided. Deploy token must be a non-empty string.');
    }
    this.auth = { type: 'token', value: token };
  }

  /**
   * Sets the API key for authentication.
   * This will override any previously set API key or deploy token.
   * @param key The API key (format: ship-<64-char-hex>)
   */
  public setApiKey(key: string): void {
    if (!key || typeof key !== 'string') {
      throw ShipError.business('Invalid API key provided. API key must be a non-empty string.');
    }
    this.auth = { type: 'apiKey', value: key };
  }

  /**
   * Generate authorization headers based on current auth state
   * Called dynamically on each request to ensure latest credentials are used
   * @private
   */
  private getAuthHeaders(): Record<string, string> {
    if (!this.auth) {
      return {};
    }

    switch (this.auth.type) {
      case 'token':
        return { 'Authorization': `Bearer ${this.auth.value}` };
      case 'apiKey':
        return { 'Authorization': `Bearer ${this.auth.value}` };
      default:
        return {};
    }
  }

  /**
   * Check if authentication credentials are configured
   * Used by resources to fail fast if auth is required
   * @private
   */
  private hasAuth(): boolean {
    // useCredentials means cookies are used for auth - no explicit token needed
    if (this.clientOptions.useCredentials) {
      return true;
    }
    return this.auth !== null;
  }

}