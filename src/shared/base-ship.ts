/**
 * @file Base Ship SDK class — shared functionality across environments.
 *
 * The constructor is fully synchronous: an `ApiHttp` instance is built immediately
 * with whatever credentials the caller supplied (and, in Node, env vars merged in
 * by the subclass before `super()`). The only deferred work is the one-shot
 * `GET /limits` fetch that hydrates platform limits — that's lazy and runs on
 * first API call via `ensureInitialized()`.
 *
 * Subclasses only override what genuinely differs per environment:
 *   - `processInput()` — Node reads paths from disk; Browser handles `File[]`
 *   - `getDeployBodyCreator()` — Node streams Buffers; Browser builds Blobs
 *
 * Everything else (the credential slot, resources, events, lazy platform-limits)
 * lives here.
 */

import type {
  AccountResource,
  DeploymentCreateResponse,
  DeploymentResource,
  DomainResource,
  PlatformLimits,
  StaticFile,
  TokenResource,
} from '@shipstatic/types';
import { ShipError, validateCaller, validateToken } from '@shipstatic/types';

import { ApiHttp } from './api/http.js';
import {
  createAccountResource,
  createDeploymentResource,
  createDomainResource,
  createTokenResource,
  type DeployInput,
} from './resources.js';
import type {
  DeployBodyCreator,
  DeploymentOptions,
  ShipClientOptions,
  ShipEvents,
  TokenProvider,
} from './types.js';

/**
 * Abstract base class for Ship SDK implementations.
 */
export abstract class Ship {
  // Resource handles, created once at construction. Each is a thin facade
  // bound to `this.http` plus the lazy-init callback.
  // Parameterized with the SDK's extended options (timeout, callbacks,
  // signal…) — the interface's documented extension point, so typed
  // consumers can pass them without casts.
  public readonly deployments: DeploymentResource<DeploymentOptions>;
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

  // The credential slot — one platform token (any population) or a provider
  // that supplies one per request. Read dynamically on every request through
  // `getAuthHeaders`, so `setToken` takes effect without rebuilding the client.
  private credential: string | TokenProvider | null = null;

  constructor(options: ShipClientOptions = {}) {
    // SDK-boundary normalization: an empty-string token is absence of
    // credential intent, never a credential. Empty strings reach here from
    // shell-expansion of unset CI variables, empty form fields in browser
    // apps, and any other path that produces `''` instead of `undefined`.
    // Normalizing once at the SDK boundary covers every entry point: CLI,
    // Browser SDK, Node SDK, embedded consumers, and direct base-class use.
    options = {
      ...options,
      apiUrl: options.apiUrl || undefined,
      token: options.token || undefined,
      caller: options.caller || undefined,
    };
    this.clientOptions = options;

    // Caller identity is validated at the boundary like the token: a value
    // the API would silently drop (the header is unauthenticated) is a
    // configuration error here, never a quiet fallback to IP bucketing.
    if (options.caller !== undefined) {
      validateCaller(options.caller);
    }

    // One client, one identity. A token and a cookie session are different
    // principals — holding both is a configuration error, not a precedence
    // question.
    if (options.token && options.session) {
      throw ShipError.config('Provide either `token` or `session`, not both.');
    }

    // Static tokens are validated at the boundary (prefix-classified, same
    // rules the server applies); providers are invoked per request instead.
    if (typeof options.token === 'string') {
      validateToken(options.token);
      this.credential = options.token;
    } else if (options.token) {
      this.credential = options.token;
    }

    // Build the HTTP client once. The `getAuthHeaders` callback reads
    // `this.credential` dynamically on every request.
    this.http = new ApiHttp({
      ...options,
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
    });
    this.domains = createDomainResource(ctx);
    this.account = createAccountResource(ctx);
    this.tokens = createTokenResource(ctx);
  }

  // Environment-specific behavior.
  protected abstract processInput(
    input: DeployInput,
    options: DeploymentOptions,
  ): Promise<StaticFile[]>;
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
  async deploy(input: DeployInput, options?: DeploymentOptions): Promise<DeploymentCreateResponse> {
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
    // biome-ignore lint/style/noNonNullAssertion: ensureInitialized() hydrates platformLimits or throws
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
   * Sets the client token — any platform token (API key, deploy token, OAuth
   * access token) or a {@link TokenProvider} invoked per request. Replaces
   * whatever credential the client held before.
   * @param token A platform token, sent verbatim, or a provider function
   */
  public setToken(token: string | TokenProvider): void {
    // One client, one identity — the constructor's token/session exclusion
    // holds for the client's whole life, not just its first moment.
    if (this.clientOptions.session) {
      throw ShipError.config('Provide either `token` or `session`, not both.');
    }
    if (typeof token === 'string') {
      if (!token) {
        throw ShipError.business('Invalid token provided. Token must be a non-empty string.');
      }
      validateToken(token);
      this.credential = token;
      return;
    }
    if (typeof token !== 'function') {
      throw ShipError.business(
        'Invalid token provided. Token must be a non-empty string or a provider function.',
      );
    }
    this.credential = token;
  }

  /**
   * Resolve the credential slot into request headers. Async because a
   * provider may mint or refresh its token per request.
   *
   * Anonymity requires proven absence of credentials: a configured provider
   * that yields nothing is an error — the request fails typed rather than
   * silently proceeding as an anonymous public deploy. Empty-string
   * normalization at the constructor is the same invariant's boundary
   * condition: `''` is absence of intent, so it never reaches this point.
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    if (this.credential === null) return {};
    const value = typeof this.credential === 'function' ? await this.credential() : this.credential;
    if (!value) {
      throw ShipError.authentication('Token provider returned no token.');
    }
    if (typeof value !== 'string') {
      throw ShipError.authentication('Token provider returned a non-string value.');
    }
    return { Authorization: `Bearer ${value}` };
  }
}
