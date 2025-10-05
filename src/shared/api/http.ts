/**
 * @file HTTP client with integrated event system
 * Clean, direct implementation with reliable error handling
 */

import * as _mime from 'mime-types';
import type { 
  Deployment, 
  DeploymentListResponse, 
  PingResponse, 
  ConfigResponse, 
  DeploymentRemoveResponse, 
  Alias, 
  AliasListResponse, 
  Account, 
  SPACheckRequest, 
  SPACheckResponse,
  StaticFile
} from '@shipstatic/types';
import type { ApiDeployOptions, ShipClientOptions, ShipEvents } from '../types.js';
import { ShipError, DEFAULT_API } from '@shipstatic/types';
import { SimpleEvents } from '../events.js';
import { getENV } from '../lib/env.js';

// Internal endpoints
const DEPLOY_ENDPOINT = '/deployments';
const PING_ENDPOINT = '/ping';
const ALIASES_ENDPOINT = '/aliases';
const CONFIG_ENDPOINT = '/config';
const ACCOUNT_ENDPOINT = '/account';
const SPA_CHECK_ENDPOINT = '/spa-check';

/**
 * HTTP client with integrated event system
 * - Direct event integration
 * - Clean inheritance from SimpleEvents
 * - Reliable error handling
 */
export class ApiHttp extends SimpleEvents {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly deployToken: string;

  constructor(options: ShipClientOptions) {
    super();
    this.apiUrl = options.apiUrl || DEFAULT_API;
    this.apiKey = options.apiKey ?? "";
    this.deployToken = options.deployToken ?? "";
  }

  /**
   * Transfer events to another client (clean intentional API)
   */
  transferEventsTo(target: ApiHttp): void {
    this.transfer(target);
  }


  /**
   * Make authenticated HTTP request with events
   */
  private async request<T>(url: string, options: RequestInit = {}, operationName: string): Promise<T> {
    const headers = this.getAuthHeaders(options.headers as Record<string, string>);
    
    const fetchOptions: RequestInit = {
      ...options,
      headers,
      credentials: this.needsCredentials(headers) ? 'include' : undefined,
    };

    // Emit request event
    this.emit('request', url, fetchOptions);

    try {
      const response = await fetch(url, fetchOptions);
      
      if (!response.ok) {
        await this.handleResponseError(response, operationName);
      }

      // Clone response BEFORE any consumption for reliable event handling
      const responseForEvent = this.safeClone(response);
      const responseForParsing = this.safeClone(response);
      
      // Emit event with dedicated clone
      this.emit('response', responseForEvent, url);
      
      // Parse response with dedicated clone
      return await this.parseResponse<T>(responseForParsing);
    } catch (error: any) {
      this.emit('error', error, url);
      this.handleFetchError(error, operationName);
      throw error;
    }
  }

  /**
   * Generate auth headers
   */
  private getAuthHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
    const headers = { ...customHeaders };
    
