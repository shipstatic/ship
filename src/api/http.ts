/**
 * @file Manages HTTP requests to the Ship API using native fetch.
 */
import * as _mime from 'mime-types';
import type { Deployment, DeploymentListResponse, PingResponse, ConfigResponse, DeploymentRemoveResponse, Alias, AliasListResponse, Account } from '@shipstatic/types';
import { StaticFile, ApiDeployOptions, ShipClientOptions } from '../types.js';
import { ShipError } from '@shipstatic/types';
import { getENV } from '../lib/env.js';
import { DEFAULT_API } from '../core/constants.js';

// FormData and File types for Node.js environment
/**
 * Internal type alias for Node.js FormData implementation used during file deploys.
 * @internal
 */
type FormDataNode = any;
/**
 * Internal type alias for Node.js File implementation used during file deploys.
 * @internal
 */
type FileNode = any;

/** Default API host URL if not otherwise configured. */
/** @internal */
const DEPLOY_ENDPOINT = '/deployments';
/** @internal */
const PING_ENDPOINT = '/ping';
/** @internal */
const ALIASES_ENDPOINT = '/aliases';
/** @internal */
const CONFIG_ENDPOINT = '/config';
/** @internal */
const ACCOUNT_ENDPOINT = '/account';
/** @internal */
const SPA_CHECK_ENDPOINT = '/spa-check';

/**
 * Determines the MIME type for a given file (File object or path string) in browser environments.
 * Falls back to 'application/octet-stream' if type cannot be determined.
 * @internal
 * @param file - File object or file path string.
 * @returns The MIME type as a string.
 */
function getBrowserContentType(file: File | string): string {
  if (typeof file === 'string') {
    return _mime.lookup(file) || 'application/octet-stream';
  } else {
    return _mime.lookup(file.name) || file.type || 'application/octet-stream';
  }
}

/**
 * Collects all items from an AsyncIterable into an array.
 * Useful for converting streaming multipart encoders to Buffer arrays.
 * @internal
 * @template T - The item type yielded by the iterable.
 * @param iterable - The async iterable to collect.
 * @returns A promise resolving to an array of all items.
 */
async function collectAsyncIterable<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const x of iterable) {
    result.push(x);
  }
  return result;
}

/**
 * Handles direct HTTP communication with the Ship API, including deploys and health checks.
 * Responsible for constructing requests, managing authentication, and error translation.
 * @internal
 */
export class ApiHttp {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly deployToken: string;

  /**
   * Constructs a new ApiHttp instance with the provided client options.
   * @param options - Client options including API host, authentication credentials, and timeout settings.
   */
  constructor(options: ShipClientOptions) {
    this.apiUrl = options.apiUrl || DEFAULT_API;
    this.apiKey = options.apiKey ?? "";
    this.deployToken = options.deployToken ?? "";
  }

  /**
   * Generates common headers for API requests, including authentication credentials if present.
   * Deploy tokens take precedence over API keys for single-use deployments.
   * @param customHeaders - Optional additional headers to include.
   * @returns Object containing merged headers.
   * @private
   */
  #getAuthHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
    const headers = { ...customHeaders };
    
