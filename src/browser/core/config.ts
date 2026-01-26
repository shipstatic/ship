/**
 * @file Browser configuration implementation - no file system access.
 * Browser environment receives all config through constructor options.
 */

import type { PlatformConfig } from '@shipstatic/types';

/**
 * Browser config loading - always returns empty (no file system access).
 * All configuration must be provided through Ship constructor options.
 */
export async function loadConfig(configFile?: string): Promise<PlatformConfig> {
  // In browser, no file system access - return empty config
  return {};
}