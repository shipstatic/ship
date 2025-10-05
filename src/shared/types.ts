/**
 * @file SDK-specific type definitions
 * Consolidates all Ship SDK types into a single file for clarity.
 * Core types come from @shipstatic/types, while SDK-specific types are defined here.
 */

// Re-export all types from @shipstatic/types for convenience
export * from '@shipstatic/types';

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
  /** API key for this specific deploy. Overrides client's default (format: ship-<64-char-hex>, total 69 chars). */
  apiKey?: string;
  /** Deploy token for this specific deploy. Overrides client's default (format: token-<64-char-hex>, total 70 chars). */
  deployToken?: string;
  /** Whether to auto-detect and optimize file paths by flattening common directories. Defaults to true. */
  pathDetect?: boolean;
  /** Whether to auto-detect SPAs and generate ship.json configuration. Defaults to true. */
  spaDetect?: boolean;
  /** Optional array of tags for categorization and filtering (lowercase, alphanumeric with separators). */
  tags?: string[];
  /** Callback for overall deploy progress (0-100). */
  onProgress?: (progress: number) => void;
  /** Callback for detailed progress statistics. */
  onProgressStats?: (progressStats: ProgressStats) => void;
}

/**
 * Options for configuring an deploy operation via `apiClient.deployFiles`.
 * Derived from DeploymentOptions but excludes client-side only options.
 */
export type ApiDeployOptions = Omit<DeploymentOptions, 'pathDetect'>;

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
 * Sets default API host, authentication credentials, progress callbacks, concurrency, and timeouts for the client.
 */
export interface ShipClientOptions {
  /** Default API URL for the client instance. */
  apiUrl?: string | undefined;
  /** API key for authenticated deployments (format: ship-<64-char-hex>, total 69 chars). */
  apiKey?: string | undefined;
  /** Deploy token for single-use deployments (format: token-<64-char-hex>, total 70 chars). */
  deployToken?: string | undefined;
  /** Path to custom config file. */
  configFile?: string | undefined;
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
  maxConcurrency?: number | undefined;
  /**
   * Default timeout in milliseconds for API requests made by this client instance.
   * Used if an deploy operation doesn't specify its own timeout.
   */
  timeout?: number | undefined;
}

// =============================================================================
// EVENTS
// =============================================================================

/**
 * Event map for Ship SDK events
 * Core events for observability: request, response, error
 */
export interface ShipEvents extends Record<string, any[]> {
  /** Emitted before each API request */
  request: [url: string, init: RequestInit];
  /** Emitted after successful API response */
  response: [response: Response, url: string];
  /** Emitted when API request fails */
  error: [error: Error, url: string];
}

// StaticFile is now imported from @shipstatic/types

// =============================================================================
// API RESPONSES
// =============================================================================

// PingResponse is imported from @shipstatic/types (single source of truth)