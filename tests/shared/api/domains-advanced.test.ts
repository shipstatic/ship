/**
 * @file Advanced Domain Operations tests
 *
 * Tests for advanced domain features: DNS info, records, sharing, and verification.
 * These operations are only available for external (custom) domains.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Ship from '../../../src/node';
import { resetMockServer } from '../../mocks/server';

describe('Advanced Domain Operations', () => {
  let ship: Ship;

  beforeEach(() => {
    resetMockServer();
    ship = new Ship({
      apiKey: 'test-api-key',
      apiUrl: 'http://localhost:3000',
    });
  });

  describe('domains.getDns()', () => {
    it('should get DNS info for unverified external domain', async () => {
      // First create an external domain
      const domain = await ship.domains.set('example.com', { deployment: 'test-deployment-1' });
      expect(domain.status).toBe('pending'); // External domains start as pending

      // Get DNS info
      const dnsInfo = await ship.domains.dns('example.com');

      expect(dnsInfo).toBeDefined();
      expect(dnsInfo.domain).toBe('example.com');
      expect(dnsInfo.dns).toBeDefined();
    });

    it('should fail for internal (subdomain) domains', async () => {
      await expect(ship.domains.dns('staging')).rejects.toThrow(
        /DNS information is only available for external domains/
      );
    });
  });

  describe('domains.getRecords()', () => {
    it('should get required DNS records for external domain', async () => {
      // First create an external domain
      await ship.domains.set('example.com', { deployment: 'test-deployment-1' });

      // Get records
      const records = await ship.domains.records('example.com');

      expect(records).toBeDefined();
      expect(records.domain).toBe('example.com');
      expect(records.records).toBeDefined();
      expect(Array.isArray(records.records)).toBe(true);
      expect(records.records.length).toBeGreaterThan(0);

      // Verify record structure
      const firstRecord = records.records[0];
      expect(firstRecord.type).toBeDefined();
      expect(firstRecord.name).toBeDefined();
      expect(firstRecord.value).toBeDefined();
    });

    it('should fail for internal domains', async () => {
      await expect(ship.domains.records('staging')).rejects.toThrow(
        /DNS information is only available for external domains/
      );
    });
  });

  describe('domains.getShare()', () => {
    it('should get share hash for unverified external domain', async () => {
      // First create an external domain
      await ship.domains.set('example.com', { deployment: 'test-deployment-1' });

      // Get share info
      const shareInfo = await ship.domains.share('example.com');

      expect(shareInfo).toBeDefined();
      expect(shareInfo.domain).toBe('example.com');
      expect(shareInfo.hash).toBeDefined();
      expect(typeof shareInfo.hash).toBe('string');
    });

    it('should fail for internal domains', async () => {
      await expect(ship.domains.share('staging')).rejects.toThrow(
        /Setup sharing is only available for external domains/
      );
    });
  });

  describe('domains.verify()', () => {
    it('should queue DNS verification for unverified external domain', async () => {
      // First create an external domain
      await ship.domains.set('example.com', { deployment: 'test-deployment-1' });

      // Request verification
      const result = await ship.domains.verify('example.com');

      expect(result).toBeDefined();
      expect(result.message).toContain('verification');
    });

    it('should fail for internal domains', async () => {
      await expect(ship.domains.verify('staging')).rejects.toThrow(
        /DNS verification is only available for external domains/
      );
    });

    it('should rate limit repeated verification requests', async () => {
      // Use unique domain to avoid cross-test pollution
      const domain = `verify-rate-limit-${Date.now()}.com`;
      await ship.domains.set(domain, { deployment: 'test-deployment-1' });

      // First verification should succeed
      await ship.domains.verify(domain);

      // Second immediate verification should fail with rate limit
      await expect(ship.domains.verify(domain)).rejects.toThrow(
        /DNS verification already requested recently/
      );
    });
  });

  describe('Domain status handling', () => {
    it('external domains should start as pending', async () => {
      const domain = await ship.domains.set('custom.example.com', { deployment: 'test-deployment-1' });

      expect(domain.status).toBe('pending');
    });

    it('internal domains should be immediately success', async () => {
      const domain = await ship.domains.set('my-subdomain', { deployment: 'test-deployment-1' });

      expect(domain.status).toBe('success');
    });
  });

  describe('domains.set() with labels only', () => {
    it('should update labels for an existing internal domain', async () => {
      // First create a domain
      await ship.domains.set('update-test', { deployment: 'test-deployment-1' });

      // Update its labels using set with labels only
      const updated = await ship.domains.set('update-test', { labels: ['new-label', 'another-label'] });

      expect(updated.domain).toBe('update-test');
      expect(updated.labels).toEqual(['new-label', 'another-label']);
    });

    it('should update labels for an existing external domain', async () => {
      // First create an external domain
      await ship.domains.set('update-external.com', { deployment: 'test-deployment-1' });

      // Update its labels
      const updated = await ship.domains.set('update-external.com', { labels: ['production', 'v2'] });

      expect(updated.domain).toBe('update-external.com');
      expect(updated.labels).toEqual(['production', 'v2']);
    });

    it('should clear labels when deployment is provided with empty array', async () => {
      // First create a domain with labels
      await ship.domains.set('clear-labels-test', { deployment: 'test-deployment-1', labels: ['initial-label'] });

      // Clear labels by passing deployment with empty array (uses PUT, not PATCH)
      const updated = await ship.domains.set('clear-labels-test', { deployment: 'test-deployment-1', labels: [] });

      expect(updated.domain).toBe('clear-labels-test');
      expect(updated.labels).toEqual([]);
    });

    it('should PUT (reserve) when empty labels array without deployment', async () => {
      const result = await ship.domains.set('some-domain', { labels: [] });
      expect(result.domain).toBe('some-domain');
    });

    it('should fail for non-existent domain', async () => {
      await expect(ship.domains.set('non-existent-domain', { labels: ['env'] }))
        .rejects.toThrow(/not found/i);
    });

    it('should preserve domain properties when updating labels', async () => {
      // Create domain
      const created = await ship.domains.set('preserve-test', { deployment: 'test-deployment-1' });

      // Update labels
      const updated = await ship.domains.set('preserve-test', { labels: ['updated-label'] });

      // Verify other properties are preserved
      expect(updated.domain).toBe(created.domain);
      expect(updated.deployment).toBe(created.deployment);
      expect(updated.status).toBe(created.status);
      expect(updated.url).toBe(created.url);
      expect(updated.labels).toEqual(['updated-label']);
    });
  });
});
