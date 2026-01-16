/**
 * @file Error utilities for consistent error handling across SDK consumers.
 */

import { ShipError } from '@shipstatic/types';

/**
 * Ensure any error is wrapped as a ShipError.
 * Useful for catch blocks where the error type is unknown.
 *
 * @example
 * ```ts
 * try {
 *   await someOperation();
 * } catch (err) {
 *   const shipError = ensureShipError(err);
 *   // Now you can safely use shipError.message, shipError.type, etc.
 * }
 * ```
 */
export function ensureShipError(err: unknown): ShipError {
  if (err instanceof ShipError) {
    return err;
  }

  // Handle Error instances
  if (err instanceof Error) {
    return ShipError.business(err.message);
  }

  // Handle null/undefined/other
  return ShipError.business(String(err ?? 'Unknown error'));
}
