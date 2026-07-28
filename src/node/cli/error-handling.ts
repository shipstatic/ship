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

import { isShipError, ShipError } from '@shipstatic/types';
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
 * CLI options relevant to error message generation.
 */
export interface ErrorOptions {
  /**
   * The credential the CLI resolved (flag > env > file) — not the raw
   * `--token` flag. Presence selects the "invalid or expired" auth message;
   * absence selects the "how to authenticate" one.
   */
  token?: string;
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
  _context?: OutputContext,
  options?: ErrorOptions,
): string {
  // Auth errors - tell user what credentials to provide
  if (err.isAuthError()) {
    if (options?.token) {
      return 'authentication failed: invalid or expired token';
    }
    return 'authentication required: pass --token, set SHIP_TOKEN, or run ship config';
  }

  // Network errors — the transport failed before any response existed, so
  // there is nothing of the API's to quote. (A URL-naming variant lived here
  // until 2026-07-27, reading `details.url`; nothing has ever set that field —
  // `ShipError.fromFetchError` carries `{ cause }` — so the branch was dead.)
  if (err.isNetworkError()) {
    return 'network error: could not reach the API. check your internet connection';
  }

  // Client-attributable — a client-fault type, or any 4xx status (the guard
  // reads both axes, so a status-derived `Api` at 404 lands here too). The
  // message was authored for the end user at the throw site, API or local
  // code alike, so it is shown verbatim.
  if (err.isClientError()) {
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
  return JSON.stringify(
    {
      error: message,
      ...(details ? { details } : {}),
    },
    null,
    2,
  );
}
