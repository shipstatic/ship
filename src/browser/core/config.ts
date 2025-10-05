/**
 * @file Browser configuration implementation - no file system access.
 * Browser environment receives all config through constructor options.
 */

import type { Config } from '../../shared/core/config.js';

/**
 * Browser config loading - always returns empty (no file system access).
 * All configuration must be provided through Ship constructor options.
 */
export async function loadConfig(configFile?: string): Promise<Config> {
  // In browser, no file system access - return empty config
  return {};
}