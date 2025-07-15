/**
 * @file Manages loading and validation of client configuration.
 * This module uses `cosmiconfig` to find and load configuration from various
 * file sources (e.g., `.shiprc`, `package.json`) and environment variables.
 * Configuration values are validated using Zod schemas.
 */

import { z } from 'zod';
import { cosmiconfigSync } from 'cosmiconfig';
import { ShipClientOptions, DeploymentOptions, ShipError } from '../types.js';
import { getENV } from '../lib/env.js';
import { DEFAULT_API } from './constants.js';



/** @internal Name of the module, used by cosmiconfig for config file searching. */
const MODULE_NAME = 'ship';

/**
 * Zod schema for validating ship configuration.
 * @internal
 */
const ConfigSchema = z.object({
  apiUrl: z.string().url().optional(),
  apiKey: z.string().optional()
}).strict();

/**
 * Validates configuration using Zod schema.
 * @param config - Configuration object to validate
 * @returns Validated configuration or throws error
 * @internal
 */
function validateConfig(config: any): Partial<ShipClientOptions> {
  try {
    return ConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues[0];
      const path = firstError.path.length > 0 ? ` at ${firstError.path.join('.')}` : '';
      throw ShipError.config(`Configuration validation failed${path}: ${firstError.message}`);
    }
    throw ShipError.config('Configuration validation failed');
  }
}

/**
 * Synchronously loads client configuration from files.
 * Searches for .shiprc and package.json with ship key.
 * @returns Configuration object or empty if not found/invalid
 * @internal
 */
function loadConfigFromFile(): Partial<ShipClientOptions> {
  try {
    const explorer = cosmiconfigSync(MODULE_NAME, {
      searchPlaces: [
        `.${MODULE_NAME}rc`,
        'package.json',
      ],
    });
    
    const result = explorer.search();
    if (result && !result.isEmpty && result.config) {
      return validateConfig(result.config);
    }
  } catch (error) {
    if (error instanceof ShipError) throw error; // Re-throw all ShipError instances
    // Silently fail for file loading issues - this is optional config
  }
  return {};
}

/**
 * Simplified configuration loading prioritizing environment variables.
 * Only loads file config if environment variables are not set.
 * Only available in Node.js environments.
 *
 * @returns Configuration object with loaded values
 * @throws {ShipInvalidConfigError} If the configuration is invalid.
 */
export function loadConfig(): Partial<ShipClientOptions> {
  if (getENV() !== 'node') return {};

  // Start with environment variables (highest priority)
  const envConfig = {
    apiUrl: process.env.SHIP_API_URL,
    apiKey: process.env.SHIP_API_KEY,
  };

  // Always try to load file config for fallback values
  const fileConfig = loadConfigFromFile();

  // Merge with environment variables taking precedence
  const mergedConfig = {
    apiUrl: envConfig.apiUrl ?? fileConfig.apiUrl,
    apiKey: envConfig.apiKey ?? fileConfig.apiKey,
  };

  // Validate final config
  return validateConfig(mergedConfig);
}

/**
 * Simplified configuration resolution with clear precedence.
 * Precedence: user options > environment variables > config files > defaults.
 * 
 * @param userOptions - Options provided directly by the user
 * @param loadedConfig - Configuration loaded from environment/files
 * @returns Resolved configuration with api and apiKey
 */
export function resolveConfig(
  userOptions: ShipClientOptions = {}, 
  loadedConfig: Partial<ShipClientOptions> = {}
): { apiUrl: string; apiKey?: string } {
  // Build final config with clear precedence
  const finalConfig = {
    apiUrl: userOptions.apiUrl || loadedConfig.apiUrl || DEFAULT_API,
    apiKey: userOptions.apiKey !== undefined ? userOptions.apiKey : loadedConfig.apiKey,
  };

  // Return with optional apiKey
  return finalConfig.apiKey !== undefined 
    ? { apiUrl: finalConfig.apiUrl, apiKey: finalConfig.apiKey }
    : { apiUrl: finalConfig.apiUrl };
}


// =============================================================================
// CONFIGURATION MERGING
// =============================================================================

/**
 * Merge deployment options with client defaults.
 * Simple utility function that replaces the unnecessary ConfigMerger class.
 */
export function mergeDeployOptions(
  userOptions: DeploymentOptions = {},
  clientDefaults: ShipClientOptions
): DeploymentOptions {
  const merged: DeploymentOptions = { ...userOptions };
  
  // Only set defaults if not already provided
  if (merged.onProgress === undefined && clientDefaults.onProgress !== undefined) {
    merged.onProgress = clientDefaults.onProgress;
  }
  if (merged.onProgressStats === undefined && clientDefaults.onProgressStats !== undefined) {
    merged.onProgressStats = clientDefaults.onProgressStats;
  }
  if (merged.maxConcurrency === undefined && clientDefaults.maxConcurrentDeploys !== undefined) {
    merged.maxConcurrency = clientDefaults.maxConcurrentDeploys;
  }
  if (merged.timeout === undefined && clientDefaults.timeout !== undefined) {
    merged.timeout = clientDefaults.timeout;
  }
  if (merged.apiKey === undefined && clientDefaults.apiKey !== undefined) {
    merged.apiKey = clientDefaults.apiKey;
  }
  if (merged.apiUrl === undefined && clientDefaults.apiUrl !== undefined) {
    merged.apiUrl = clientDefaults.apiUrl;
  }
  
  return merged;
}
