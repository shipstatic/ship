/**
 * @file CLI-specific error UX utilities.
 *
 * Two pure functions: `toShipError` normalizes any thrown value into a typed
 * `ShipError` for the CLI's global error boundary; `getUserMessage` translates
 * a `ShipError` into the actionable string the CLI prints. Both are pure for
 * easy unit testing.
 *
 * Distinct from `ShipError.fromFetchError` (in `@shipstatic/types`), which is
 * for HTTP fetch failures. The CLI's global handler also catches things like
 * Commander parse errors, runtime exceptions in user code, etc. — so it uses
 * `toShipError` and intentionally normalizes unknowns to `Business` (a client
 * error type) so `getUserMessage`'s `isClientError()` branch surfaces the
 * original message rather than swallowing it as a generic "server error".
 */

import { ShipError, isShipError } from '@shipstatic/types';
import type { OutputContext } from './formatters.js';

/**
 * Normalize any thrown value to a `ShipError` for the CLI error boundary.
 * Pass-through for existing `ShipError`s; wraps other Errors and unknowns
 * as `Business` so their message is preserved through `getUserMessage`.
 */
export function toShipError(err: unknown): ShipError {
  if (isShipError(err)) {
    return err;
  }
  if (err instanceof Error) {
    return ShipError.business(err.message);
  }
  return ShipError.business(String(err ?? 'Unknown error'));
}

/**
 * CLI options relevant to error message generation
 */
export interface ErrorOptions {
  apiKey?: string;
  deployToken?: string;
}

/**
 * Get actionable user-facing message from an error.
 * Transforms technical errors into helpful messages that tell users what to do.
 *
 * This is a pure function - given the same inputs, always returns the same output.
 * All error message logic is centralized here for easy testing and maintenance.
 */
export function getUserMessage(
  err: ShipError,
  context?: OutputContext,
  options?: ErrorOptions
): string {
  // Auth errors - tell user what credentials to provide
  if (err.isAuthError()) {
    if (options?.apiKey) {
      return 'authentication failed: invalid API key';
    } else if (options?.deployToken) {
      return 'authentication failed: invalid or expired deploy token';
    } else {
      return 'authentication required: use --api-key or --deploy-token, or set SHIP_API_KEY';
    }
  }

  // Network errors - include context about what failed
  if (err.isNetworkError()) {
    const url = (err.details as { url?: string } | undefined)?.url;
    if (url) {
      return `network error: could not reach ${url}`;
    }
    return 'network error: could not reach the API. check your internet connection';
  }

  // Client errors (Business | Config | File | Forbidden | Validation) —
  // trust the original message; the API or local code authored it.
  if (err.isClientError()) {
    return err.message;
  }

  // Other 4xx (NotFound, RateLimit, anything else with a 4xx status) —
  // the API's message is user-facing; trust it.
  if (err.status && err.status >= 400 && err.status < 500) {
    return err.message;
  }

  // Server errors (5xx) - generic but actionable
  return 'server error: please try again or check https://status.shipstatic.com';
}

/**
 * Format error for JSON output.
 * Returns the JSON string to be output (without newline).
 */
export function formatErrorJson(message: string, details?: unknown): string {
  return JSON.stringify({
    error: message,
    ...(details ? { details } : {})
  }, null, 2);
}