    if (this.deployToken) {
      headers['Authorization'] = `Bearer ${this.deployToken}`;
    } else if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    
    return headers;
  }

  /**
   * Check if credentials are needed
   */
  private needsCredentials(headers: Record<string, string>): boolean {
    return !this.apiKey && !this.deployToken && !headers.Authorization;
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
    console.log('🚢 [HTTP] deploy() called with options:', options);
    console.log('🚢 [HTTP] tags from options:', options.tags);

    this.validateFiles(files);

    const { requestBody, requestHeaders } = await this.prepareRequestPayload(files, options.tags);

    let authHeaders = {};
    if (options.deployToken) {
      authHeaders = { 'Authorization': `Bearer ${options.deployToken}` };
    } else if (options.apiKey) {
      authHeaders = { 'Authorization': `Bearer ${options.apiKey}` };
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

  async setAlias(name: string, deployment: string, tags?: string[]): Promise<Alias> {
    const requestBody: { deployment: string; tags?: string[] } = { deployment };
    if (tags && tags.length > 0) {
      requestBody.tags = tags;
    }

    const options: RequestInit = {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    };
    
    const headers = this.getAuthHeaders(options.headers as Record<string, string>);
    const fetchOptions: RequestInit = {
      ...options,
      headers,
      credentials: this.needsCredentials(headers) ? 'include' : undefined,
    };

    // Emit request event
    this.emit('request', `${this.apiUrl}${ALIASES_ENDPOINT}/${encodeURIComponent(name)}`, fetchOptions);

    try {
      const response = await fetch(`${this.apiUrl}${ALIASES_ENDPOINT}/${encodeURIComponent(name)}`, fetchOptions);
      
      if (!response.ok) {
        await this.handleResponseError(response, 'Set Alias');
      }

      // Clone response BEFORE any consumption for reliable event handling
      const responseForEvent = this.safeClone(response);
      const responseForParsing = this.safeClone(response);
      
      // Emit event with dedicated clone
      this.emit('response', responseForEvent, `${this.apiUrl}${ALIASES_ENDPOINT}/${encodeURIComponent(name)}`);
      
      // Parse response and add isCreate flag based on status code
      const result = await this.parseResponse<Alias>(responseForParsing);
      return {
        ...result,
        isCreate: response.status === 201
      };
    } catch (error: any) {
      this.emit('error', error, `${this.apiUrl}${ALIASES_ENDPOINT}/${encodeURIComponent(name)}`);
      this.handleFetchError(error, 'Set Alias');
      throw error;
    }
  }

  async getAlias(name: string): Promise<Alias> {
    return await this.request<Alias>(`${this.apiUrl}${ALIASES_ENDPOINT}/${encodeURIComponent(name)}`, { method: 'GET' }, 'Get Alias');
  }

  async listAliases(): Promise<AliasListResponse> {
    return await this.request<AliasListResponse>(`${this.apiUrl}${ALIASES_ENDPOINT}`, { method: 'GET' }, 'List Aliases');
  }

  async removeAlias(name: string): Promise<void> {
    await this.request<void>(`${this.apiUrl}${ALIASES_ENDPOINT}/${encodeURIComponent(name)}`, { method: 'DELETE' }, 'Remove Alias');
  }

  async confirmAlias(name: string): Promise<{ message: string }> {
    return await this.request<{ message: string }>(`${this.apiUrl}${ALIASES_ENDPOINT}/${encodeURIComponent(name)}/confirm`, { method: 'POST' }, 'Confirm Alias');
  }

  async getAliasDns(name: string): Promise<{ alias: string; dns: any }> {
    return await this.request<{ alias: string; dns: any }>(`${this.apiUrl}${ALIASES_ENDPOINT}/${encodeURIComponent(name)}/dns`, { method: 'GET' }, 'Get Alias DNS');
  }

  async getAliasRecords(name: string): Promise<{ alias: string; records: any[] }> {
    return await this.request<{ alias: string; records: any[] }>(`${this.apiUrl}${ALIASES_ENDPOINT}/${encodeURIComponent(name)}/records`, { method: 'GET' }, 'Get Alias Records');
  }

  async getAliasShare(name: string): Promise<{ alias: string; hash: string }> {
    return await this.request<{ alias: string; hash: string }>(`${this.apiUrl}${ALIASES_ENDPOINT}/${encodeURIComponent(name)}/share`, { method: 'GET' }, 'Get Alias Share');
  }

  async getAccount(): Promise<Account> {
    return await this.request<Account>(`${this.apiUrl}${ACCOUNT_ENDPOINT}`, { method: 'GET' }, 'Get Account');
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

  private async prepareRequestPayload(files: StaticFile[], tags?: string[]): Promise<{
    requestBody: FormData | ArrayBuffer;
    requestHeaders: Record<string, string>;
  }> {
    if (getENV() === 'browser') {
      return { requestBody: this.createBrowserBody(files, tags), requestHeaders: {} };
    } else if (getENV() === 'node') {
      const { body, headers } = await this.createNodeBody(files, tags);
      return {
        requestBody: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
        requestHeaders: headers
      };
    } else {
      throw ShipError.business('Unknown or unsupported execution environment');
    }
  }

  private createBrowserBody(files: StaticFile[], tags?: string[]): FormData {
    console.log('🚢 [HTTP] createBrowserBody() called with tags:', tags);

    const formData = new FormData();
    const checksums: string[] = [];

    for (const file of files) {
      if (!(file.content instanceof File || file.content instanceof Blob)) {
        throw ShipError.file(`Unsupported file.content type for browser FormData: ${file.path}`, file.path);
      }

      const contentType = this.getBrowserContentType(file.content instanceof File ? file.content : file.path);
      const fileWithPath = new File([file.content], file.path, { type: contentType });
      formData.append('files[]', fileWithPath);
      checksums.push(file.md5!);
    }

    formData.append('checksums', JSON.stringify(checksums));

    if (tags && tags.length > 0) {
      console.log('🚢 [HTTP] Adding tags to FormData:', tags);
      formData.append('tags', JSON.stringify(tags));
    } else {
      console.log('🚢 [HTTP] No tags to add (tags is empty or undefined)');
    }

    console.log('🚢 [HTTP] FormData created. Entries:', Array.from(formData.entries()).map(([key, val]) => [key, val instanceof File ? `File: ${val.name}` : val]));

    return formData;
  }

  private async createNodeBody(files: StaticFile[], tags?: string[]): Promise<{body: Buffer, headers: Record<string, string>}> {
    const { FormData: FormDataClass, File: FileClass } = await import('formdata-node');
    const { FormDataEncoder } = await import('form-data-encoder');
    const formData = new FormDataClass();
    const checksums: string[] = [];

    for (const file of files) {
      const contentType = _mime.lookup(file.path) || 'application/octet-stream';

      let fileInstance;
      if (Buffer.isBuffer(file.content)) {
        fileInstance = new FileClass([file.content], file.path, { type: contentType });
      } else if (typeof Blob !== "undefined" && file.content instanceof Blob) {
        fileInstance = new FileClass([file.content], file.path, { type: contentType });
      } else {
        throw ShipError.file(`Unsupported file.content type for Node.js FormData: ${file.path}`, file.path);
      }

      const preservedPath = file.path.startsWith('/') ? file.path : '/' + file.path;
      formData.append('files[]', fileInstance, preservedPath);
      checksums.push(file.md5!);
    }

    formData.append('checksums', JSON.stringify(checksums));

    if (tags && tags.length > 0) {
      formData.append('tags', JSON.stringify(tags));
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
      return _mime.lookup(file) || 'application/octet-stream';
    } else {
      return _mime.lookup(file.name) || file.type || 'application/octet-stream';
    }
  }
}