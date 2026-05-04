/**
 * @file Cross-platform configuration helpers.
 *
 * Two pure helpers used by both Node and Browser:
 *
 *   - `resolveConfig(options)` — applies the API-URL default. The Node Ship
 *     calls this after merging env vars under the user's options; the Browser
 *     Ship calls it directly (no ambient sources).
 *   - `mergeDeployOptions(perCallOptions, clientDefaults)` — overlays
 *     instance-level defaults under per-call overrides for a single deploy.
 *
 * Credential precedence is owned by callers, not this file:
 *
 *   - SDK (Node): constructor args > `SHIP_*` env vars (see `node/index.ts`)
 *   - SDK (Browser): constructor args only
 *   - CLI: `--flag` > env > `.shiprc` / `package.json` (see `cli/create-client.ts`)
 */

import { DEFAULT_API, type ResolvedConfig } from '@shipstatic/types';
import type { ShipClientOptions, DeploymentOptions } from '../types.js';

export type { ResolvedConfig } from '@shipstatic/types';

/**
 * Apply the API-URL default and project the credential triplet into a
 * `ResolvedConfig` shape. Optional fields are omitted (rather than set to
 * `undefined`) so spread merges downstream behave predictably.
 */
export function resolveConfig(options: ShipClientOptions = {}): ResolvedConfig {
  const result: ResolvedConfig = {
    apiUrl: options.apiUrl || DEFAULT_API,
  };
  if (options.apiKey !== undefined) result.apiKey = options.apiKey;
  if (options.deployToken !== undefined) result.deployToken = options.deployToken;
  return result;
}

/**
 * Overlay client-level defaults under per-call deploy options.
 *
 * Per-call options always win — they're the explicit override for a single
 * `deployments.upload()`. Defaults fill in only when the per-call option is
 * `undefined` (an explicit `null` / empty value passes through).
 */
export function mergeDeployOptions(
  options: DeploymentOptions,
  clientDefaults: ShipClientOptions,
): DeploymentOptions {
  const result: DeploymentOptions = { ...options };

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
  if (result.caller === undefined && clientDefaults.caller !== undefined) {
    result.caller = clientDefaults.caller;
  }

  return result;
}
