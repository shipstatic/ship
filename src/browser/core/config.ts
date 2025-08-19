/**
 * @file Browser configuration implementation - no file system access.
 */

import type { Config } from '../../shared/core/config.js';
import type { ShipClientOptions } from '../../shared/types.js';

const browserConfig: Config = {};

/**
 * Browser config loading - only uses provided options.
 */
export async function loadConfig(configFile?: string): Promise<Config> {
  // In browser, no file system access - return empty config
  return {};
}


/**
 * Set platform config in browser.
 */
export function setConfig(config: any): void {
  Object.assign(browserConfig, config);
}