/**
 * @file E2E Smoke Tests
 *
 * Verifies core SDK functionality against the real API.
 * These tests are designed to:
 * - Run quickly (smoke tests, not exhaustive)
 * - Clean up after themselves
 * - Skip gracefully if no API key is provided
 *
 * Test Coverage:
 * - API connectivity (ping)
 * - Authentication (account info)
 * - Core workflow (deploy → list → get → remove)
 * - Platform config retrieval
 *
 * NOT Tested (to avoid side effects):
 * - Domains (billing implications for custom domains)
 * - Tokens (could accumulate without cleanup)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import Ship from '../../src/node';
import { E2E_API_KEY, E2E_API_URL, E2E_ENABLED, E2E_TEST_RUN_ID } from '../setup-e2e';

// =============================================================================
// TEST CONFIGURATION
// =============================================================================

const TEST_SITE_PATH = path.resolve(__dirname, '../fixtures/demo-site');
const TEST_LABEL = `e2e-smoke-${Date.now()}`;

// Track deployments for cleanup
const deploymentsToCleanup: string[] = [];

// =============================================================================
// SMOKE TESTS
// =============================================================================

describe.skipIf(!E2E_ENABLED)('E2E Smoke Tests', () => {
  let ship: Ship;

  beforeAll(() => {
    ship = new Ship({
      apiKey: E2E_API_KEY!,
      apiUrl: E2E_API_URL,
    });
  });

  afterAll(async () => {
    // Clean up any deployments created during tests
    for (const deploymentId of deploymentsToCleanup) {
      try {
        await ship.deployments.remove(deploymentId);
        console.log(`  Cleaned up deployment: ${deploymentId}`);
      } catch (error) {
        // Ignore cleanup errors - deployment may already be removed
        console.warn(`  Failed to clean up deployment ${deploymentId}:`, error);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // CONNECTIVITY TESTS
  // ---------------------------------------------------------------------------

  describe('API Connectivity', () => {
    it('should ping the API successfully', async () => {
      const result = await ship.ping();
      expect(result).toBe(true);
    });

    it('should retrieve platform configuration', async () => {
      const config = await ship.getConfig();

      expect(config).toBeDefined();
      expect(config.maxFileSize).toBeGreaterThan(0);
      expect(config.maxFilesCount).toBeGreaterThan(0);
      expect(config.maxTotalSize).toBeGreaterThan(0);
      // ConfigResponse returns plan-based limits: maxFileSize, maxFilesCount, maxTotalSize
    });
  });

  // ---------------------------------------------------------------------------
  // AUTHENTICATION TESTS
  // ---------------------------------------------------------------------------

  describe('Authentication', () => {
    it('should retrieve account information', async () => {
      const account = await ship.account.get();

      expect(account).toBeDefined();
      expect(account.email).toBeDefined();
      expect(typeof account.email).toBe('string');
      expect(account.plan).toBeDefined();
      expect(account.created).toBeDefined();
      expect(typeof account.created).toBe('number');
    });

    it('should work with whoami() shortcut', async () => {
      const account = await ship.whoami();

      expect(account).toBeDefined();
      expect(account.email).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // DEPLOYMENT LIFECYCLE TESTS
  // ---------------------------------------------------------------------------

  describe('Deployment Lifecycle', () => {
    let testDeploymentId: string;

    it('should deploy a test site', async () => {
      const deployment = await ship.deploy(TEST_SITE_PATH, {
        labels: [TEST_LABEL, E2E_TEST_RUN_ID],
      });

      expect(deployment).toBeDefined();
      expect(deployment.deployment).toBeDefined();
      expect(deployment.status).toBe('success');
      expect(deployment.url).toContain('http');
      expect(deployment.files).toBeGreaterThan(0);
      expect(deployment.size).toBeGreaterThan(0);
      expect(deployment.created).toBeDefined();

      testDeploymentId = deployment.deployment;
      deploymentsToCleanup.push(testDeploymentId);

      console.log(`  Created deployment: ${testDeploymentId}`);
      console.log(`  URL: ${deployment.url}`);
    });

    it('should list deployments including the test deployment', async () => {
      const result = await ship.deployments.list();

      expect(result).toBeDefined();
      expect(Array.isArray(result.deployments)).toBe(true);

      // The test deployment should be in the list
      const found = result.deployments.find(d => d.deployment === testDeploymentId);
      expect(found).toBeDefined();
    });

    it('should get a specific deployment by ID', async () => {
      const deployment = await ship.deployments.get(testDeploymentId);

      expect(deployment).toBeDefined();
      expect(deployment.deployment).toBe(testDeploymentId);
      expect(deployment.status).toBe('success');
    });

    it('should verify deployment is accessible via HTTP', async () => {
      const deployment = await ship.deployments.get(testDeploymentId);

      // Fetch the deployment URL and verify it returns content
      const response = await fetch(deployment.url);

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      const content = await response.text();
      expect(content.length).toBeGreaterThan(0);
    });

    it('should remove the test deployment', async () => {
      await ship.deployments.remove(testDeploymentId);

      // Remove from cleanup list since we just deleted it
      const index = deploymentsToCleanup.indexOf(testDeploymentId);
      if (index > -1) {
        deploymentsToCleanup.splice(index, 1);
      }

      console.log(`  Removed deployment: ${testDeploymentId}`);
    });

    it('should return 404 for removed deployment', async () => {
      await expect(ship.deployments.get(testDeploymentId)).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // DEPLOYMENT OPTIONS TESTS
  // ---------------------------------------------------------------------------

  describe('Deployment Options', () => {
    it('should deploy with labels', async () => {
      const uniqueLabel = `e2e-labeled-${Date.now()}`;
      const deployment = await ship.deploy(TEST_SITE_PATH, {
        labels: [uniqueLabel, 'e2e-test'],
      });

      expect(deployment.labels).toBeDefined();
      expect(deployment.labels).toContain(uniqueLabel);
      expect(deployment.labels).toContain('e2e-test');

      deploymentsToCleanup.push(deployment.deployment);
    });

    it('should deploy with via field set to sdk', async () => {
      const deployment = await ship.deploy(TEST_SITE_PATH);

      // SDK deployments should have via: 'sdk'
      expect(deployment.via).toBe('sdk');

      deploymentsToCleanup.push(deployment.deployment);
    });
  });

  // ---------------------------------------------------------------------------
  // ERROR HANDLING TESTS
  // ---------------------------------------------------------------------------

  describe('Error Handling', () => {
    it('should throw on invalid deployment ID', async () => {
      await expect(
        ship.deployments.get('nonexistent-deployment-id-12345')
      ).rejects.toThrow();
    });

    it('should throw on removing nonexistent deployment', async () => {
      await expect(
        ship.deployments.remove('nonexistent-deployment-id-12345')
      ).rejects.toThrow();
    });
  });
});

// =============================================================================
// INVALID CREDENTIALS TEST
// =============================================================================

describe.skipIf(!E2E_ENABLED)('E2E Invalid Credentials', () => {
  it('should fail with invalid API key', async () => {
    const invalidShip = new Ship({
      apiKey: 'ship-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      apiUrl: E2E_API_URL,
    });

    await expect(invalidShip.account.get()).rejects.toThrow();
  });
});
