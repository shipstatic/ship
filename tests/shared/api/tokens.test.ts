/**
 * @file Tokens API tests
 *
 * Tests for the tokens resource - create, list, and delete operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Ship from '../../../src/node';
import { resetMockServer } from '../../mocks/server';

describe('Tokens API', () => {
  let ship: Ship;

  beforeEach(() => {
    resetMockServer();
    ship = new Ship({
      apiKey: 'test-api-key',
      apiUrl: 'http://localhost:3000',
    });
  });

  describe('tokens.create()', () => {
    it('should create a token', async () => {
      const result = await ship.tokens.create();

      expect(result).toBeDefined();
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
      expect(result.token.length).toBeGreaterThan(0);
    });

    it('should create a token with TTL', async () => {
      const ttl = 3600; // 1 hour
      const result = await ship.tokens.create(ttl);

      expect(result).toBeDefined();
      expect(result.token).toBeDefined();
    });

    it('should create a token with tags', async () => {
      const result = await ship.tokens.create(undefined, ['ci', 'github-actions']);

      expect(result).toBeDefined();
      expect(result.token).toBeDefined();
    });

    it('should create a token with both TTL and tags', async () => {
      const ttl = 7200; // 2 hours
      const tags = ['production', 'deploy'];
      const result = await ship.tokens.create(ttl, tags);

      expect(result).toBeDefined();
      expect(result.token).toBeDefined();
    });
  });

  describe('tokens.list()', () => {
    it('should return token list response', async () => {
      const result = await ship.tokens.list();

      expect(result).toBeDefined();
      expect(result.tokens).toBeDefined();
      expect(Array.isArray(result.tokens)).toBe(true);
    });

    it('should include newly created tokens in list', async () => {
      // Get initial count
      const initialList = await ship.tokens.list();
      const initialCount = initialList.tokens.length;

      // Create a token
      await ship.tokens.create();

      const result = await ship.tokens.list();
      expect(result.tokens.length).toBe(initialCount + 1);
    });

    it('should include multiple created tokens', async () => {
      // Get initial count
      const initialList = await ship.tokens.list();
      const initialCount = initialList.tokens.length;

      // Create multiple tokens
      await ship.tokens.create();
      await ship.tokens.create();
      await ship.tokens.create();

      const result = await ship.tokens.list();
      expect(result.tokens.length).toBe(initialCount + 3);
    });
  });

  describe('tokens.remove()', () => {
    it('should remove a token', async () => {
      // Get initial count
      const initialList = await ship.tokens.list();
      const initialCount = initialList.tokens.length;

      // Create a token first
      const created = await ship.tokens.create();

      // Remove it
      await ship.tokens.remove(created.token);

      // Verify count is back to initial
      const list = await ship.tokens.list();
      expect(list.tokens.length).toBe(initialCount);
    });

    it('should throw when removing non-existent token', async () => {
      await expect(ship.tokens.remove('non-existent-token')).rejects.toThrow();
    });
  });
});
