/**
 * @file Platform configuration management for the Ship SDK.
 * Implements fail-fast dynamic configuration with mandatory API fetch.
 */

import type { ConfigResponse } from '@shipstatic/types';
import { ShipError } from '@shipstatic/types';

// Dynamic config - must be fetched from API before operations
let _config: ConfigResponse | null = null;

/**
 * Set the current config (called after fetching from API)
 */
export function setConfig(config: ConfigResponse): void {
  _config = config;
}

/**
 * Get current config - throws if not initialized (fail-fast approach)
 * @throws {ShipError.config} If configuration hasn't been fetched from API
 */
export function getCurrentConfig(): ConfigResponse {
  if (_config === null) {
    throw ShipError.config(
      'Platform configuration not initialized. The SDK must fetch configuration from the API before performing operations.'
    );
  }
  return _config;
}

/**
 * Check if config has been initialized from API
 */
export function isConfigInitialized(): boolean {
  return _config !== null;
}

/**
 * Reset config state (primarily for testing)
 * @internal
 */
export function resetConfig(): void {
  _config = null;
}