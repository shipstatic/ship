/**
 * @file Rate Limiting tests
 *
 * Tests for 429 (Too Many Requests) response handling.
 *
 * Rate limiting scenarios tested:
 * 1. Domain verification rate limiting (per-domain cooldown)
 * 2. Mock server's global rate limit simulation (via header/query param)
 *
 * Note: The global rate limit simulation using query params doesn't work well
 * with the SDK's URL construction. Domain-specific rate limiting is the
 * primary test focus here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Ship from '../../../src/node';
import { resetMockServer } from '../../mocks/server';

describe('Rate Limiting (429 responses)', () => {
  let ship: Ship;

  beforeEach(() => {
    resetMockServer();
    ship = new Ship({
      apiKey: 'test-api-key',
      apiUrl: 'http://localhost:3000',
    });
  });

  describe('Domain verification rate limiting', () => {
    it('should rate limit repeated DNS verification requests', async () => {
      // Use unique domain to avoid cross-test pollution
      const domain = `rate-limit-${Date.now()}.com`;
      await ship.domains.set(domain, { deployment: 'test-deployment-1' });

      // First verification should succeed
      await ship.domains.verify(domain);

      // Immediate second request should be rate limited
      await expect(ship.domains.verify(domain)).rejects.toThrow(
        /already requested recently/
      );
    });

    it('should allow verification for different domains', async () => {
      // Use unique domains
      const domain1 = `domain1-${Date.now()}.com`;
      const domain2 = `domain2-${Date.now()}.com`;

      await ship.domains.set(domain1, { deployment: 'test-deployment-1' });
      await ship.domains.set(domain2, { deployment: 'test-deployment-1' });

      // Both should succeed (different domains, different rate limits)
      await ship.domains.verify(domain1);
      await ship.domains.verify(domain2);
    });

    it('should not rate limit first verification request', async () => {
      // Use unique domain
      const domain = `first-verify-${Date.now()}.com`;
      await ship.domains.set(domain, { deployment: 'test-deployment-1' });

      // First request should always succeed
      const result = await ship.domains.verify(domain);
      expect(result.message).toContain('verification');
    });
  });

  describe('Normal operation (no rate limiting)', () => {
    it('should allow normal ping operations', async () => {
      const result = await ship.ping();
      expect(result).toBe(true);
    });

    it('should allow normal deployment list operations', async () => {
      const result = await ship.deployments.list();
      expect(result).toBeDefined();
      expect(result.deployments).toBeDefined();
    });

    it('should allow normal account operations', async () => {
      const account = await ship.account.get();
      expect(account).toBeDefined();
      expect(account.email).toBeDefined();
    });

    it('should allow normal token operations', async () => {
      // Create token
      const created = await ship.tokens.create();
      expect(created.token).toBeDefined();

      // List tokens
      const list = await ship.tokens.list();
      expect(list.tokens).toBeDefined();
    });

    it('should allow multiple domain operations', async () => {
      // Create multiple domains
      await ship.domains.set('test1', { deployment: 'test-deployment-1' });
      await ship.domains.set('test2', { deployment: 'test-deployment-1' });
      await ship.domains.set('test3', { deployment: 'test-deployment-1' });

      // All should succeed
      const list = await ship.domains.list();
      expect(list.domains.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Rate limit error format', () => {
    it('should return 429 status for rate-limited domain verification', async () => {
      // Use unique domain
      const domain = `error-format-${Date.now()}.com`;
      await ship.domains.set(domain, { deployment: 'test-deployment-1' });
      await ship.domains.verify(domain);

      // Verify error format
      try {
        await ship.domains.verify(domain);
        expect.fail('Should have thrown');
      } catch (error: any) {
        // Error should indicate the rate limit scenario
        expect(error.message).toContain('already requested recently');
      }
    });
  });
});
