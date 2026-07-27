/**
 * @file Subject: the token half of `src/shared/api/http.ts`, driven end-to-end
 * through a real `Ship` against the wire-truth handler.
 *
 * Rewritten 2026-07-27. Every create test used to assert only that *something*
 * came back — `expect(result.token).toBeDefined()` — which held whether or not
 * the `ttl` and `labels` arguments ever left the process. They now assert the
 * options REACHED THE WIRE, by reading back the state the server derived from
 * them. And the client authenticates with a real `ship-` key: the previous
 * `'test-api-key'` is refused by `classifyToken`, and `POST /tokens` is not a
 * public route (wire: routes/tokens.ts:56-58).
 */

import { ErrorType } from '@shipstatic/types';
import { beforeEach, describe, expect, it } from 'vitest';
import Ship from '../../../src/node';
import { apiKey, timestamps } from '../../fixtures/builders';
import { getMockServerUrl, resetMockServer } from '../../mocks/server';

/** The mock's fixed "now", so a derived expiry is an exact expectation. */
const NOW = timestamps.jan2024;

describe('token operations', () => {
  let ship: Ship;

  beforeEach(() => {
    resetMockServer();
    ship = new Ship({ token: apiKey(), apiUrl: getMockServerUrl() });
  });

  describe('create', () => {
    it('returns a management id and a `deploy-`-shaped secret', async () => {
      const created = await ship.tokens.create();

      expect(created.token).toMatch(/^[a-z0-9]{7}$/);
      // The secret is the credential the user pastes; a shape the platform's
      // own validator would reject is not a useful fixture.
      expect(created.secret).toMatch(/^deploy-[0-9a-f]{64}$/);
      expect(created.labels).toEqual([]);
      expect(created.expires).toBeNull();
    });

    it('sends the ttl — the expiry comes back derived from it', async () => {
      const created = await ship.tokens.create({ ttl: 3600 });

      expect(created.expires).toBe(NOW + 3600);
    });

    it('sends the labels — they come back on the token and on the list', async () => {
      const created = await ship.tokens.create({ labels: ['production', 'ci-nightly'] });

      expect(created.labels).toEqual(['production', 'ci-nightly']);

      const { tokens } = await ship.tokens.list();
      expect(tokens.find((t) => t.token === created.token)?.labels).toEqual([
        'production',
        'ci-nightly',
      ]);
    });

    it('sends ttl and labels together', async () => {
      const created = await ship.tokens.create({ ttl: 86400, labels: ['nightly'] });

      expect(created.expires).toBe(NOW + 86400);
      expect(created.labels).toEqual(['nightly']);
    });
  });

  describe('list', () => {
    it('starts empty and totals what it holds', async () => {
      await expect(ship.tokens.list()).resolves.toEqual({ tokens: [], total: 0 });
    });

    it('reflects every created token', async () => {
      const first = await ship.tokens.create({ labels: ['one'] });
      const second = await ship.tokens.create({ labels: ['two'] });

      const list = await ship.tokens.list();

      expect(list.total).toBe(2);
      expect(list.tokens.map((t) => t.token)).toEqual([first.token, second.token]);
    });

    it('does not carry a cursor — this list is not paginated', async () => {
      // wire: routes/tokens.ts:114 returns `{ tokens, total }` only, unlike
      // the deployment and domain lists.
      expect(await ship.tokens.list()).not.toHaveProperty('cursor');
    });
  });

  describe('remove', () => {
    it('deletes the row, so the list no longer holds it', async () => {
      const created = await ship.tokens.create();

      await ship.tokens.remove(created.token);

      const list = await ship.tokens.list();
      expect(list.tokens).toEqual([]);
      expect(list.total).toBe(0);
    });

    it('reports an unknown token as not found', async () => {
      await expect(ship.tokens.remove('nosuch')).rejects.toMatchObject({
        type: ErrorType.NotFound,
        status: 404,
      });
    });
  });

  describe('authentication', () => {
    it('refuses an anonymous create — no token route is public', async () => {
      // wire: routes/tokens.ts:56-58 — auth on EVERY token route. The previous
      // mock treated `POST /tokens` as public, so an SDK regression dropping
      // the Authorization header here was undetectable.
      const anonymous = new Ship({ apiUrl: getMockServerUrl() });

      await expect(anonymous.tokens.create()).rejects.toMatchObject({
        type: ErrorType.Authentication,
        status: 401,
      });
    });
  });
});
