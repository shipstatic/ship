/**
 * @file Shared configuration logic for both environments.
 */

import { DEFAULT_API, type PlatformConfig } from '@shipstatic/types';
import type { ShipClientOptions, DeploymentOptions } from '../types.js';
import { getENV } from '../lib/env.js';

// Re-export for backward compatibility
export type Config = PlatformConfig;

/**
 * Cross-environment config loader that dispatches to appropriate implementation.
 */
export async function loadConfig(configFile?: string): Promise<Config> {
  const env = getENV();
  
  if (env === 'browser') {
    // In browser, return empty config (no file system access)
    return {};
  } else if (env === 'node') {
    // In Node.js, load from environment and files
    const { loadConfig: nodeLoadConfig } = await import('../../node/core/config.js');
    return nodeLoadConfig(configFile);
  } else {
    // Fallback to empty config for unknown environments
    return {};
  }
}

/**
 * Universal configuration resolver for all environments.
 * This is the single source of truth for config resolution.
 */
export function resolveConfig(
  userOptions: ShipClientOptions = {}, 
  loadedConfig: Partial<ShipClientOptions> = {}
): { apiUrl: string; apiKey?: string; deployToken?: string } {
  const finalConfig = {
    apiUrl: userOptions.apiUrl || loadedConfig.apiUrl || DEFAULT_API,
    apiKey: userOptions.apiKey !== undefined ? userOptions.apiKey : loadedConfig.apiKey,
    deployToken: userOptions.deployToken !== undefined ? userOptions.deployToken : loadedConfig.deployToken,
  };

  const result: { apiUrl: string; apiKey?: string; deployToken?: string } = {
    apiUrl: finalConfig.apiUrl
  };
  
  if (finalConfig.apiKey !== undefined) result.apiKey = finalConfig.apiKey;
  if (finalConfig.deployToken !== undefined) result.deployToken = finalConfig.deployToken;
  
  return result;
}

/**
 * Merge deployment options with client defaults.
 * This is shared logic used by both environments.
 */
export function mergeDeployOptions(
  options: DeploymentOptions, 
  clientDefaults: ShipClientOptions
): DeploymentOptions {
  const result: DeploymentOptions = { ...options };
  
  // Only add defined values from client defaults
  if (result.apiUrl === undefined && clientDefaults.apiUrl !== undefined) {
    result.apiUrl = clientDefaults.apiUrl;
  }
  if (result.apiKey === undefined && clientDefaults.apiKey !== undefined) {
    result.apiKey = clientDefaults.apiKey;
  }
  if (result.deployToken === undefined && clientDefaults.deployToken !== undefined) {
    result.deployToken = clientDefaults.deployToken;
  }
  if (result.timeout === undefined && clientDefaults.timeout !== undefined) {
    result.timeout = clientDefaults.timeout;
  }
  if (result.maxConcurrency === undefined && clientDefaults.maxConcurrency !== undefined) {
    result.maxConcurrency = clientDefaults.maxConcurrency;
  }
  if (result.onProgress === undefined && clientDefaults.onProgress !== undefined) {
    result.onProgress = clientDefaults.onProgress;
  }
  if (result.onProgressStats === undefined && clientDefaults.onProgressStats !== undefined) {
    result.onProgressStats = clientDefaults.onProgressStats;
  }
  
  return result;
}