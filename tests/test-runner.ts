/**
 * Simple test runner to verify our new test structure works
 * Run this with: pnpm vitest tests-new/test-runner.ts --run
 */

import { describe, it, expect } from 'vitest';

describe('New Test Structure Verification', () => {
  it('should be able to run tests from new structure', () => {
    expect(true).toBe(true);
  });

  it('should have access to shared functionality', async () => {
    // Test that we can import from our new shared structure
    const { getENV } = await import('../src/shared/lib/env.js');
    expect(typeof getENV).toBe('function');
  });

  it('should have access to Node.js functionality', async () => {
    // Test that we can import from our new Node.js structure
    const { Ship } = await import('../src/node/index.js');
    expect(Ship).toBeDefined();
  });

  it('should have access to browser functionality', async () => {
    // Test that we can import from our new browser structure
    const { Ship } = await import('../src/browser/index.js');
    expect(Ship).toBeDefined();
  });
});