/**
 * @file HTTP client with integrated event system
 * Clean, direct implementation with reliable error handling
 */

import { getMimeType } from '../utils/mimeType';
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
import type { ApiDeployOptions, ShipClientOptions, ShipEvents } from '../types.js';
import { ShipError, DEFAULT_API } from '@shipstatic/types';
import { SimpleEvents } from '../events.js';
import { getENV } from '../lib/env.js';

// Internal endpoints
const DEPLOY_ENDPOINT = '/deployments';
const PING_ENDPOINT = '/ping';
const DOMAINS_ENDPOINT = '/domains';
const CONFIG_ENDPOINT = '/config';
const ACCOUNT_ENDPOINT = '/account';
const TOKENS_ENDPOINT = '/tokens';
const SPA_CHECK_ENDPOINT = '/spa-check';

// Default timeout for HTTP requests (30 seconds)
const DEFAULT_REQUEST_TIMEOUT = 30000;

/**
 * HTTP client with integrated event system
 * - Direct event integration
 * - Clean inheritance from SimpleEvents
 * - Reliable error handling
 */
export class ApiHttp extends SimpleEvents {
  private readonly apiUrl: string;
  private readonly getAuthHeadersCallback: () => Record<string, string>;
  private readonly timeout: number;

  constructor(options: ShipClientOptions & { getAuthHeaders: () => Record<string, string> }) {
    super();
    this.apiUrl = options.apiUrl || DEFAULT_API;
    this.getAuthHeadersCallback = options.getAuthHeaders;
    this.timeout = options.timeout ?? DEFAULT_REQUEST_TIMEOUT;
  }

  /**
   * Transfer events to another client (clean intentional API)
   */
  transferEventsTo(target: ApiHttp): void {
    this.transfer(target);
  }


