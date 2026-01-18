/**
 * @file E2E Test Setup
 *
 * Configuration for tests that run against the real API.
 * Requires SHIP_E2E_API_KEY environment variable.
 *
 * Usage:
 *   SHIP_E2E_API_KEY=ship-xxx pnpm test:e2e --run
 *
 * Environment Variables:
 *   SHIP_E2E_API_KEY  - Required. API key for E2E test account.
 *   SHIP_E2E_API_URL  - Optional. API URL (defaults to production).
 *
 * Guidelines:
 *   - E2E tests should be idempotent and clean up after themselves
 *   - Use unique identifiers (timestamps) to avoid collisions
 *   - Skip tests gracefully if API key is not provided
 *   - Focus on smoke tests, not exhaustive coverage
 */

import { beforeAll, afterAll } from 'vitest';

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * E2E API URL - defaults to production API
 * Can be overridden for staging/local testing
 */
export const E2E_API_URL = process.env.SHIP_E2E_API_URL || 'https://api.shipstatic.com';

/**
 * E2E API Key - must be set to run E2E tests
 */
export const E2E_API_KEY = process.env.SHIP_E2E_API_KEY;

/**
 * Whether E2E tests should run
 */
export const E2E_ENABLED = Boolean(E2E_API_KEY);

/**
 * Test run identifier - used to tag test resources for easy identification
 */
export const E2E_TEST_RUN_ID = `e2e-${Date.now()}`;

// =============================================================================
// SETUP & TEARDOWN
// =============================================================================

beforeAll(() => {
  if (!E2E_API_KEY) {
    console.warn(
      '\n' +
      '╔══════════════════════════════════════════════════════════════════╗\n' +
      '║  ⚠️  E2E Tests Skipped - No API Key Provided                      ║\n' +
      '║                                                                  ║\n' +
      '║  To run E2E tests, set the SHIP_E2E_API_KEY environment variable:║\n' +
      '║                                                                  ║\n' +
      '║  SHIP_E2E_API_KEY=ship-xxx pnpm test:e2e --run                   ║\n' +
      '╚══════════════════════════════════════════════════════════════════╝\n'
    );
    return;
  }

  console.log(
    '\n' +
    '╔══════════════════════════════════════════════════════════════════╗\n' +
    '║  🚀 E2E Tests Starting                                           ║\n' +
    `║  API: ${E2E_API_URL.padEnd(56)}║\n` +
    `║  Run ID: ${E2E_TEST_RUN_ID.padEnd(53)}║\n` +
    '╚══════════════════════════════════════════════════════════════════╝\n'
  );
});

afterAll(() => {
  if (E2E_API_KEY) {
    console.log(
      '\n' +
      '╔══════════════════════════════════════════════════════════════════╗\n' +
      '║  ✅ E2E Tests Complete                                           ║\n' +
      '╚══════════════════════════════════════════════════════════════════╝\n'
    );
  }
});

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Generate a unique test identifier
 * Used for deployment tags, domain names, etc.
 */
export function generateTestId(prefix: string = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Wait for a specified duration
 * Useful for waiting between API calls that have eventual consistency
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff
 * Useful for operations that may take time to propagate
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  } = {}
): Promise<T> {
  const { maxAttempts = 3, initialDelayMs = 1000, maxDelayMs = 10000 } = options;

  let lastError: Error | undefined;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        await wait(Math.min(delay, maxDelayMs));
        delay *= 2;
      }
    }
  }

  throw lastError;
}
