/**
 * @file HTTP client for Ship API.
 */
import type {
  AccountGetResponse,
  Deployment,
  DeploymentCreateResponse,
  DeploymentDeleteResponse,
  DeploymentListResponse,
  Domain,
  DomainDeleteResponse,
  DomainDnsResponse,
  DomainListResponse,
  DomainRecordsResponse,
  DomainShareResponse,
  DomainValidateResponse,
  DomainVerifyResponse,
  ListOptions,
  PingResponse,
  PlatformLimits,
  SPACheckRequest,
  SPACheckResponse,
  StaticFile,
  Token,
  TokenCreateResponse,
  TokenDeleteResponse,
  TokenListResponse,
} from '@shipstatic/types';
import {
  API_PATHS,
  CALLER,
  DEFAULT_API,
  IDEMPOTENCY_KEY_CONSTRAINTS,
  ShipError,
  validateIdempotencyKey,
} from '@shipstatic/types';
import { SimpleEvents } from '../events.js';
import { validateDeployConfig, validateLabels, validatePassword } from '../lib/validation.js';
import type {
  ApiDeployOptions,
  DeployBodyCreator,
  DomainSetResult,
  Fetch,
  ShipClientOptions,
} from '../types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_REQUEST_TIMEOUT = 30_000;

/**
 * Deploys get their own ceilings, because one budget cannot fit every
 * operation this client performs.
 *
 * 30s is right for a metadata read — `/ping`, `/account`, a page of a list —
 * where anything slower is a fault rather than a big payload. A deploy is
 * bounded by the PLATFORM's limits instead: `DEPLOYMENT.MAX_TOTAL_SIZE` is
 * 50MB, and 50MB in 30s needs ~13 Mbit/s of sustained UPLOAD, above what most
 * residential links give. A deployment the API explicitly permits was being
 * aborted here by default — which is the exact failure `Idempotency-Key`
 * exists to repair, so the cause had to go and not merely the remedy.
 *
 * 5 minutes covers 50MB at ~1.4 Mbit/s.
 */
const DEFAULT_DEPLOY_TIMEOUT = 300_000;

/**
 * The server's own budget for a build, mirrored here because the client has
 * to outlast it: the API gives the build service
 * `PERFORMANCE.BUILD_SERVICE_TIMEOUT` (`cloudflare/api/src/lib/config.ts`),
 * and that work begins only after the upload lands.
 *
 * **Raising it there must raise it here.** The two sit in different repos, so
 * nothing can fence the pair; the constraint is stated at both ends instead.
 */
const BUILD_SERVICE_BUDGET = 300_000;

/**
 * A deploy that also builds: the upload, then the build, then the commit.
 *
 * Written as a sum rather than a number, so the name and the value compose
 * the same way — `DEPLOY` plus `BUILD` on one side, the deploy budget plus
 * the build budget on the other. A magic `600_000` would state the result
 * and hide the reasoning, and the reasoning is the part that has to survive
 * someone tuning either half.
 */
const DEFAULT_DEPLOY_BUILD_TIMEOUT = DEFAULT_DEPLOY_TIMEOUT + BUILD_SERVICE_BUDGET;

/**
 * This client's identity in a deployment's `via` field.
 *
 * Every surface that deploys names itself: the CLI sends `cli`, the GitHub
 * Action `git`, the MCP server `mcp`, the VS Code extension `vsc`, the web
 * apps `web`. A direct SDK call is `sdk`. Each surface owns its own string —
 * there is deliberately no central registry, since integrations outside this
 * repo mint their own.
 *
 * Applied at this one wire boundary, so `via` is populated on every deploy
 * from every platform: an absent value means an unattributed caller (raw
 * HTTP), never "probably the SDK".
 */
const DEPLOY_VIA = 'sdk';

/**
 * Serialize pagination options into a query string, or '' when there are
 * none — the paginated list endpoints accept `limit` and `cursor`.
 */
function listQuery(options?: ListOptions): string {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) params.set('limit', String(options.limit));
  if (options?.cursor !== undefined) params.set('cursor', options.cursor);
  const query = params.toString();
  return query ? `?${query}` : '';
}

// =============================================================================
// TYPES
// =============================================================================

export interface ApiHttpOptions extends ShipClientOptions {
  /** Resolves the credential slot per request — async so token providers can mint/refresh. */
  getAuthHeaders: () => Record<string, string> | Promise<Record<string, string>>;
  createDeployBody: DeployBodyCreator;
}

interface RequestResult<T> {
  data: T;
  status: number;
}

// =============================================================================
// HTTP CLIENT
// =============================================================================

