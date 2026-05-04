/**
 * @file Base Ship SDK class — shared functionality across environments.
 *
 * The constructor is fully synchronous: an `ApiHttp` instance is built immediately
 * with whatever credentials the caller supplied (and, in Node, env vars merged in
 * by the subclass before `super()`). The only deferred work is the one-shot
 * `GET /config` fetch that hydrates platform limits — that's lazy and runs on
 * first API call via `ensureInitialized()`.
 *
 * Subclasses only override what genuinely differs per environment:
 *   - `processInput()` — Node reads paths from disk; Browser handles `File[]`
 *   - `getDeployBodyCreator()` — Node streams Buffers; Browser builds Blobs
 *
 * Everything else (auth state, resources, events, lazy platform-limits) lives here.
 */

import { ShipError } from '@shipstatic/types';
import type {
  Deployment,
  PlatformLimits,
  DeploymentResource,
  DomainResource,
  AccountResource,
  TokenResource,
  StaticFile,
} from '@shipstatic/types';

import { ApiHttp } from './api/http.js';
import { resolveConfig } from './core/config.js';
import {
  createDeploymentResource,
  createDomainResource,
  createAccountResource,
  createTokenResource,
  type DeployInput,
} from './resources.js';
import type {
  ShipClientOptions,
  ShipEvents,
  DeploymentOptions,
  DeployBodyCreator,
} from './types.js';

/**
 * Authentication state for the Ship instance.
 * Discriminated union ensures only one auth method is active at a time.
 */
type AuthState =
  | { type: 'token'; value: string }
  | { type: 'apiKey'; value: string }
  | null;

/**
 * Abstract base class for Ship SDK implementations.
 */
export abstract class Ship {
  // Resource handles, created once at construction. Each is a thin facade
  // bound to `this.http` plus the lazy-init callback.
  public readonly deployments: DeploymentResource;
  public readonly domains: DomainResource;
  public readonly account: AccountResource;
  public readonly tokens: TokenResource;

  // The HTTP client and merged options are private — subclasses interact
  // with the base class through the abstract methods below, never by
  // reaching into these fields. Tests bypass via `(ship as any).http = ...`.
  private readonly http: ApiHttp;
  private readonly clientOptions: ShipClientOptions;

  // Lazy-init plumbing for the one-shot `GET /config` fetch.
  // `platformLimits` is INSTANCE state (not a module-level singleton): two
  // Ships against different `apiUrl`s — staging + prod, multi-tenant
  // orchestrators, n8n with multiple credentials — must not clobber each
  // other's limits. Each instance owns its hydrated copy.
  // `protected` so subclasses' `processInput` can pass it down to the
  // platform-specific file-validation utilities.
  private initPromise: Promise<void> | null = null;
  protected platformLimits: PlatformLimits | null = null;

  // Auth state — consulted dynamically on every request through `getAuthHeaders`.
  private auth: AuthState = null;

  constructor(options: ShipClientOptions = {}) {
    // SDK-boundary normalization: empty-string credentials are never valid,
    // and storing them would pollute `mergeDeployOptions` (which checks
    // `=== undefined`, not falsy) and silently suppress per-call defaults
    // — turning what should have been an authenticated deploy into an
    // anonymous PUBLIC_ACCOUNT deploy via the agent-token fallback.
    //
    // Empty strings reach here from shell-expansion of unset CI variables,
    // empty form fields in browser apps, and any other path that produces
    // `''` instead of `undefined`. Normalizing once at the SDK boundary
    // covers every entry point: CLI, Browser SDK, Node SDK, embedded
    // consumers, and direct base-class use in tests.
    options = {
      ...options,
      apiUrl: options.apiUrl || undefined,
      apiKey: options.apiKey || undefined,
      deployToken: options.deployToken || undefined,
    };
    this.clientOptions = options;

    // Initialize auth state from constructor options.
    // Deploy token outranks API key when both are provided.
    if (options.deployToken) {
      this.auth = { type: 'token', value: options.deployToken };
    } else if (options.apiKey) {
      this.auth = { type: 'apiKey', value: options.apiKey };
    }

    // Build the HTTP client once. The `getAuthHeaders` callback reads `this.auth`
    // dynamically on every request, so `setApiKey()` / `setDeployToken()` take
    // effect immediately without needing to rebuild the client.
    this.http = new ApiHttp({
      ...options,
      ...resolveConfig(options),
      getAuthHeaders: () => this.getAuthHeaders(),
      createDeployBody: this.getDeployBodyCreator(),
    });

    const ctx = {
      getApi: () => this.http,
      ensureInit: () => this.ensureInitialized(),
    };

    this.deployments = createDeploymentResource({
      ...ctx,
      processInput: (input, opts) => this.processInput(input, opts),
      clientDefaults: this.clientOptions,
      hasAuth: () => this.hasAuth(),
    });
    this.domains = createDomainResource(ctx);
    this.account = createAccountResource(ctx);
    this.tokens = createTokenResource(ctx);
  }

