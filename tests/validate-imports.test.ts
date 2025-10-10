/**
 * Validation test to ensure our new test structure imports work correctly
 * This test verifies that our restructured imports are working
 */

import { describe, it, expect } from 'vitest';

describe('Import Validation for New Structure', () => {
  it('should import shared environment utilities', async () => {
    const { getENV, __setTestEnvironment } = await import('../src/shared/lib/env');
    expect(typeof getENV).toBe('function');
    expect(typeof __setTestEnvironment).toBe('function');
  });

  it('should import shared API utilities', async () => {
    const { ApiHttp } = await import('../src/shared/api/http');
    expect(ApiHttp).toBeDefined();
  });

  it('should import shared resources', async () => {
    const { createDeploymentResource, createDomainResource } = await import('../src/shared/resources');
    expect(typeof createDeploymentResource).toBe('function');
    expect(typeof createDomainResource).toBe('function');
  });

  it('should import Node.js Ship implementation', async () => {
    const { Ship } = await import('../src/node/index');
    expect(Ship).toBeDefined();
  });

  it('should import browser Ship implementation', async () => {
    const { Ship } = await import('../src/browser/index');
    expect(Ship).toBeDefined();
  });

  it('should import shared SPA detection', async () => {
    const { createSPAConfig, detectAndConfigureSPA } = await import('../src/shared/lib/prepare-input');
    expect(typeof createSPAConfig).toBe('function');
    expect(typeof detectAndConfigureSPA).toBe('function');
  });
});