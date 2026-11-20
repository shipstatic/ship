/**
 * @file The `Ship` class: the whole SDK, wherever it runs.
 *
 * A browser, a Worker, Node, Bun and Deno all have `File`, so this class deploys
 * `File`s on every one of them. The one thing a runtime can add is another
 * way to find a deploy's files, by overriding `sources()`: Node's `Ship` adds
 * paths on a filesystem, and nothing else differs between the two.
 *
 * The constructor is synchronous: the transport is built at once from the
 * credential the caller supplied (in Node, with the `SHIP_*` variables
 * merged in by the subclass before `super()`).
 *
 * Platform limits are the account's policy, and the server may change them
 * at any time (a plan move, an operator's grant), so the client never holds
 * them: `getLimits()` asks every time, and each deploy of a site reads them
 * once, when it has found its files. A client that lives as long as a browser
 * tab would otherwise judge today's upload by the limits of the morning, and
 * the only calls that pay the request are the two that read the answer.
 */

import type {
  AccountResource,
  DeployInput,
  DeploymentCreateResponse,
  DeploymentResource,
  DomainResource,
  PingResponse,
  PlatformLimits,
  TokenResource,
} from '@shipstatic/types';
import { API_PATHS, ShipError, validateCaller, validateToken } from '@shipstatic/types';
import { ApiHttp } from './api/http.js';
import { type DeploySource, processDeployFiles } from './core/deploy-files.js';
import {
  FILES_EXPECTED,
  fileSources,
  isFiles,
  isPaths,
  PATHS_NEED_A_FILESYSTEM,
} from './core/deploy-input.js';
import {
  createAccountResource,
  createDeploymentResource,
  createDomainResource,
  createTokenResource,
} from './resources.js';
import type { DeploymentOptions, ShipClientOptions, ShipEvents, TokenProvider } from './types.js';

/**
 * The Ship SDK client.
 */
export class Ship {
  // Resource handles, created once at construction. Each is a thin facade
  // bound to `this.http`. The deployment resource is parameterized with the
  // SDK's own deploy options (`signal`, `pathDetect`), the interface's
  // extension point, so a typed consumer passes them without a cast.
  public readonly deployments: DeploymentResource<DeploymentOptions>;
  public readonly domains: DomainResource;
  public readonly account: AccountResource;
  public readonly tokens: TokenResource;

  // The HTTP client and merged options are private: a subclass meets this
  // class through `sources()` and never by reaching into these fields.
  // Tests bypass via `(ship as any).http = ...`.
  private readonly http: ApiHttp;
  private readonly clientOptions: ShipClientOptions;

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
    // a browser, a Worker, Node, and every consumer that embeds the SDK.
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
    });

    const ctx = { getApi: () => this.http };

    this.deployments = createDeploymentResource({
      ...ctx,
      // A deploy's files, in the order it happens: find them, read the
      // platform limits, judge and hash. The limits are read once per deploy
      // and after the finding, so input that is refused on its own (a path
      // that is not there, a project that is not built) costs no request,
      // and the files are judged by the limits the server states now. The
      // pipeline asks only for a site, which is all the limits judge. The
      // read carries the deploy's own signal, so a cancelled deploy stops
      // here too, not only at its final POST.
      prepareFiles: async (input, opts) =>
        processDeployFiles(await this.sources(input), opts, () =>
          this.getLimits({ signal: opts.signal }),
        ),
    });
    this.domains = createDomainResource(ctx);
    this.account = createAccountResource(ctx);
    this.tokens = createTokenResource(ctx);
  }

  /**
   * What a deploy's input holds, as the shared pipeline takes it. `File`s
   * are sources wherever this runs. A path needs a filesystem to be read
   * from, which is what Node's `Ship` adds.
   *
   * @internal The seam between this package's two builds, and no extension
   * point: it is `protected` so the Node build can override it, and it may
   * change in any release.
   */
  protected async sources(input: DeployInput): Promise<DeploySource[]> {
    if (isFiles(input)) return fileSources(input);
    throw ShipError.business(isPaths(input) ? PATHS_NEED_A_FILESYSTEM : FILES_EXPECTED);
  }

  /**
   * Ping the API server, resolving its answer: `{ success, timestamp }`, where
   * `timestamp` is the server clock in unix SECONDS.
   *
   * It resolves the response rather than a bare `true` because every other
   * method here does — narrowing to a boolean discarded the one thing ping
   * carries beyond liveness, and made `success` mean a boolean on the wire and
   * something else by the time it reached a caller. A non-OK response throws in
   * transport, so a resolved value always means the API answered.
   */
  async ping(): Promise<PingResponse> {
    return this.http.request<PingResponse>(API_PATHS.PING, { method: 'GET' }, 'Ping');
  }

  /**
   * Deploy `File`s, or in Node a path or a list of paths (a shortcut to
   * `ship.deployments.upload()`).
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
   * Get the platform limits the server states now (max file size, file count,
   * total size, and the blocked extensions). Asked every time and never held,
   * since a plan move or an operator's grant changes them. A `signal` aborts
   * the request, rejecting with the typed `Cancelled` error.
   */
  async getLimits(options: { signal?: AbortSignal } = {}): Promise<PlatformLimits> {
    return this.http.request<PlatformLimits>(
      API_PATHS.LIMITS,
      { method: 'GET', signal: options.signal ?? null },
      'Get limits',
    );
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
