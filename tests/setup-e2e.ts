/**
 * @file E2E setup — tests that talk to a REAL API and create real resources.
 *
 * This tier is **opt-in twice over**: the `e2e` project is excluded from the
 * default `pnpm test` run (only `test:e2e` selects it), and this file refuses
 * to load without an explicit credential. Both gates are deliberate — an
 * earlier revision relied on a per-file `describe.skipIf`, which meant a
 * developer with `SHIP_E2E_API_KEY` exported created and deleted real
 * deployments on every plain test run.
 *
 * Usage:
 *   SHIP_E2E_API_KEY=ship-xxx pnpm test:e2e --run
 *
 * Environment:
 *   SHIP_E2E_API_KEY  Required. API key for the E2E account. Deliberately NOT
 *                     named `SHIP_TOKEN`: it is a harness variable, not part of
 *                     the SDK's env contract, and the CI secret name matches.
 *   SHIP_E2E_API_URL  Optional. Defaults to production — the only public value
 *                     this repo may carry. Non-production runs pass the target
 *                     explicitly (`SHIP_E2E_API_URL=… pnpm test:e2e --run`).
 *
 * Guidelines: idempotent tests, unique identifiers, clean up after yourself,
 * smoke coverage rather than exhaustive coverage.
 */

// =============================================================================
// GATE
// =============================================================================

/**
 * This suite's identity is `SHIP_E2E_API_KEY` and nothing else, so the SDK's
 * OWN ambient variable is scrubbed before any client is constructed.
 *
 * Two reasons, and the second is why it is here rather than at a call site.
 * A developer with `SHIP_TOKEN` exported would silently run the whole suite as
 * whatever account that names, against a URL chosen by a different variable —
 * the identity and the endpoint arriving from two unrelated places. And a
 * client built to be ANONYMOUS (the contract table's credential-less fixture)
 * would quietly authenticate, turning a refusal row into a confusing pass.
 *
 * Scrubbing at the process boundary is the SDK's own documented answer for
 * hosts needing strict isolation — there is no `envFallback: false`, on
 * purpose (`CLAUDE.md`, "Strict-isolation contract for embedded hosts").
 */
for (const name of ['SHIP_TOKEN', 'SHIP_API_URL']) {
  delete process.env[name];
}

if (!process.env.SHIP_E2E_API_KEY) {
  throw new Error(
    'E2E tests require SHIP_E2E_API_KEY. These tests create and delete REAL ' +
      'resources against a REAL API.\n' +
      '  SHIP_E2E_API_KEY=ship-xxx pnpm test:e2e --run\n' +
      'Add SHIP_E2E_API_URL to target an environment other than production.',
  );
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Target API. Production is the default and the only value tracked here. */
export const E2E_API_URL = process.env.SHIP_E2E_API_URL || 'https://api.shipstatic.com';

/** Credential for the E2E account. Present by construction — the gate ran. */
export const E2E_API_KEY = process.env.SHIP_E2E_API_KEY as string;

/**
 * Retained so per-file `describe.skipIf(!E2E_ENABLED)` guards keep compiling.
 * Always true here: the gate above throws otherwise.
 */
export const E2E_ENABLED = true;

/** Labels test resources so a stray one is identifiable in the real account. */
export const E2E_TEST_RUN_ID = `e2e-${Date.now()}`;

// =============================================================================
// TEST UTILITIES
// =============================================================================

/** Unique identifier for deployment labels, domain names, etc. */
export function generateTestId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/** Wait, for APIs with eventual consistency. */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry with exponential backoff, for operations that take time to propagate. */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  } = {},
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