export class ApiHttp extends SimpleEvents {
  private readonly apiUrl: string;
  private readonly getAuthHeadersCallback: () =>
    | Record<string, string>
    | Promise<Record<string, string>>;
  private readonly session: boolean;
  private readonly caller: string | undefined;
  private readonly timeout: number;
  private readonly deployTimeout: number;
  private readonly deployBuildTimeout: number;
  private readonly fetch: Fetch;
  private readonly createDeployBody: DeployBodyCreator;
  private readonly deployEndpoint: string;
  private globalHeaders: Record<string, string> = {};

  constructor(options: ApiHttpOptions) {
    super();
    this.apiUrl = options.apiUrl || DEFAULT_API;
    this.getAuthHeadersCallback = options.getAuthHeaders;
    this.session = options.session ?? false;
    this.caller = options.caller;
    this.timeout = options.timeout ?? DEFAULT_REQUEST_TIMEOUT;
    // An explicit timeout is the caller's whole answer and applies to deploys
    // too — they asked for a ceiling, not for one with an exception. Only the
    // DEFAULT splits by operation.
    this.deployTimeout = options.timeout ?? DEFAULT_DEPLOY_TIMEOUT;
    this.deployBuildTimeout = options.timeout ?? DEFAULT_DEPLOY_BUILD_TIMEOUT;
    // Bind to globalThis when falling back to the platform `fetch` — browsers
    // require `this === window` on `window.fetch` and throw "Illegal invocation"
    // when it's invoked as a property of any other object.
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.createDeployBody = options.createDeployBody;
    this.deployEndpoint = options.deployEndpoint || API_PATHS.DEPLOYMENTS;
  }

  /**
   * Set global headers included in every request.
   * Priority: globalHeaders (lowest) < instance auth < per-request headers (highest)
   */
  setGlobalHeaders(headers: Record<string, string>): void {
    this.globalHeaders = headers;
  }

  // ===========================================================================
  // CORE REQUEST INFRASTRUCTURE
  // ===========================================================================

  /**
   * Execute HTTP request with timeout, events, and error handling
   */
  private async executeRequest<T>(
    url: string,
    options: RequestInit,
    operationName: string,
    timeoutMs: number = this.timeout,
  ): Promise<RequestResult<T>> {
    let cleanup = () => {};

    try {
      // Credential resolution runs inside the error boundary: a token
      // provider that throws or yields nothing fails the request through
      // the same typed path (and `error` event) as any transport failure.
      const headers = await this.mergeHeaders(options.headers as Record<string, string>);
      const timeout = this.createTimeoutSignal(options.signal, timeoutMs);
      cleanup = timeout.cleanup;

      const fetchOptions: RequestInit = {
        ...options,
        headers,
        credentials: this.session && !headers.Authorization ? 'include' : undefined,
        signal: timeout.signal,
      };

      this.emit('request', url, fetchOptions);

      const response = await this.fetch(url, fetchOptions);
      cleanup();

      if (!response.ok) {
        throw await ShipError.fromHttpResponse(response, operationName);
      }

      this.emit('response', this.safeClone(response), url);
      const data = await this.parseResponse<T>(this.safeClone(response));
      return { data, status: response.status };
    } catch (error) {
      cleanup();
      // Normalize anything thrown above (credential resolution, fetch
      // failure, abort, response error) into a ShipError.
      // fromFetchError passes existing ShipErrors through unchanged.
      const shipError = ShipError.fromFetchError(error, operationName);
      this.emit('error', shipError, url);
      throw shipError;
    }
  }

  /**
   * Simple request - returns data only
   */
  private async request<T>(
    url: string,
    options: RequestInit,
    operationName: string,
    timeoutMs?: number,
  ): Promise<T> {
    const { data } = await this.executeRequest<T>(url, options, operationName, timeoutMs);
    return data;
  }

  /**
   * Request with status - returns data and HTTP status code
   */
  private async requestWithStatus<T>(
    url: string,
    options: RequestInit,
    operationName: string,
  ): Promise<RequestResult<T>> {
    return this.executeRequest<T>(url, options, operationName);
  }

  // ===========================================================================
  // REQUEST HELPERS
  // ===========================================================================

  private async mergeHeaders(
    customHeaders: Record<string, string> = {},
  ): Promise<Record<string, string>> {
    // `caller` is instance identity metadata, like the credential: the
    // rate limiter buckets by X-Caller on every write, so it rides every
    // request rather than any single operation.
    return {
      ...this.globalHeaders,
      ...(this.caller ? { [CALLER.HEADER]: this.caller } : {}),
      ...(await this.getAuthHeadersCallback()),
      ...customHeaders,
    };
  }

  private createTimeoutSignal(
    existingSignal?: AbortSignal | null,
    timeoutMs: number = this.timeout,
  ): {
    signal: AbortSignal;
    cleanup: () => void;
  } {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (existingSignal) {
      const abort = () => controller.abort();
      existingSignal.addEventListener('abort', abort);
      if (existingSignal.aborted) controller.abort();
    }

    return {
      signal: controller.signal,
      cleanup: () => clearTimeout(timeoutId),
    };
  }

