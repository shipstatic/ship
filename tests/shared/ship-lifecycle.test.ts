/**
 * @file What a `Ship` lets its holder change after construction: the token
 * (`setToken`) and the headers every request carries (`setHeaders`,
 * `clearHeaders`). Each row reads the change on the next request it sends.
 */

import { describe, expect, it } from 'vitest';
import { Ship } from '../../src/shared/ship';
import type { ShipClientOptions } from '../../src/shared/types';
import { apiKey, deployToken, FREE_PLAN_LIMITS } from '../fixtures/builders';
import { fakeApi } from '../mocks/fetch';

const TEST_API_KEY = apiKey('a');
const TEST_DEPLOY_TOKEN = deployToken('b');

const DEPLOYED = { deployment: 'dep_123.shipstatic.com', url: 'https://dep_123.shipstatic.com' };

/** A client, and the headers of each request it sends. */
function client(options: ShipClientOptions = {}) {
  const api = fakeApi({ '/limits': FREE_PLAN_LIMITS, '/deployments': DEPLOYED });
  const ship = new Ship({ apiUrl: 'https://test-api.com', fetch: api.fetch, ...options });
  const sentHeaders = async () => {
    await ship.ping();
    return api.sent[api.sent.length - 1].headers;
  };
  return { ship, api, sentHeaders };
}

describe('Credential Lifecycle', () => {
  describe('setToken()', () => {
    it('should take effect immediately, without rebuilding the client', async () => {
      const { ship, api, sentHeaders } = client();

      // Anonymous first — no Authorization header.
      expect((await sentHeaders()).Authorization).toBeUndefined();

      ship.setToken(TEST_DEPLOY_TOKEN);

      expect(await ship.deploy([new File(['<html></html>'], 'index.html')])).toEqual(DEPLOYED);
      expect(api.sentTo('/deployments')[0].headers.Authorization).toBe(
        `Bearer ${TEST_DEPLOY_TOKEN}`,
      );
    });

    it('should validate input', () => {
      const { ship } = client();

      expect(() => ship.setToken('')).toThrow('Invalid token');
      expect(() => ship.setToken(null as any)).toThrow('Invalid token');
      expect(() => ship.setToken(undefined as any)).toThrow('Invalid token');
      // Prefixed tokens carry format guarantees — malformed ones fail fast.
      expect(() => ship.setToken('ship-tooshort')).toThrow(/characters total/);
      expect(() => ship.setToken('deploy-tooshort')).toThrow(/characters total/);
    });

    it('should replace the previous credential — last write wins', async () => {
      const { ship, sentHeaders } = client({ token: TEST_API_KEY });

      expect((await sentHeaders()).Authorization).toBe(`Bearer ${TEST_API_KEY}`);

      ship.setToken(TEST_DEPLOY_TOKEN);

      expect((await sentHeaders()).Authorization).toBe(`Bearer ${TEST_DEPLOY_TOKEN}`);
    });

    it('should accept a provider function', async () => {
      const { ship, sentHeaders } = client({ token: TEST_API_KEY });

      ship.setToken(() => 'minted-access-token');

      expect((await sentHeaders()).Authorization).toBe('Bearer minted-access-token');
    });

    it("rejects on a session client — the constructor exclusion holds for the client's life", async () => {
      const { ship, sentHeaders } = client({ session: true });

      expect(() => ship.setToken(TEST_API_KEY)).toThrow(
        'Provide either `token` or `session`, not both.',
      );
      expect(() => ship.setToken(() => TEST_API_KEY)).toThrow(
        'Provide either `token` or `session`, not both.',
      );
      // Still cookie-identified — no Authorization header was armed.
      expect((await sentHeaders()).Authorization).toBeUndefined();
    });
  });

  describe('setHeaders() / clearHeaders()', () => {
    it('should send the headers with every request from then on', async () => {
      const { ship, sentHeaders } = client();

      ship.setHeaders({ 'X-Custom': 'value' });

      expect((await sentHeaders())['X-Custom']).toBe('value');
      expect((await sentHeaders())['X-Custom']).toBe('value');
    });

    it('should clear them', async () => {
      const { ship, sentHeaders } = client();

      ship.setHeaders({ 'X-Custom': 'value' });
      ship.clearHeaders();

      expect((await sentHeaders())['X-Custom']).toBeUndefined();
    });
  });
});
