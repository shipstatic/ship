/**
 * @file Manages loading and validation of client configuration.
 * This module uses `cosmiconfig` to find and load configuration from various
 * file sources (e.g., `.shiprc`, `package.json`) and environment variables.
 * Configuration values are validated using Zod schemas.
 */

import { z } from 'zod';
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
 * Loads client configuration from files.
 * Searches for .shiprc and package.json with ship key.
 * First searches from the current directory, then from the home directory.
 * @param configFile - Optional specific config file path to load
 * @returns Configuration object or empty if not found/invalid
 * @internal
 */
async function loadConfigFromFile(configFile?: string): Promise<Partial<ShipClientOptions>> {
  try {
    // Only use cosmiconfig in Node.js environments
    if (getENV() !== 'node') {
      return {};
    }
    
    // Dynamically import cosmiconfig and os only in Node.js environments
    const { cosmiconfigSync } = await import('cosmiconfig');
    const os = await import('os');
    
    const explorer = cosmiconfigSync(MODULE_NAME, {
      searchPlaces: [
        `.${MODULE_NAME}rc`,
        'package.json',
        `${os.homedir()}/.${MODULE_NAME}rc`, // Always include home directory as fallback
      ],
      stopDir: os.homedir(), // Stop searching at home directory
    });
    
    let result;
    
    // If a specific config file is provided, load it directly
    if (configFile) {
      result = explorer.load(configFile);
    } else {
      // cosmiconfig automatically searches up the directory tree
      // from current directory to stopDir (home directory)
      result = explorer.search();
    }
    
    if (result && result.config) {
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
 * @param configFile - Optional specific config file path to load
 * @returns Configuration object with loaded values
 * @throws {ShipInvalidConfigError} If the configuration is invalid.
 */
export async function loadConfig(configFile?: string): Promise<Partial<ShipClientOptions>> {
  if (getENV() !== 'node') return {};

  // Start with environment variables (highest priority)
  const envConfig = {
    apiUrl: process.env.SHIP_API_URL,
    apiKey: process.env.SHIP_API_KEY,
  };

  // Always try to load file config for fallback values
  const fileConfig = await loadConfigFromFile(configFile);

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
  // Only use userOptions.apiKey if it's explicitly provided (not undefined)
  const finalConfig = {
    apiUrl: userOptions.apiUrl || loadedConfig.apiUrl || DEFAULT_API,
    apiKey: userOptions.apiKey || loadedConfig.apiKey,
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
 * Uses a declarative approach with object spreading for simplicity.
 */
export function mergeDeployOptions(
  userOptions: DeploymentOptions = {},
  clientDefaults: ShipClientOptions
): DeploymentOptions {
  return {
    // Start with client defaults
    onProgress: clientDefaults.onProgress,
    onProgressStats: clientDefaults.onProgressStats,
    maxConcurrency: clientDefaults.maxConcurrentDeploys,
    timeout: clientDefaults.timeout,
    apiKey: clientDefaults.apiKey,
    apiUrl: clientDefaults.apiUrl,
    // Overwrite with any user-provided options
    ...userOptions,
  };
}
