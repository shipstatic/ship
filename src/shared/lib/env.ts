/**
 * @file Environment detection utilities for the Ship SDK.
 * Helps in determining whether the SDK is running in a Node.js, browser, or unknown environment.
 */

/**
 * Represents the detected or simulated JavaScript execution environment.
 */
export type ExecutionEnvironment = 'browser' | 'node' | 'unknown';

/** @internal Environment override for testing. */
let _testEnvironment: ExecutionEnvironment | null = null;

/**
 * **FOR TESTING PURPOSES ONLY.**
 *
 * Allows tests to override the detected environment, forcing the SDK to behave
 * as if it's running in the specified environment.
 *
 * @param env - The environment to simulate ('node', 'browser', 'unknown'),
 *              or `null` to clear the override and revert to actual environment detection.
 * @internal
 */
export function __setTestEnvironment(env: ExecutionEnvironment | null): void {
  _testEnvironment = env;
}

/**
 * Detects the actual JavaScript execution environment (Node.js, browser, or unknown)
 * by checking for characteristic global objects.
 * @returns The detected environment as {@link ExecutionEnvironment}.
 * @internal
 */
function detectEnvironment(): ExecutionEnvironment {
  // Check for Node.js environment
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    return 'node';
  }

  // Check for Browser environment (including Web Workers)
  if (typeof window !== 'undefined' || typeof self !== 'undefined') {
    return 'browser';
  }

  return 'unknown';
}

/**
 * Gets the current effective execution environment.
 *
 * This function first checks if a test environment override is active via {@link __setTestEnvironment}.
 * If not, it detects the actual environment (Node.js, browser, or unknown).
 *
 * @returns The current execution environment: 'browser', 'node', or 'unknown'.
 * @public
 */
export function getENV(): ExecutionEnvironment {
  // Return test override if set
  if (_testEnvironment) {
    return _testEnvironment;
  }
  
  // Detect actual environment
  return detectEnvironment();
}
