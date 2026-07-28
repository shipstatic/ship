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
    it('answers an empty page in the list contract shape', async () => {
      // Two fields, exactly — `cursor: null` is the whole has-more signal,
      // so an empty list is not a special case of anything.
      await expect(ship.tokens.list()).resolves.toEqual({ tokens: [], cursor: null });
    });

    it('reflects every created token', async () => {
      const first = await ship.tokens.create({ labels: ['one'] });
      const second = await ship.tokens.create({ labels: ['two'] });

      const list = await ship.tokens.list();

      expect(list.tokens.map((t) => t.token)).toEqual([first.token, second.token]);
      expect(list.cursor).toBeNull();
    });

    it('carries a cursor like every other collection', async () => {
      // wire: routes/tokens.ts:114 — `{ tokens, cursor }`, the same pair the
      // deployment, domain, and activity lists answer.
      const list = await ship.tokens.list();
      expect(Object.keys(list).sort()).toEqual(['cursor', 'tokens']);
      expect(list.cursor).toBeNull(); // single page: no continuation
    });

    it('pages on limit, and the cursor walks the rest of the set', async () => {
      const created = [
        await ship.tokens.create(),
        await ship.tokens.create(),
        await ship.tokens.create(),
      ];

      const first = await ship.tokens.list({ limit: 2 });
      expect(first.tokens).toHaveLength(2);
      expect(first.cursor).not.toBeNull();

      const second = await ship.tokens.list({ limit: 2, cursor: first.cursor! });
      expect(second.tokens).toHaveLength(1);
      expect(second.cursor).toBeNull();

      // Pages partition the set — every token seen exactly once.
      const paged = [...first.tokens, ...second.tokens].map((t) => t.token);
      expect(new Set(paged)).toEqual(new Set(created.map((t) => t.token)));
    });
  });

  describe('remove', () => {
    it('deletes the row, so the list no longer holds it', async () => {
      const created = await ship.tokens.create();

      await ship.tokens.remove(created.token);

      const list = await ship.tokens.list();
      expect(list.tokens).toEqual([]);
      expect(list.cursor).toBeNull();
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
