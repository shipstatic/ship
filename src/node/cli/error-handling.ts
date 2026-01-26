/**
 * @file Error handling utilities for the CLI.
 * Pure functions for error message formatting - fully unit testable.
 */

import { ShipError } from '@shipstatic/types';
import { ensureShipError } from '../index.js';

// Re-export for CLI consumers
export { ensureShipError };

/**
 * Context for error message generation
 */
export interface ErrorContext {
  operation?: string;
  resourceType?: string;
  resourceId?: string;
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
  context?: ErrorContext,
  options?: ErrorOptions
): string {
  // Not found errors - format consistently with resource context
  if (err.details?.data?.error === 'not_found') {
    const resourceType = context?.resourceType?.toLowerCase() || 'resource';
    const resourceId = context?.resourceId || '';
    return resourceId ? `${resourceId} ${resourceType} not found` : `${resourceType} not found`;
  }

  // Business logic errors - use API message directly (it's user-facing)
  if (err.details?.data?.error === 'business_logic_error') {
    return err.details.data.message || err.message;
  }

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
    const url = err.details?.url;
    if (url) {
      return `network error: could not reach ${url}`;
    }
    return 'network error: could not reach the API. check your internet connection';
  }

  // File, validation, client errors - trust the original message (we wrote it)
  if (err.isFileError() || err.isValidationError() || err.isClientError()) {
    return err.message;
  }

  // Server errors - generic but actionable
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
