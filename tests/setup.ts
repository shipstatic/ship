/**
 * @file Vitest setup for CLI tests with API mocking
 * Simple setup following "impossible simplicity" philosophy
 */

import { beforeAll, afterAll, afterEach } from 'vitest';
import { setupMockServer, cleanupMockServer, resetMockServer } from './mocks/server';

// jsdom lacks Blob.prototype.arrayBuffer; every shipping runtime has it.
// Polyfill via FileReader so tests can exercise the production code path.
if (typeof Blob !== 'undefined' && typeof (Blob.prototype as any).arrayBuffer !== 'function') {
  (Blob.prototype as any).arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as ArrayBuffer);
      fr.onerror = () => reject(fr.error);
      fr.readAsArrayBuffer(this);
    });
  };
}

// Setup mock server for all tests with timeout
beforeAll(async () => {
  await setupMockServer();
  // Give server time to fully start
  await new Promise(resolve => setTimeout(resolve, 100));
}, 10000);

// Cleanup after all tests
afterAll(async () => {
  await cleanupMockServer();
}, 5000);

// Reset handlers between tests for isolation
afterEach(() => {
  resetMockServer();
});