  private safeClone(response: Response): Response {
    try {
      return response.clone();
    } catch {
      return response;
    }
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    if (response.headers.get('Content-Length') === '0' || response.status === 204) {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  }

  // ===========================================================================
  // PUBLIC API - DEPLOYMENTS
  // ===========================================================================

  async deploy(
    files: StaticFile[],
    options: ApiDeployOptions = {},
  ): Promise<DeploymentCreateResponse> {
    if (!files.length) {
      throw ShipError.business('No files to deploy');
    }
    for (const file of files) {
      if (!file.md5) {
        throw ShipError.file(`MD5 checksum missing for file: ${file.path}`, {
          filePath: file.path,
        });
      }
    }

    // Fast-fail on definitely-invalid input before constructing a multipart body.
    validatePassword(options.password);
    const idempotencyKey = validateIdempotencyKey(options.idempotencyKey);
    const labels = validateLabels(options.labels);
    await validateDeployConfig(files);

    const flags =
      options.build || options.prerender || options.spa
        ? { build: options.build, prerender: options.prerender, spa: options.spa }
        : undefined;
    const { body, headers: bodyHeaders } = await this.createDeployBody(files, {
      labels,
      via: options.via ?? DEPLOY_VIA,
      password: options.password,
      flags,
      captcha: options.captcha,
    });

    // The key rides a header, not the body, because it must be readable
    // before the request is parsed — the API replays a stored 201 ahead of
    // the write budget, so a retry costs nothing.
    return this.request<DeploymentCreateResponse>(
      `${this.apiUrl}${this.deployEndpoint}`,
      {
        method: 'POST',
        body,
        headers: idempotencyKey
          ? { ...bodyHeaders, [IDEMPOTENCY_KEY_CONSTRAINTS.HEADER]: idempotencyKey }
          : bodyHeaders,
        signal: options.signal || null,
      },
      'Deploy',
      // Only `build`/`prerender` reach the build service
      // (`api/src/lib/upload-processing.ts:35`); `spa` is local detection
      // bounded by the AI tier's own 10s, so it does not earn the longer
      // ceiling.
      options.build || options.prerender ? this.deployBuildTimeout : this.deployTimeout,
    );
  }

  async listDeployments(options?: ListOptions): Promise<DeploymentListResponse> {
    return this.request(
      `${this.apiUrl}${API_PATHS.DEPLOYMENTS}${listQuery(options)}`,
      { method: 'GET' },
      'List deployments',
    );
  }

  async getDeployment(id: string): Promise<Deployment> {
    return this.request(
      `${this.apiUrl}${API_PATHS.DEPLOYMENT(encodeURIComponent(id))}`,
      { method: 'GET' },
      'Get deployment',
    );
  }

  async updateDeploymentLabels(id: string, labels: string[]): Promise<Deployment> {
    const normalized = validateLabels(labels);
    return this.request(
      `${this.apiUrl}${API_PATHS.DEPLOYMENT(encodeURIComponent(id))}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labels: normalized }),
      },
      'Update deployment labels',
    );
  }

  async deleteDeployment(id: string): Promise<DeploymentDeleteResponse> {
    return this.request<DeploymentDeleteResponse>(
      `${this.apiUrl}${API_PATHS.DEPLOYMENT(encodeURIComponent(id))}`,
      { method: 'DELETE' },
      'Delete deployment',
    );
  }

  // ===========================================================================
  // PUBLIC API - DOMAINS
  // ===========================================================================
  // All domain methods accept FQDN (Fully Qualified Domain Name) as the `name` parameter.
  // The SDK does not validate or normalize - the API handles all domain semantics.

  async setDomain(name: string, deployment?: string, labels?: string[]): Promise<DomainSetResult> {
    const normalized = validateLabels(labels);
    const body: { deployment?: string; labels?: string[] } = {};
    if (deployment) body.deployment = deployment;
    if (normalized !== undefined) body.labels = normalized;

    const { data, status } = await this.requestWithStatus<Domain>(
      `${this.apiUrl}${API_PATHS.DOMAIN(encodeURIComponent(name))}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Set domain',
    );

    return { ...data, isCreate: status === 201 };
  }

  async listDomains(options?: ListOptions): Promise<DomainListResponse> {
    return this.request(
      `${this.apiUrl}${API_PATHS.DOMAINS}${listQuery(options)}`,
      { method: 'GET' },
      'List domains',
    );
  }

  async getDomain(name: string): Promise<Domain> {
    return this.request(
      `${this.apiUrl}${API_PATHS.DOMAIN(encodeURIComponent(name))}`,
      { method: 'GET' },
      'Get domain',
    );
  }

  async deleteDomain(name: string): Promise<DomainDeleteResponse> {
    return this.request<DomainDeleteResponse>(
      `${this.apiUrl}${API_PATHS.DOMAIN(encodeURIComponent(name))}`,
      { method: 'DELETE' },
      'Delete domain',
    );
  }

  async verifyDomain(name: string): Promise<DomainVerifyResponse> {
    return this.request(
      `${this.apiUrl}${API_PATHS.DOMAIN_VERIFY(encodeURIComponent(name))}`,
      { method: 'POST' },
      'Verify domain',
    );
  }

  async getDomainDns(name: string): Promise<DomainDnsResponse> {
    return this.request(
      `${this.apiUrl}${API_PATHS.DOMAIN_DNS(encodeURIComponent(name))}`,
      { method: 'GET' },
      'Get domain DNS',
    );
  }

  async getDomainRecords(name: string): Promise<DomainRecordsResponse> {
    return this.request(
      `${this.apiUrl}${API_PATHS.DOMAIN_RECORDS(encodeURIComponent(name))}`,
      { method: 'GET' },
      'Get domain records',
    );
  }

  async getDomainShare(name: string): Promise<DomainShareResponse> {
    return this.request(
      `${this.apiUrl}${API_PATHS.DOMAIN_SHARE(encodeURIComponent(name))}`,
      { method: 'GET' },
      'Get domain share',
    );
  }

  async validateDomain(name: string): Promise<DomainValidateResponse> {
    return this.request(
      `${this.apiUrl}${API_PATHS.DOMAINS_VALIDATE}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: name }),
      },
      'Validate domain',
    );
  }

  // ===========================================================================
  // PUBLIC API - TOKENS
  // ===========================================================================

  async createToken(ttl?: number, labels?: string[]): Promise<TokenCreateResponse> {
    const normalized = validateLabels(labels);
    const body: { ttl?: number; labels?: string[] } = {};
    if (ttl !== undefined) body.ttl = ttl;
    if (normalized !== undefined) body.labels = normalized;

    return this.request(
      `${this.apiUrl}${API_PATHS.TOKENS}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Create token',
    );
  }

  async listTokens(options?: ListOptions): Promise<TokenListResponse> {
    return this.request(
      `${this.apiUrl}${API_PATHS.TOKENS}${listQuery(options)}`,
      { method: 'GET' },
      'List tokens',
    );
  }

  async deleteToken(token: string): Promise<TokenDeleteResponse> {
    return this.request<TokenDeleteResponse>(
      `${this.apiUrl}${API_PATHS.TOKEN(encodeURIComponent(token))}`,
      { method: 'DELETE' },
      'Delete token',
    );
  }

  async getToken(token: string): Promise<Token> {
    return this.request<Token>(
      `${this.apiUrl}${API_PATHS.TOKEN(encodeURIComponent(token))}`,
      { method: 'GET' },
      'Get token',
    );
  }

  // ===========================================================================
  // PUBLIC API - ACCOUNT & CONFIG
  // ===========================================================================

  async getAccount(): Promise<AccountGetResponse> {
    return this.request(`${this.apiUrl}${API_PATHS.ACCOUNT}`, { method: 'GET' }, 'Get account');
  }

  async getLimits(): Promise<PlatformLimits> {
    return this.request(`${this.apiUrl}${API_PATHS.LIMITS}`, { method: 'GET' }, 'Get limits');
  }

  async ping(): Promise<PingResponse> {
    return this.request<PingResponse>(`${this.apiUrl}${API_PATHS.PING}`, { method: 'GET' }, 'Ping');
  }

  // ===========================================================================
  // PUBLIC API - SPA CHECK
  // ===========================================================================

  async checkSPA(files: StaticFile[], _options: ApiDeployOptions = {}): Promise<boolean> {
    const indexFile = files.find((f) => f.path === 'index.html' || f.path === '/index.html');
    if (!indexFile || indexFile.size > 100 * 1024) {
      return false;
    }

    let indexContent: string;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(indexFile.content)) {
      indexContent = indexFile.content.toString('utf-8');
    } else if (typeof Blob !== 'undefined' && indexFile.content instanceof Blob) {
      indexContent = await indexFile.content.text();
    } else if (typeof File !== 'undefined' && indexFile.content instanceof File) {
      indexContent = await indexFile.content.text();
    } else {
      return false;
    }

    const body: SPACheckRequest = { files: files.map((f) => f.path), index: indexContent };
    const response = await this.request<SPACheckResponse>(
      `${this.apiUrl}${API_PATHS.SPA_CHECK}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'SPA check',
    );

    return response.isSPA;
  }
}