    // Deploy tokens take precedence for single-use deployments
    if (this.deployToken) {
      headers['Authorization'] = `Bearer ${this.deployToken}`;
    } else if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    
    return headers;
  }

  /**
   * Low-level fetch wrapper with authentication - used only by #request method.
   * This method only handles the raw fetch request with auth headers.
   * @param url - Request URL
   * @param options - Fetch options
   * @param operationName - Name of operation for error messages
   * @returns Promise resolving to Response object
   * @private
   */
  async #fetchWithAuth(url: string, options: RequestInit = {}, operationName: string): Promise<Response> {
    const headers = this.#getAuthHeaders(options.headers as Record<string, string>);
    
    const fetchOptions: RequestInit = {
      ...options,
      headers,
      credentials: getENV() === 'browser' ? 'include' : 'same-origin',
    };

    try {
      const response = await fetch(url, fetchOptions);
      return response;
    } catch (error: any) {
      this.#handleFetchError(error, operationName);
      // This line is unreachable because #handleFetchError always throws
      throw error;
    }
  }

  /**
   * Unified HTTP request helper that handles the complete request lifecycle.
   * Makes authenticated requests, checks response status, and handles all errors.
   * Automatically determines whether to parse JSON based on response headers.
   * @param url - Request URL
   * @param options - Fetch options  
   * @param operationName - Name of operation for error messages
   * @returns Promise resolving to parsed JSON response or undefined for empty responses
   * @throws {ShipError} Various ShipError types based on the failure mode
   * @private
   */
  async #request<T>(url: string, options: RequestInit = {}, operationName: string): Promise<T> {
    try {
      const response = await this.#fetchWithAuth(url, options, operationName);
      
      if (!response.ok) {
        await this.#handleResponseError(response, operationName);
      }
      
      // Check if response has content to parse
      const contentLength = response.headers.get('Content-Length');
      if (contentLength === '0' || response.status === 204) {
        return undefined as T; // Return undefined for empty responses
      }
      
      return await response.json() as T;
    } catch (error: any) {
      if (error instanceof ShipError) {
        throw error;
      }
      this.#handleFetchError(error, operationName);
      // This line is unreachable because #handleFetchError always throws
      throw error;
    }
  }
  
  /**
   * Sends a ping request to the Ship API server to verify connectivity and authentication.
   * @returns Promise resolving to `true` if the ping is successful, `false` otherwise.
   * @throws {ShipApiError} If the API returns an error response (4xx, 5xx).
   * @throws {ShipNetworkError} If a network error occurs (e.g., DNS failure, connection refused).
   */
  public async ping(): Promise<boolean> {
    const data = await this.#request<PingResponse>(`${this.apiUrl}${PING_ENDPOINT}`, { method: 'GET' }, 'Ping');
    return data?.success || false;
  }

  /**
   * Get full ping response from the API server
   * @returns Promise resolving to the full PingResponse object.
   */
  public async getPingResponse(): Promise<PingResponse> {
    return await this.#request<PingResponse>(`${this.apiUrl}${PING_ENDPOINT}`, { method: 'GET' }, 'Ping');
  }

  /**
   * Fetches platform configuration from the API.
   * @returns Promise resolving to the config response.
   * @throws {ShipError} If the config request fails.
   */
  public async getConfig(): Promise<ConfigResponse> {
    return await this.#request<ConfigResponse>(`${this.apiUrl}${CONFIG_ENDPOINT}`, { method: 'GET' }, 'Config');
  }

  /**
   * Deploys an array of StaticFile objects to the Ship API.
   * Constructs and sends a multipart/form-data POST request, handling both browser and Node.js environments.
   * Validates files and manages deploy progress and error translation.
   * @param files - Array of StaticFile objects to deploy (must include MD5 checksums).
   * @param options - Optional per-deploy configuration (overrides instance defaults).
   * @returns Promise resolving to a full Deployment object on success.
   * @throws {ShipFileError} If a file is missing an MD5 checksum or content type is unsupported.
   * @throws {ShipClientError} If no files are provided or if environment is unknown.
   * @throws {ShipNetworkError} If a network error occurs during deploy.
   * @throws {ShipApiError} If the API returns an error response.
   * @throws {ShipCancelledError} If the deploy is cancelled via an AbortSignal.
   */
  public async deploy(
    files: StaticFile[],
    options: ApiDeployOptions = {}
  ): Promise<Deployment> {
    this.#validateFiles(files);

    const {
      apiUrl = this.apiUrl,
      signal,
      apiKey,
      deployToken
    } = options;

    const { requestBody, requestHeaders } = await this.#prepareRequestPayload(files);
    
    // Override auth headers if per-deploy credentials are provided
    // Deploy tokens take precedence over API keys
    let authHeaders = {};
    if (deployToken) {
      authHeaders = { 'Authorization': `Bearer ${deployToken}` };
    } else if (apiKey) {
      authHeaders = { 'Authorization': `Bearer ${apiKey}` };
    }
    
    const fetchOptions: RequestInit = {
      method: 'POST',
      body: requestBody,
      headers: { ...requestHeaders, ...authHeaders },
      signal: signal || null
    };

    // Use unified request method to eliminate duplication
    return await this.#request<Deployment>(`${apiUrl}${DEPLOY_ENDPOINT}`, fetchOptions, 'Deploy');
  }
  
  /**
   * Validates the files array for deploy requirements.
   * Ensures all files have MD5 checksums and at least one file is present.
   * @param files - Files to validate.
   * @throws {ShipFileError} If a file is missing an MD5 checksum.
   * @throws {ShipClientError} If no files are provided.
   * @private
   */
  #validateFiles(files: StaticFile[]): void {
    if (!files.length) {
      throw ShipError.business('No files to deploy.');
    }
    
    for (const file of files) {
      if (!file.md5) {
        throw ShipError.file(`MD5 checksum missing for file: ${file.path}`, file.path);
      }
    }
  }


  /**
   * Prepares the request payload (body and headers) for deploy based on execution environment.
   * Selects browser or Node.js multipart construction as needed.
   * @param files - Files to deploy.
   * @returns Promise resolving to request body and headers.
   * @private
   */
  async #prepareRequestPayload(files: StaticFile[]): Promise<{
    requestBody: FormData | Buffer;
    requestHeaders: Record<string, string>;
  }> {
    let requestBody: FormData | Buffer;
    let requestHeaders: Record<string, string> = {};
    
    if (getENV() === 'browser') {
      requestBody = this.#createBrowserBody(files);
    } else if (getENV() === 'node') {
      const { body, headers } = await this.#createNodeBody(files);
      requestBody = body;
      requestHeaders = headers;
    } else {
      throw ShipError.business('Unknown or unsupported execution environment');
    }
    
    return { requestBody, requestHeaders };
  }

  /**
   * Creates a FormData object for browser environments, populating it with files and checksums.
   * @param files - Array of StaticFile objects to include in the FormData.
   * @returns FormData object ready for transmission.
   * @throws {ShipFileError} If file content is of an unsupported type for browser FormData.
   * @private
   */
  #createBrowserBody(files: StaticFile[]): FormData {
    const formData = new FormData();
    const checksums: string[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let fileContent: File | Blob;
      if (file.content instanceof File || file.content instanceof Blob) {
        fileContent = file.content;
      } else {
        throw ShipError.file(`Unsupported file.content type for browser FormData: ${file.path}`, file.path);
      }
      const contentType = getBrowserContentType(fileContent instanceof File ? fileContent : file.path);
      const fileWithPath = new File([fileContent], file.path, { type: contentType });
      formData.append('files[]', fileWithPath);
      checksums.push(file.md5!);
    }
    
    // Add checksums as JSON array
    formData.append('checksums', JSON.stringify(checksums));
    return formData;
  }

  /**
   * Creates the multipart request body (Buffer) and headers for Node.js environments using formdata-node and form-data-encoder.
   * @param files - Array of StaticFile objects to include in the multipart body.
   * @returns Promise resolving to an object with the body Buffer and headers.
   * @throws {ShipFileError} If file content is of an unsupported type for Node.js FormData.
   * @private
   */
  async #createNodeBody(files: StaticFile[]): Promise<{body: Buffer, headers: Record<string, string>}> {
    const { FormData: FormDataNodeClass, File: FileNodeClass } = await import('formdata-node');
    const { FormDataEncoder: FormDataEncoderClass } = await import('form-data-encoder');
    const pathImport = await import('path');
    const formDataNodeInstance: FormDataNode = new FormDataNodeClass();
    const checksums: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const contentType = _mime.lookup(file.path) || 'application/octet-stream';
      let fileNodeInstance: FileNode;

      if (Buffer.isBuffer(file.content)) {
        fileNodeInstance = new FileNodeClass([file.content], file.path, { type: contentType });
      } else if (typeof Blob !== "undefined" && file.content instanceof Blob) {
        fileNodeInstance = new FileNodeClass([file.content], file.path, { type: contentType });
      } else {
        throw ShipError.file(`Unsupported file.content type for Node.js FormData: ${file.path}`, file.path);
      }
      const preservedPath = file.path.startsWith('/') ? file.path : '/' + file.path;
      formDataNodeInstance.append('files[]', fileNodeInstance, preservedPath);
      checksums.push(file.md5!);
    }

    // Add checksums as JSON array
    formDataNodeInstance.append('checksums', JSON.stringify(checksums));

    const encoder = new FormDataEncoderClass(formDataNodeInstance);
    const encodedChunks = await collectAsyncIterable(encoder.encode());
    const body = Buffer.concat(encodedChunks.map(chunk => Buffer.from(chunk as Uint8Array)));

    const headers = {
      'Content-Type': encoder.contentType,
      'Content-Length': Buffer.byteLength(body).toString()
    };
    return { body, headers };
  }

  /**
   * Handles fetch response errors and throws appropriate ShipError types.
   * @param response - Fetch Response object with error status
   * @param operationName - Name of the failed operation
   * @throws {ShipApiError} Always throws with API error details
   * @private
   */
  async #handleResponseError(response: Response, operationName: string): Promise<never> {
    let errorData: any = {};
    try {
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        errorData = await response.json();
      } else {
        errorData = { message: await response.text() };
      }
    } catch {
      errorData = { message: 'Failed to parse error response' };
    }

    // Handle structured error responses (with error field, code, or message)
    if (errorData.error || errorData.code || errorData.message) {
      // Use message if available, otherwise use the error field as the message, or fallback
      const message = errorData.message || errorData.error || `${operationName} failed due to API error`;
      
      // Handle authentication errors specifically
      if (response.status === 401) {
        throw ShipError.authentication(message);
      }
      
      throw ShipError.api(
        message,
        response.status,
        errorData.code,
        errorData
      );
    }

    // Fallback for completely unstructured errors
    // Handle authentication errors specifically for unstructured responses too
    if (response.status === 401) {
      throw ShipError.authentication(`Authentication failed for ${operationName}`);
    }
    
    throw ShipError.api(
      `${operationName} failed due to API error`,
      response.status,
      undefined,
      errorData
    );
  }

  /**
   * Translates fetch errors into appropriate ShipError types and always throws.
   * Intended for use in catch blocks of API requests; never returns.
   * @param error - The error object caught from fetch.
   * @param operationName - Name of the failed operation (e.g., 'Deploy', 'Ping').
   * @throws {ShipCancelledError} If the request was cancelled.
   * @throws {ShipNetworkError} If a network error occurred (DNS failure, connection refused).
   * @throws {ShipClientError} For other unexpected errors.
   * @private
   */
  #handleFetchError(error: any, operationName: string): never {
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

  /**
   * Lists all deployments for the authenticated account
   * @returns Promise resolving to deployment list response
   */
  public async listDeployments(): Promise<DeploymentListResponse> {
    return await this.#request<DeploymentListResponse>(`${this.apiUrl}${DEPLOY_ENDPOINT}`, { method: 'GET' }, 'List Deployments');
  }

  /**
   * Gets a specific deployment by ID
   * @param id - Deployment ID to retrieve
   * @returns Promise resolving to deployment details
   */
  public async getDeployment(id: string): Promise<Deployment> {
    return await this.#request<Deployment>(`${this.apiUrl}${DEPLOY_ENDPOINT}/${id}`, { method: 'GET' }, 'Get Deployment');
  }

  /**
   * Removes a deployment by ID
   * @param id - Deployment ID to remove
   * @returns Promise resolving when removal is complete
   */
  public async removeDeployment(id: string): Promise<void> {
    await this.#request<DeploymentRemoveResponse>(`${this.apiUrl}${DEPLOY_ENDPOINT}/${id}`, { method: 'DELETE' }, 'Remove Deployment');
  }

  /**
   * Sets an alias (create or update)
   * @param name - Alias name
   * @param deployment - Deployment name to point to
   * @returns Promise resolving to the created/updated alias with operation context
   */
  public async setAlias(name: string, deployment: string): Promise<import('@shipstatic/types').Alias> {
    try {
      const response = await this.#fetchWithAuth(`${this.apiUrl}${ALIASES_ENDPOINT}/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deployment: deployment })
      }, 'Set Alias');
      
      if (!response.ok) {
        await this.#handleResponseError(response, 'Set Alias');
      }
      
      const alias = await response.json() as import('@shipstatic/types').Alias;
      
      // 201 = created, 200 = updated
      return {
        ...alias,
        isCreate: response.status === 201
      };
    } catch (error: any) {
      this.#handleFetchError(error, 'Set Alias');
    }
  }

  /**
   * Gets a specific alias by name
   * @param name - Alias name to retrieve
   * @returns Promise resolving to alias details
   */
  public async getAlias(name: string): Promise<Alias> {
    return await this.#request<Alias>(`${this.apiUrl}${ALIASES_ENDPOINT}/${encodeURIComponent(name)}`, { method: 'GET' }, 'Get Alias');
  }

  /**
   * Lists all aliases for the authenticated account
   * @returns Promise resolving to alias list response
   */
  public async listAliases(): Promise<AliasListResponse> {
    return await this.#request<AliasListResponse>(`${this.apiUrl}${ALIASES_ENDPOINT}`, { method: 'GET' }, 'List Aliases');
  }

  /**
   * Removes an alias by name
   * @param name - Alias name to remove
   * @returns Promise resolving to removal confirmation
   */
  public async removeAlias(name: string): Promise<void> {
    await this.#request<void>(`${this.apiUrl}${ALIASES_ENDPOINT}/${encodeURIComponent(name)}`, { method: 'DELETE' }, 'Remove Alias');
  }

  /**
   * Triggers a manual DNS check for an external alias
   * @param name - Alias name to check DNS for
   * @returns Promise resolving to confirmation message
   */
  public async checkAlias(name: string): Promise<{ message: string }> {
    return await this.#request<{ message: string }>(`${this.apiUrl}${ALIASES_ENDPOINT}/${encodeURIComponent(name)}/dns-check`, { method: 'POST' }, 'Check Alias');
  }

  /**
   * Gets account details for the authenticated user
   * @returns Promise resolving to account details
   */
  public async getAccount(): Promise<Account> {
    return await this.#request<Account>(`${this.apiUrl}${ACCOUNT_ENDPOINT}`, { method: 'GET' }, 'Get Account');
  }

  /**
   * Creates a new API key for the authenticated user
   * @returns Promise resolving to the new API key
   */
  public async createApiKey(): Promise<{ apiKey: string }> {
    return await this.#request<{ apiKey: string }>(`${this.apiUrl}/key`, { method: 'POST' }, 'Create API Key');
  }

  /**
   * Checks if file paths represent a SPA structure using AI analysis
   * @param filePaths - Array of file paths to analyze
   * @returns Promise resolving to boolean indicating if it's a SPA
   */
  public async checkSPA(filePaths: string[]): Promise<boolean> {
    const response = await this.#request<{ isSPA: boolean }>(
      `${this.apiUrl}${SPA_CHECK_ENDPOINT}`, 
      { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: filePaths })
      }, 
      'SPA Check'
    );
    return response.isSPA;
  }
}
