/**
 * @file HTTP client for Ship API.
 */
import type {
  Deployment,
  DeploymentListResponse,
  PingResponse,
  ConfigResponse,
  DeploymentRemoveResponse,
  Domain,
  DomainListResponse,
  DomainDnsResponse,
  DomainRecordsResponse,
  Account,
  SPACheckRequest,
  SPACheckResponse,
  StaticFile,
  TokenCreateResponse,
  TokenListResponse
} from '@shipstatic/types';
import type { ApiDeployOptions, ShipClientOptions, ShipEvents, DeployBodyCreator } from '../types.js';
import { ShipError, isShipError, DEFAULT_API } from '@shipstatic/types';
import { SimpleEvents } from '../events.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const ENDPOINTS = {
  DEPLOYMENTS: '/deployments',
  DOMAINS: '/domains',
  TOKENS: '/tokens',
  ACCOUNT: '/account',
  CONFIG: '/config',
  PING: '/ping',
  SPA_CHECK: '/spa-check'
} as const;

const DEFAULT_REQUEST_TIMEOUT = 30000;

// =============================================================================
// TYPES
// =============================================================================

export interface ApiHttpOptions extends ShipClientOptions {
  getAuthHeaders: () => Record<string, string>;
  createDeployBody: DeployBodyCreator;
}

interface RequestResult<T> {
  data: T;
  status: number;
}

/** Shape of error response from API */
interface ApiErrorData {
  message?: string;
  error?: string;
}

// =============================================================================
// HTTP CLIENT
// =============================================================================

export class ApiHttp extends SimpleEvents {
  private readonly apiUrl: string;
  private readonly getAuthHeadersCallback: () => Record<string, string>;
  private readonly timeout: number;
  private readonly createDeployBody: DeployBodyCreator;

  constructor(options: ApiHttpOptions) {
    super();
    this.apiUrl = options.apiUrl || DEFAULT_API;
    this.getAuthHeadersCallback = options.getAuthHeaders;
    this.timeout = options.timeout ?? DEFAULT_REQUEST_TIMEOUT;
    this.createDeployBody = options.createDeployBody;
  }

  /**
   * Transfer events to another client
   */
  transferEventsTo(target: ApiHttp): void {
    this.transfer(target);
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
    operationName: string
  ): Promise<RequestResult<T>> {
    const headers = this.mergeHeaders(options.headers as Record<string, string>);
    const { signal, cleanup } = this.createTimeoutSignal(options.signal);

    const fetchOptions: RequestInit = {
      ...options,
      headers,
      credentials: !headers.Authorization ? 'include' : undefined,
      signal,
    };

    this.emit('request', url, fetchOptions);

    try {
      const response = await fetch(url, fetchOptions);
      cleanup();

      if (!response.ok) {
        await this.handleResponseError(response, operationName);
      }

      this.emit('response', this.safeClone(response), url);
      const data = await this.parseResponse<T>(this.safeClone(response));
      return { data, status: response.status };
    } catch (error) {
      cleanup();
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', err, url);
      this.handleFetchError(error, operationName);
    }
  }

  /**
   * Simple request - returns data only
   */
  private async request<T>(url: string, options: RequestInit, operationName: string): Promise<T> {
    const { data } = await this.executeRequest<T>(url, options, operationName);
    return data;
  }

  /**
   * Request with status - returns data and HTTP status code
   */
  private async requestWithStatus<T>(url: string, options: RequestInit, operationName: string): Promise<RequestResult<T>> {
    return this.executeRequest<T>(url, options, operationName);
  }

  // ===========================================================================
  // REQUEST HELPERS
  // ===========================================================================

