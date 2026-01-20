/**
 * @file Concurrent Operations tests
 *
 * Simple tests to verify the SDK handles concurrent API calls correctly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Ship from '../../../src/node';
import { resetMockServer } from '../../mocks/server';

describe('Concurrent Operations', () => {
  let ship: Ship;

  beforeEach(() => {
    resetMockServer();
    ship = new Ship({
      apiKey: 'test-api-key',
      apiUrl: 'http://localhost:3000',
    });
  });

  describe('Concurrent API calls', () => {
    it('should handle multiple concurrent ping requests', async () => {
      const results = await Promise.all([
        ship.ping(),
        ship.ping(),
        ship.ping(),
      ]);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r === true)).toBe(true);
    });

    it('should handle concurrent list operations', async () => {
      const [deployments, domains, tokens] = await Promise.all([
        ship.deployments.list(),
        ship.domains.list(),
        ship.tokens.list(),
      ]);

      expect(deployments.deployments).toBeDefined();
      expect(domains.domains).toBeDefined();
      expect(tokens.tokens).toBeDefined();
    });

    it('should handle concurrent token creation', async () => {
      const results = await Promise.all([
        ship.tokens.create(),
        ship.tokens.create(),
        ship.tokens.create(),
      ]);

      expect(results).toHaveLength(3);

      // Each token should be unique
      const tokenValues = results.map((r) => r.token);
      const uniqueTokens = new Set(tokenValues);
      expect(uniqueTokens.size).toBe(3);
    });

    it('should handle concurrent domain operations', async () => {
      // Create multiple domains concurrently
      const results = await Promise.all([
        ship.domains.set('concurrent-1', { deployment: 'test-deployment-1' }),
        ship.domains.set('concurrent-2', { deployment: 'test-deployment-1' }),
        ship.domains.set('concurrent-3', { deployment: 'test-deployment-1' }),
      ]);

      expect(results).toHaveLength(3);
      expect(results[0].domain).toBe('concurrent-1');
      expect(results[1].domain).toBe('concurrent-2');
      expect(results[2].domain).toBe('concurrent-3');
    });

    it('should maintain event isolation between concurrent calls', async () => {
      const requestUrls: string[] = [];

      ship.on('request', (url) => {
        requestUrls.push(url);
      });

      await Promise.all([
        ship.ping(),
        ship.account.get(),
        ship.tokens.list(),
      ]);

      // Should have captured requests for all three operations
      expect(requestUrls.some((u) => u.includes('/ping'))).toBe(true);
      expect(requestUrls.some((u) => u.includes('/account'))).toBe(true);
      expect(requestUrls.some((u) => u.includes('/tokens'))).toBe(true);
    });
  });
});
