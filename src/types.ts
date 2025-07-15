/**
 * @file SDK-specific type definitions
 * Consolidates all Ship SDK types into a single file for clarity.
 * Core types come from @shipstatic/types, while SDK-specific types are defined here.
 */

// Re-export all types from @shipstatic/types for convenience
export * from '@shipstatic/types';

// =============================================================================
// ENVIRONMENT-SPECIFIC TYPES
// =============================================================================

/**
 * Consolidated input type for all environments
 */
export type DeployInput = FileList | File[] | HTMLInputElement | string[];

// =============================================================================
// DEPLOYMENT OPTIONS
// =============================================================================

/**
 * Universal deploy options for both Node.js and Browser environments
 */
export interface DeploymentOptions {
  /** The API URL to use for this specific deploy. Overrides client's default. */
  apiUrl?: string;
  /** An AbortSignal to allow cancellation of the deploy operation. */
  signal?: AbortSignal;
  /** An optional subdomain to suggest for the deployment. Availability is subject to the API. */
  subdomain?: string;
  /** Callback invoked if the deploy is cancelled via the AbortSignal. */
  onCancel?: () => void;
  /** Maximum number of concurrent operations. */
  maxConcurrency?: number;
  /** Timeout in milliseconds for the deploy request. */
  timeout?: number;
  /** The API key to use for this specific deploy. Overrides client's default. */
  apiKey?: string;
  /** Whether to strip common prefix from file paths. */
  stripCommonPrefix?: boolean;
  /** Callback for overall deploy progress (0-100). */
  onProgress?: (progress: number) => void;
  /** Callback for detailed progress statistics. */
  onProgressStats?: (progressStats: ProgressStats) => void;
}

/**
 * Options for configuring an deploy operation via `apiClient.deployFiles`.
 * Derived from DeploymentOptions but excludes client-side only options.
 */
export type ApiDeployOptions = Omit<DeploymentOptions, 'stripCommonPrefix'>;

// =============================================================================
// PROGRESS TRACKING
// =============================================================================

/**
 * Detailed statistics about the progress of an deploy operation.
 */
export interface ProgressStats {
  /** The number of bytes loaded so far. */
  loaded: number;
  /** The total number of bytes to be loaded. May be 0 if unknown initially. */
  total: number;
  /** The progress as a fraction (loaded/total). Value is between 0 and 1. */
  progress: number;
  /** Optional identifier for the file this progress pertains to, if applicable. */
  file?: string;
}

// =============================================================================
// CLIENT CONFIGURATION
// =============================================================================

/**
 * Options for configuring a `Ship` instance.
 * Sets default API host, key, progress callbacks, concurrency, and timeouts for the client.
 */
export interface ShipClientOptions {
  /** Default API URL for the client instance. */
  apiUrl?: string | undefined;
  /** Default API key for the client instance. */
  apiKey?: string | undefined;
  /**
   * Default callback for overall deploy progress for deploys made with this client.
   * @param progress - A number between 0 and 100.
   */
  onProgress?: ((progress: number) => void) | undefined;
  /**
   * Default callback for detailed progress statistics for deploys made with this client.
   * @param progressStats - Progress statistics object.
   */
  onProgressStats?: ((progressStats: ProgressStats) => void) | undefined;
  /**
   * Default for maximum concurrent deploys.
   * Used if an deploy operation doesn't specify its own `maxConcurrency`.
   * Defaults to 4 if not set here or in the specific deploy call.
   */
  maxConcurrentDeploys?: number | undefined;
  /**
   * Default timeout in milliseconds for API requests made by this client instance.
   * Used if an deploy operation doesn't specify its own timeout.
   */
  timeout?: number | undefined;
}

// =============================================================================
// FILE REPRESENTATION
// =============================================================================

/**
 * Represents a file that has been processed and is ready for deploy.
 * Used internally by the SDK and in advanced/manual deploy scenarios.
 */
export interface StaticFile {
  /**
   * The content of the file.
   * In Node.js, this is typically a `Buffer`.
   * In the browser, this is typically a `File` or `Blob` object.
   */
  content: File | Buffer | Blob;
  /**
   * The desired path for the file on the server, relative to the deployment root.
   * Should include the filename, e.g., `images/photo.jpg`.
   */
  path: string;
  /**
   * The original absolute file system path (primarily used in Node.js environments).
   * This helps in debugging or associating the server path back to its source.
   */
  filePath?: string;
  /**
   * The MD5 hash (checksum) of the file's content.
   * This is calculated by the SDK before deploy if not provided.
   */
  md5?: string;
  /** The size of the file in bytes. */
  size: number;
}

// =============================================================================
// API RESPONSES
// =============================================================================

// PingResponse is imported from @shipstatic/types (single source of truth)