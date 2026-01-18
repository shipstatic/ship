import { describe, it, expect, afterEach } from 'vitest';
import { getENV, __setTestEnvironment } from '../../../src/shared/lib/env';

describe('Environment Utilities (Shared)', () => {
  afterEach(() => {
    __setTestEnvironment(null); // Reset any override after each test
  });

  it('getENV should return "node" in a Node.js-like environment (default for tests)', () => {
    // Assuming tests run in Node.js or __setTestEnvironment defaults to node if not set
    expect(getENV()).toBe('node');
  });

  it('getENV should return "browser" when overridden', () => {
    __setTestEnvironment('browser');
    expect(getENV()).toBe('browser');
  });

  it('getENV should return "unknown" when overridden', () => {
    __setTestEnvironment('unknown');
    expect(getENV()).toBe('unknown');
  });

  it('__setTestEnvironment can clear an override', () => {
    __setTestEnvironment('browser');
    expect(getENV()).toBe('browser');
    __setTestEnvironment(null);
    // This will depend on the actual environment the test runner is in.
    // For Vitest in Node, it should revert to 'node'.
    expect(getENV()).toBe('node');
  });
});