  // Environment-specific behavior.
  protected abstract processInput(input: DeployInput, options: DeploymentOptions): Promise<StaticFile[]>;
  protected abstract getDeployBodyCreator(): DeployBodyCreator;

  /**
   * Lazy initialization — fetches platform limits (file size / count caps) once,
   * on the first API call. Subsequent calls reuse the resolved promise.
   */
  protected async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.fetchPlatformLimits();
    }
    return this.initPromise;
  }

  private async fetchPlatformLimits(): Promise<void> {
    try {
      this.platformLimits = await this.http.getLimits();
    } catch (error) {
      // Reset so the next API call can retry initialization.
      this.initPromise = null;
      throw error;
    }
  }

  /**
   * Ping the API server to check connectivity.
   */
  async ping(): Promise<boolean> {
    await this.ensureInitialized();
    return this.http.ping();
  }

  /**
   * Deploy project (convenience shortcut to `ship.deployments.upload()`).
   */
  async deploy(input: DeployInput, options?: DeploymentOptions): Promise<Deployment> {
    return this.deployments.upload(input, options);
  }

  /**
   * Get current account information (convenience shortcut to `ship.account.get()`).
   */
  async whoami() {
    return this.account.get();
  }

  /**
   * Get platform limits (max file size, file count, total size).
   * Reuses the response fetched during initialization. Per-instance state —
   * does not leak between concurrent Ships against different API URLs.
   */
  async getLimits(): Promise<PlatformLimits> {
    if (this.platformLimits) return this.platformLimits;
    await this.ensureInitialized();
    return this.platformLimits!;
  }

  on<K extends keyof ShipEvents>(event: K, handler: (...args: ShipEvents[K]) => void): void {
    this.http.on(event, handler);
  }

  off<K extends keyof ShipEvents>(event: K, handler: (...args: ShipEvents[K]) => void): void {
    this.http.off(event, handler);
  }

  /**
   * Set global headers included in every request.
   * Useful for injecting custom headers (e.g. for admin impersonation).
   */
  setHeaders(headers: Record<string, string>): void {
    this.http.setGlobalHeaders(headers);
  }

  /**
   * Clear all custom global headers.
   */
  clearHeaders(): void {
    this.http.setGlobalHeaders({});
  }

  /**
   * Sets the deploy token for authentication.
   * Overrides any previously set API key or deploy token.
   * @param token Deploy token (format: `token-<64-char-hex>`)
   */
  public setDeployToken(token: string): void {
    if (!token || typeof token !== 'string') {
      throw ShipError.business('Invalid deploy token provided. Deploy token must be a non-empty string.');
    }
    this.auth = { type: 'token', value: token };
  }

  /**
   * Sets the API key for authentication.
   * Overrides any previously set API key or deploy token.
   * @param key API key (format: `ship-<64-char-hex>`)
   */
  public setApiKey(key: string): void {
    if (!key || typeof key !== 'string') {
      throw ShipError.business('Invalid API key provided. API key must be a non-empty string.');
    }
    this.auth = { type: 'apiKey', value: key };
  }

  private getAuthHeaders(): Record<string, string> {
    if (!this.auth) return {};
    return { Authorization: `Bearer ${this.auth.value}` };
  }

  /**
   * Check whether authentication credentials are configured.
   * Used by resources to fail fast (or trigger the agent-token fallback) when
   * auth is required.
   */
  private hasAuth(): boolean {
    // useCredentials means cookies are used for auth — no explicit token needed.
    if (this.clientOptions.useCredentials) return true;
    return this.auth !== null;
  }
}