  private mergeHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
    return { ...customHeaders, ...this.getAuthHeadersCallback() };
  }

  private createTimeoutSignal(existingSignal?: AbortSignal | null): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    if (existingSignal) {
      const abort = () => controller.abort();
      existingSignal.addEventListener('abort', abort);
      if (existingSignal.aborted) controller.abort();
    }

    return {
      signal: controller.signal,
      cleanup: () => clearTimeout(timeoutId)
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
  // ERROR HANDLING
  // ===========================================================================

  private async handleResponseError(response: Response, operationName: string): Promise<never> {
    let errorData: ApiErrorData = {};
    try {
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const json: unknown = await response.json();
        // Safely extract known fields from response
        if (json && typeof json === 'object') {
          const obj = json as Record<string, unknown>;
          if (typeof obj.message === 'string') errorData.message = obj.message;
          if (typeof obj.error === 'string') errorData.error = obj.error;
        }
      } else {
        errorData = { message: await response.text() };
      }
    } catch {
      errorData = { message: 'Failed to parse error response' };
    }

    const message = errorData.message || errorData.error || `${operationName} failed`;

    if (response.status === 401) {
      throw ShipError.authentication(message);
    }
    throw ShipError.api(message, response.status);
  }

  private handleFetchError(error: unknown, operationName: string): never {
    // Re-throw ShipErrors as-is
    if (isShipError(error)) {
      throw error;
    }
    // Handle abort errors
    if (error instanceof Error && error.name === 'AbortError') {
      throw ShipError.cancelled(`${operationName} was cancelled`);
    }
    // Handle network errors (fetch failures)
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw ShipError.network(`${operationName} failed: ${error.message}`, error);
    }
    // Handle other Error instances
    if (error instanceof Error) {
      throw ShipError.business(`${operationName} failed: ${error.message}`);
    }
    // Handle non-Error throws
    throw ShipError.business(`${operationName} failed: Unknown error`);
  }

  // ===========================================================================
  // PUBLIC API - DEPLOYMENTS
  // ===========================================================================

  async deploy(files: StaticFile[], options: ApiDeployOptions = {}): Promise<Deployment> {
    if (!files.length) {
      throw ShipError.business('No files to deploy');
    }
    for (const file of files) {
      if (!file.md5) {
        throw ShipError.file(`MD5 checksum missing for file: ${file.path}`, file.path);
      }
    }

    const { body, headers: bodyHeaders } = await this.createDeployBody(files, options.tags, options.via);

    const authHeaders: Record<string, string> = {};
    if (options.deployToken) {
      authHeaders['Authorization'] = `Bearer ${options.deployToken}`;
    } else if (options.apiKey) {
      authHeaders['Authorization'] = `Bearer ${options.apiKey}`;
    }
    if (options.caller) {
      authHeaders['X-Caller'] = options.caller;
    }

    return this.request<Deployment>(
      `${options.apiUrl || this.apiUrl}${ENDPOINTS.DEPLOYMENTS}`,
      { method: 'POST', body, headers: { ...bodyHeaders, ...authHeaders }, signal: options.signal || null },
      'Deploy'
    );
  }

  async listDeployments(): Promise<DeploymentListResponse> {
    return this.request(`${this.apiUrl}${ENDPOINTS.DEPLOYMENTS}`, { method: 'GET' }, 'List deployments');
  }

  async getDeployment(id: string): Promise<Deployment> {
    return this.request(`${this.apiUrl}${ENDPOINTS.DEPLOYMENTS}/${encodeURIComponent(id)}`, { method: 'GET' }, 'Get deployment');
  }

  async updateDeploymentTags(id: string, tags: string[]): Promise<Deployment> {
    return this.request(
      `${this.apiUrl}${ENDPOINTS.DEPLOYMENTS}/${encodeURIComponent(id)}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags }) },
      'Update deployment tags'
    );
  }

  async removeDeployment(id: string): Promise<void> {
    await this.request<DeploymentRemoveResponse>(
      `${this.apiUrl}${ENDPOINTS.DEPLOYMENTS}/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      'Remove deployment'
    );
  }

  // ===========================================================================
  // PUBLIC API - DOMAINS
  // ===========================================================================
  // All domain methods accept FQDN (Fully Qualified Domain Name) as the `name` parameter.
  // The SDK does not validate or normalize - the API handles all domain semantics.

  async setDomain(name: string, deployment?: string, tags?: string[]): Promise<Domain> {
    const body: { deployment?: string; tags?: string[] } = {};
    if (deployment) body.deployment = deployment;
    if (tags !== undefined) body.tags = tags;

    const { data, status } = await this.requestWithStatus<Domain>(
      `${this.apiUrl}${ENDPOINTS.DOMAINS}/${encodeURIComponent(name)}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      'Set domain'
    );

    return { ...data, isCreate: status === 201 };
  }

  async listDomains(): Promise<DomainListResponse> {
    return this.request(`${this.apiUrl}${ENDPOINTS.DOMAINS}`, { method: 'GET' }, 'List domains');
  }

  async getDomain(name: string): Promise<Domain> {
    return this.request(`${this.apiUrl}${ENDPOINTS.DOMAINS}/${encodeURIComponent(name)}`, { method: 'GET' }, 'Get domain');
  }

  async updateDomainTags(name: string, tags: string[]): Promise<Domain> {
    return this.request(
      `${this.apiUrl}${ENDPOINTS.DOMAINS}/${encodeURIComponent(name)}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags }) },
      'Update domain tags'
    );
  }

  async removeDomain(name: string): Promise<void> {
    await this.request<void>(`${this.apiUrl}${ENDPOINTS.DOMAINS}/${encodeURIComponent(name)}`, { method: 'DELETE' }, 'Remove domain');
  }

  async verifyDomain(name: string): Promise<{ message: string }> {
    return this.request(`${this.apiUrl}${ENDPOINTS.DOMAINS}/${encodeURIComponent(name)}/verify`, { method: 'POST' }, 'Verify domain');
  }

  async getDomainDns(name: string): Promise<DomainDnsResponse> {
    return this.request(`${this.apiUrl}${ENDPOINTS.DOMAINS}/${encodeURIComponent(name)}/dns`, { method: 'GET' }, 'Get domain DNS');
  }

  async getDomainRecords(name: string): Promise<DomainRecordsResponse> {
    return this.request(`${this.apiUrl}${ENDPOINTS.DOMAINS}/${encodeURIComponent(name)}/records`, { method: 'GET' }, 'Get domain records');
  }

  async getDomainShare(name: string): Promise<{ domain: string; hash: string }> {
    return this.request(`${this.apiUrl}${ENDPOINTS.DOMAINS}/${encodeURIComponent(name)}/share`, { method: 'GET' }, 'Get domain share');
  }

  async validateDomain(name: string): Promise<{ valid: boolean; normalized?: string; error?: string }> {
    return this.request(
      `${this.apiUrl}${ENDPOINTS.DOMAINS}/validate`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain: name }) },
      'Validate domain'
    );
  }

  // ===========================================================================
  // PUBLIC API - TOKENS
  // ===========================================================================

  async createToken(ttl?: number, tags?: string[]): Promise<TokenCreateResponse> {
    const body: { ttl?: number; tags?: string[] } = {};
    if (ttl !== undefined) body.ttl = ttl;
    if (tags !== undefined) body.tags = tags;

    return this.request(
      `${this.apiUrl}${ENDPOINTS.TOKENS}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      'Create token'
    );
  }

  async listTokens(): Promise<TokenListResponse> {
    return this.request(`${this.apiUrl}${ENDPOINTS.TOKENS}`, { method: 'GET' }, 'List tokens');
  }

  async removeToken(token: string): Promise<void> {
    await this.request<void>(`${this.apiUrl}${ENDPOINTS.TOKENS}/${encodeURIComponent(token)}`, { method: 'DELETE' }, 'Remove token');
  }

  // ===========================================================================
  // PUBLIC API - ACCOUNT & CONFIG
  // ===========================================================================

  async getAccount(): Promise<Account> {
    return this.request(`${this.apiUrl}${ENDPOINTS.ACCOUNT}`, { method: 'GET' }, 'Get account');
  }

  async getConfig(): Promise<ConfigResponse> {
    return this.request(`${this.apiUrl}${ENDPOINTS.CONFIG}`, { method: 'GET' }, 'Get config');
  }

  async ping(): Promise<boolean> {
    const data = await this.request<PingResponse>(`${this.apiUrl}${ENDPOINTS.PING}`, { method: 'GET' }, 'Ping');
    return data?.success || false;
  }

  async getPingResponse(): Promise<PingResponse> {
    return this.request(`${this.apiUrl}${ENDPOINTS.PING}`, { method: 'GET' }, 'Ping');
  }

  // ===========================================================================
  // PUBLIC API - SPA CHECK
  // ===========================================================================

  async checkSPA(files: StaticFile[]): Promise<boolean> {
    const indexFile = files.find(f => f.path === 'index.html' || f.path === '/index.html');
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

    const body: SPACheckRequest = { files: files.map(f => f.path), index: indexContent };
    const response = await this.request<SPACheckResponse>(
      `${this.apiUrl}${ENDPOINTS.SPA_CHECK}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      'SPA check'
    );

    return response.isSPA;
  }
}
