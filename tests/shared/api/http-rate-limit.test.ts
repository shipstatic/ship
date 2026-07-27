/**
 * @file Subject: how `src/shared/api/http.ts` surfaces a 429 to SDK callers.
 *
 * Rewritten 2026-07-27. The previous file had no consumer of the mock's global
 * rate-limit hook at all: every test re-exercised the per-domain verify
 * cooldown (which now lives with its subject in `http-domains.test.ts`) or
 * asserted that unrelated operations "work normally", which is what every
 * other file in this directory already asserts.
 *
 * Two altitudes, because the contract has two halves:
 *   - what a client sees on the wire (`Retry-After`), asserted with a direct
 *     fetch, since the SDK throws before emitting a `response` event;
 *   - what an SDK caller sees (a typed `ShipError` carrying `details.resetAt`).
 */

import { ErrorType, isShipError } from '@shipstatic/types';
import { beforeEach, describe, expect, it } from 'vitest';
import Ship from '../../../src/node';
import { apiKey } from '../../fixtures/builders';
import { getMockServerUrl, resetMockServer } from '../../mocks/server';

/** The mock's lever for making any route answer 429. */
const RATE_LIMITED = { 'X-Mock-Rate-Limit': 'true' };

describe('429 handling', () => {
  let ship: Ship;

  beforeEach(() => {
    resetMockServer();
    ship = new Ship({ token: apiKey(), apiUrl: getMockServerUrl() });
  });

  describe('the wire contract', () => {
    it('carries Retry-After alongside the typed body', async () => {
      // wire: api/src/index.ts:140-146 — every 429 gets the standard header,
      // derived from `details.resetAt`, so generic HTTP machinery (curl,
      // proxies, retrying clients) can honour the window without parsing prose.
      const response = await fetch(`${getMockServerUrl()}/deployments`, {
        headers: { Authorization: `Bearer ${apiKey()}`, ...RATE_LIMITED },
      });

      expect(response.status).toBe(429);
      const retryAfter = Number(response.headers.get('Retry-After'));
      expect(retryAfter).toBeGreaterThan(0);

      const body = await response.json();
      expect(body.error).toBe('rate_limit_exceeded');
      expect(body.status).toBe(429);
      expect(typeof body.details.resetAt).toBe('string');
    });
  });

  describe('what the SDK caller sees', () => {
    it('raises a typed RateLimit error carrying resetAt', async () => {
      ship.setHeaders(RATE_LIMITED);

      const error = await ship.deployments.list().catch((e) => e);

      expect(isShipError(error)).toBe(true);
      expect(error.type).toBe(ErrorType.RateLimit);
      expect(error.status).toBe(429);
      // `Retry-After` is a header, and `ShipError.fromHttpResponse` reads only
      // the body — so `details.resetAt` is the machine-readable window a
      // consumer can act on. Recorded rather than worked around: the same
      // instant is available either way.
      expect(error.details?.resetAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('classifies 429 on any route, not just the ones with a cooldown', async () => {
      ship.setHeaders(RATE_LIMITED);

      for (const call of [
        () => ship.account.get(),
        () => ship.domains.list(),
        () => ship.tokens.list(),
      ]) {
        await expect(call()).rejects.toMatchObject({ type: ErrorType.RateLimit, status: 429 });
      }
    });

    it('emits an error event for the rate-limited request', async () => {
      // Warm the lazy `/limits` hydration FIRST. Setting the header before it
      // runs would rate-limit initialization instead, and the error event would
      // name `/limits` — which is a true statement about a different request.
      await ship.getLimits();

      const errors: string[] = [];
      ship.on('error', (_error, url) => errors.push(url));
      ship.setHeaders(RATE_LIMITED);

      await expect(ship.deployments.list()).rejects.toThrow();

      expect(errors).toEqual([`${getMockServerUrl()}/deployments`]);
    });
  });
});