  /**
   * Make authenticated HTTP request with events and timeout
   */
  private async request<T>(url: string, options: RequestInit = {}, operationName: string): Promise<T> {
    const headers = this.getAuthHeaders(options.headers as Record<string, string>);

    // Set up timeout with AbortController
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), this.timeout);

    // Combine with any existing signal from options
    const signal = options.signal
      ? this.combineSignals(options.signal, timeoutController.signal)
      : timeoutController.signal;

    const fetchOptions: RequestInit = {
      ...options,
      headers,
      credentials: !headers.Authorization ? 'include' : undefined,
      signal,
    };

    // Emit request event
    this.emit('request', url, fetchOptions);

    try {
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      if (!response.ok) {
        await this.handleResponseError(response, operationName);
      }

      const responseForEvent = this.safeClone(response);
      const responseForParsing = this.safeClone(response);

      this.emit('response', responseForEvent, url);
      return await this.parseResponse<T>(responseForParsing);
    } catch (error: any) {
      clearTimeout(timeoutId);
      this.emit('error', error, url);
      this.handleFetchError(error, operationName);
      throw error;
    }
  }

  /**
   * Combine multiple AbortSignals into one
   */
  private combineSignals(userSignal: AbortSignal, timeoutSignal: AbortSignal): AbortSignal {
    const controller = new AbortController();

    const abort = () => controller.abort();
    userSignal.addEventListener('abort', abort);
    timeoutSignal.addEventListener('abort', abort);

    // If either is already aborted, abort immediately
    if (userSignal.aborted || timeoutSignal.aborted) {
      controller.abort();
    }

    return controller.signal;
  }

  /**
   * Make request and return both data and HTTP status code
   * Used when the caller needs to inspect the status (e.g., 201 vs 200)
   */
  private async requestWithStatus<T>(url: string, options: RequestInit = {}, operationName: string): Promise<{ data: T; status: number }> {
    const headers = this.getAuthHeaders(options.headers as Record<string, string>);

    // Set up timeout with AbortController
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), this.timeout);

    // Combine with any existing signal from options
    const signal = options.signal
      ? this.combineSignals(options.signal, timeoutController.signal)
      : timeoutController.signal;

    const fetchOptions: RequestInit = {
      ...options,
      headers,
      credentials: !headers.Authorization ? 'include' : undefined,
      signal,
    };

    // Emit request event
    this.emit('request', url, fetchOptions);

    try {
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      if (!response.ok) {
        await this.handleResponseError(response, operationName);
      }

      const responseForEvent = this.safeClone(response);
      const responseForParsing = this.safeClone(response);

      this.emit('response', responseForEvent, url);
      const data = await this.parseResponse<T>(responseForParsing);
      return { data, status: response.status };
    } catch (error: any) {
      clearTimeout(timeoutId);
      this.emit('error', error, url);
      this.handleFetchError(error, operationName);
      throw error;
    }
  }

  /**
   * Generate auth headers from Ship instance callback
   */
  private getAuthHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
    const authHeaders = this.getAuthHeadersCallback();
    return { ...customHeaders, ...authHeaders };
  }

  /**
   * Safely clone response for events
   */
  private safeClone(response: Response): Response {
    try {
      return response.clone();
    } catch {
      // Return original if cloning fails (test mocks)
      return response;
    }
  }

  /**
   * Parse JSON response
   */
  private async parseResponse<T>(response: Response): Promise<T> {
    const contentLength = response.headers.get('Content-Length');

    if (contentLength === '0' || response.status === 204) {
      return undefined as T;
    }

    return await response.json() as T;
  }

  /**
   * Handle response errors
   */
  private async handleResponseError(response: Response, operationName: string): Promise<never> {
    let errorData: any = {};
    try {
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        errorData = await response.json();
      } else {
        errorData = { message: await response.text() };
      }
    } catch {
      errorData = { message: 'Failed to parse error response' };
    }

    const message = errorData.message || errorData.error || `${operationName} failed due to API error`;

    if (response.status === 401) {
      throw ShipError.authentication(message);
    }

    throw ShipError.api(message, response.status, errorData.code, errorData);
  }

  /**
   * Handle fetch errors
   */
  private handleFetchError(error: any, operationName: string): never {
    if (error.name === 'AbortError') {
      throw ShipError.cancelled(`${operationName} operation was cancelled.`);
    }
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw ShipError.network(`${operationName} failed due to network error: ${error.message}`, error);
    }
    if (error instanceof ShipError) {
      throw error;
    }
    throw ShipError.business(`An unexpected error occurred during ${operationName}: ${error.message || 'Unknown error'}`);
  }

  // Public API methods (all delegate to request())

  async ping(): Promise<boolean> {
    const data = await this.request<PingResponse>(`${this.apiUrl}${PING_ENDPOINT}`, { method: 'GET' }, 'Ping');
    return data?.success || false;
  }

  async getPingResponse(): Promise<PingResponse> {
    return await this.request<PingResponse>(`${this.apiUrl}${PING_ENDPOINT}`, { method: 'GET' }, 'Ping');
  }

  async getConfig(): Promise<ConfigResponse> {
    return await this.request<ConfigResponse>(`${this.apiUrl}${CONFIG_ENDPOINT}`, { method: 'GET' }, 'Config');
  }

  async deploy(files: StaticFile[], options: ApiDeployOptions = {}): Promise<Deployment> {
    this.validateFiles(files);

    const { requestBody, requestHeaders } = await this.prepareRequestPayload(files, options.tags, options.via);

    let authHeaders: Record<string, string> = {};
    if (options.deployToken) {
      authHeaders['Authorization'] = `Bearer ${options.deployToken}`;
    } else if (options.apiKey) {
      authHeaders['Authorization'] = `Bearer ${options.apiKey}`;
    }

    // Add X-Caller header if caller is provided
    if (options.caller) {
      authHeaders['X-Caller'] = options.caller;
    }

    const fetchOptions: RequestInit = {
      method: 'POST',
      body: requestBody,
      headers: { ...requestHeaders, ...authHeaders },
      signal: options.signal || null
    };

    return await this.request<Deployment>(`${options.apiUrl || this.apiUrl}${DEPLOY_ENDPOINT}`, fetchOptions, 'Deploy');
  }

  async listDeployments(): Promise<DeploymentListResponse> {
    return await this.request<DeploymentListResponse>(`${this.apiUrl}${DEPLOY_ENDPOINT}`, { method: 'GET' }, 'List Deployments');
  }

  async getDeployment(id: string): Promise<Deployment> {
    return await this.request<Deployment>(`${this.apiUrl}${DEPLOY_ENDPOINT}/${id}`, { method: 'GET' }, 'Get Deployment');
  }

  async removeDeployment(id: string): Promise<void> {
    await this.request<DeploymentRemoveResponse>(`${this.apiUrl}${DEPLOY_ENDPOINT}/${id}`, { method: 'DELETE' }, 'Remove Deployment');
  }

  async setDomain(name: string, deployment?: string, tags?: string[]): Promise<Domain> {
    const requestBody: { deployment?: string; tags?: string[] } = {};
    if (deployment) {
      requestBody.deployment = deployment;
    }
    if (tags && tags.length > 0) {
      requestBody.tags = tags;
    }

    const url = `${this.apiUrl}${DOMAINS_ENDPOINT}/${encodeURIComponent(name)}`;
    const { data, status } = await this.requestWithStatus<Domain>(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    }, 'Set Domain');

    // Add isCreate flag based on status code (201 = created, 200 = updated)
    return {
      ...data,
      isCreate: status === 201
    };
  }

  async getDomain(name: string): Promise<Domain> {
    return await this.request<Domain>(`${this.apiUrl}${DOMAINS_ENDPOINT}/${encodeURIComponent(name)}`, { method: 'GET' }, 'Get Domain');
  }

  async listDomains(): Promise<DomainListResponse> {
    return await this.request<DomainListResponse>(`${this.apiUrl}${DOMAINS_ENDPOINT}`, { method: 'GET' }, 'List Domains');
  }

  async removeDomain(name: string): Promise<void> {
    await this.request<void>(`${this.apiUrl}${DOMAINS_ENDPOINT}/${encodeURIComponent(name)}`, { method: 'DELETE' }, 'Remove Domain');
  }

  async verifyDomain(name: string): Promise<{ message: string }> {
    return await this.request<{ message: string }>(`${this.apiUrl}${DOMAINS_ENDPOINT}/${encodeURIComponent(name)}/verify`, { method: 'POST' }, 'Verify Domain');
  }

  async getDomainDns(name: string): Promise<DomainDnsResponse> {
    return await this.request<DomainDnsResponse>(`${this.apiUrl}${DOMAINS_ENDPOINT}/${encodeURIComponent(name)}/dns`, { method: 'GET' }, 'Get Domain DNS');
  }

  async getDomainRecords(name: string): Promise<DomainRecordsResponse> {
    return await this.request<DomainRecordsResponse>(`${this.apiUrl}${DOMAINS_ENDPOINT}/${encodeURIComponent(name)}/records`, { method: 'GET' }, 'Get Domain Records');
  }

  async getDomainShare(name: string): Promise<{ domain: string; hash: string }> {
    return await this.request<{ domain: string; hash: string }>(`${this.apiUrl}${DOMAINS_ENDPOINT}/${encodeURIComponent(name)}/share`, { method: 'GET' }, 'Get Domain Share');
  }

  async getAccount(): Promise<Account> {
    return await this.request<Account>(`${this.apiUrl}${ACCOUNT_ENDPOINT}`, { method: 'GET' }, 'Get Account');
  }

  async createToken(ttl?: number, tags?: string[]): Promise<TokenCreateResponse> {
    const requestBody: { ttl?: number; tags?: string[] } = {};
    if (ttl !== undefined) {
      requestBody.ttl = ttl;
    }
    if (tags && tags.length > 0) {
      requestBody.tags = tags;
    }

    return await this.request<TokenCreateResponse>(
      `${this.apiUrl}${TOKENS_ENDPOINT}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      },
      'Create Token'
    );
  }

  async listTokens(): Promise<TokenListResponse> {
    return await this.request<TokenListResponse>(
      `${this.apiUrl}${TOKENS_ENDPOINT}`,
      { method: 'GET' },
      'List Tokens'
    );
  }

  async removeToken(token: string): Promise<void> {
    await this.request<void>(
      `${this.apiUrl}${TOKENS_ENDPOINT}/${encodeURIComponent(token)}`,
      { method: 'DELETE' },
      'Remove Token'
    );
  }

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

    const requestData: SPACheckRequest = {
      files: files.map(f => f.path),
      index: indexContent
    };

    const response = await this.request<SPACheckResponse>(
      `${this.apiUrl}${SPA_CHECK_ENDPOINT}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData)
      },
      'SPA Check'
    );

    return response.isSPA;
  }

  // File handling helpers

  private validateFiles(files: StaticFile[]): void {
    if (!files.length) {
      throw ShipError.business('No files to deploy.');
    }

    for (const file of files) {
      if (!file.md5) {
        throw ShipError.file(`MD5 checksum missing for file: ${file.path}`, file.path);
      }
    }
  }

  private async prepareRequestPayload(files: StaticFile[], tags?: string[], via?: string): Promise<{
    requestBody: FormData | ArrayBuffer;
    requestHeaders: Record<string, string>;
  }> {
    if (getENV() === 'browser') {
      return { requestBody: this.createBrowserBody(files, tags, via), requestHeaders: {} };
    } else if (getENV() === 'node') {
      const { body, headers } = await this.createNodeBody(files, tags, via);
      return {
        requestBody: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
        requestHeaders: headers
      };
    } else {
      throw ShipError.business('Unknown or unsupported execution environment');
    }
  }

  private createBrowserBody(files: StaticFile[], tags?: string[], via?: string): FormData {
    const formData = new FormData();
    const checksums: string[] = [];

    for (const file of files) {
      if (!(file.content instanceof File || file.content instanceof Blob)) {
        throw ShipError.file(`Unsupported file.content type for browser FormData: ${file.path}`, file.path);
      }
      if (!file.md5) {
        throw ShipError.file(`File missing md5 checksum: ${file.path}`, file.path);
      }

      const contentType = this.getBrowserContentType(file.content instanceof File ? file.content : file.path);
      const fileWithPath = new File([file.content], file.path, { type: contentType });
      formData.append('files[]', fileWithPath);
      checksums.push(file.md5);
    }

    formData.append('checksums', JSON.stringify(checksums));

    if (tags && tags.length > 0) {
      formData.append('tags', JSON.stringify(tags));
    }

    if (via) {
      formData.append('via', via);
    }

    return formData;
  }

  private async createNodeBody(files: StaticFile[], tags?: string[], via?: string): Promise<{ body: Buffer, headers: Record<string, string> }> {
    const { FormData: FormDataClass, File: FileClass } = await import('formdata-node');
    const { FormDataEncoder } = await import('form-data-encoder');
    const formData = new FormDataClass();
    const checksums: string[] = [];

    for (const file of files) {
      const contentType = getMimeType(file.path);

      let fileInstance;
      if (Buffer.isBuffer(file.content)) {
        fileInstance = new FileClass([file.content], file.path, { type: contentType });
      } else if (typeof Blob !== "undefined" && file.content instanceof Blob) {
        fileInstance = new FileClass([file.content], file.path, { type: contentType });
      } else {
        throw ShipError.file(`Unsupported file.content type for Node.js FormData: ${file.path}`, file.path);
      }

      if (!file.md5) {
        throw ShipError.file(`File missing md5 checksum: ${file.path}`, file.path);
      }

      const preservedPath = file.path.startsWith('/') ? file.path : '/' + file.path;
      formData.append('files[]', fileInstance, preservedPath);
      checksums.push(file.md5);
    }

    formData.append('checksums', JSON.stringify(checksums));

    if (tags && tags.length > 0) {
      formData.append('tags', JSON.stringify(tags));
    }

    if (via) {
      formData.append('via', via);
    }

    const encoder = new FormDataEncoder(formData);
    const chunks = [];
    for await (const chunk of encoder.encode()) {
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);

    return {
      body,
      headers: {
        'Content-Type': encoder.contentType,
        'Content-Length': Buffer.byteLength(body).toString()
      }
    };
  }

  private getBrowserContentType(file: File | string): string {
    if (typeof file === 'string') {
      return getMimeType(file);
    } else {
      return file.type || getMimeType(file.name);
    }
  }
}