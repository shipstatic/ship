/**
 * @file Cross-platform configuration helpers.
 *
 * One pure helper used by the deployment resource:
 *
 *   - `mergeDeployOptions(perCallOptions, clientDefaults)` — overlays
 *     instance-level defaults under per-call overrides for a single deploy.
 *
 * Deploy options are pure deploy concerns (progress, timeout, concurrency).
 * Credentials, the API URL, and the caller identifier are client identity —
 * they live on the instance, never per call: one client is one principal
 * speaking for one end user against one API. Callers that need a different
 * identity construct another Ship.
 */

import type { ShipClientOptions, DeploymentOptions } from '../types.js';

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

  if (result.timeout === undefined && clientDefaults.timeout !== undefined) {
    result.timeout = clientDefaults.timeout;
  }
  if (result.maxConcurrency === undefined && clientDefaults.maxConcurrency !== undefined) {
    result.maxConcurrency = clientDefaults.maxConcurrency;
  }
  if (result.onProgress === undefined && clientDefaults.onProgress !== undefined) {
    result.onProgress = clientDefaults.onProgress;
  }

  return result;
}
