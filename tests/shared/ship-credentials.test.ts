/**
 * @file The credential slot of `Ship`: one token of any population, a
 * provider that supplies one per request, a cookie session, or nothing.
 *
 * What a client holds is read where it matters, on the wire: each row sends a
 * request and reads its `Authorization` header.
 */

import { describe, expect, it } from 'vitest';
import { Ship } from '../../src/shared/ship';
import type { ShipClientOptions } from '../../src/shared/types';
import { apiKey, deployToken, FREE_PLAN_LIMITS, oauthToken } from '../fixtures/builders';
import { fakeApi } from '../mocks/fetch';

const TEST_API_KEY = apiKey('a');
const TEST_DEPLOY_TOKEN = deployToken('b');
const TEST_OAUTH_TOKEN = oauthToken('c');

const site = () => [new File(['<html></html>'], 'index.html')];

/** A client and the server it talks to. */
function client(options: ShipClientOptions = {}) {
  const api = fakeApi({ '/limits': FREE_PLAN_LIMITS });
  const ship = new Ship({ apiUrl: 'https://test-api.com', fetch: api.fetch, ...options });
  return { ship, api };
}

/** The `Authorization` header of a request this client sends. */
async function authorization(options: ShipClientOptions) {
  const { ship, api } = client(options);
  await ship.ping();
  return api.sent[0].headers.Authorization;
}

describe('The credential slot', () => {
  describe('anonymous', () => {
    it('deploys with no credential — the request simply carries no Authorization header', async () => {
      const { ship, api } = client();

      await ship.deploy(site());

      const [deploy] = api.sentTo('/deployments');
      expect(deploy.headers.Authorization).toBeUndefined();
    });
  });

  describe('static token', () => {
    it.each([
      // One slot, three populations: the value's shape says what it is;
      // the server classifies, and the client never has to.
      ['an API key', TEST_API_KEY],
      ['a deploy token', TEST_DEPLOY_TOKEN],
      ['an OAuth access token', TEST_OAUTH_TOKEN],
    ])('sends %s verbatim as the bearer', async (_what, token) => {
      expect(await authorization({ token })).toBe(`Bearer ${token}`);
    });

    it('validates prefixed tokens at the boundary', () => {
      // All three populations carry format guarantees; a malformed one fails
      // fast locally instead of as a confusing server 401. The SDK holds no
      // rule of its own: `validateToken` classifies and the constitution
      // owns the rules.
      expect(() => new Ship({ token: 'ship-tooshort' })).toThrow(/characters total/);
      expect(() => new Ship({ token: 'deploy-tooshort' })).toThrow(/characters total/);
      expect(() => new Ship({ token: 'oauth-tooshort' })).toThrow(/characters total/);
    });

    it('normalizes empty string to absence (anonymous)', async () => {
      // Shell expansion of an unset CI variable produces '' — absence of
      // credential intent, not a credential.
      expect(await authorization({ token: '' })).toBeUndefined();
    });
  });

  describe('token provider', () => {
    it('is invoked per request — rotation needs no client rebuild', async () => {
      let current = TEST_API_KEY;
      const { ship, api } = client({ token: () => current });

      await ship.ping();
      current = TEST_DEPLOY_TOKEN;
      await ship.ping();

      expect(api.sent.map((request) => request.headers.Authorization)).toEqual([
        `Bearer ${TEST_API_KEY}`,
        `Bearer ${TEST_DEPLOY_TOKEN}`,
      ]);
    });

    it('supports async providers', async () => {
      expect(await authorization({ token: async () => 'minted-access-token' })).toBe(
        'Bearer minted-access-token',
      );
    });

    it.each([
      // Never degrades to anonymous.
      ['nothing', () => '', 'Token provider returned no token.'],
      // Never puts garbage on the wire.
      ['a non-string', (() => ({})) as never, 'Token provider returned a non-string value.'],
    ])(
      'fails the request when the provider yields %s, and sends nothing',
      async (_what, token, message) => {
        const { ship, api } = client({ token });

        await expect(ship.ping()).rejects.toMatchObject({ message });
        expect(api.sent).toEqual([]);
      },
    );
  });

  describe('caller identity', () => {
    it('validates at construction — a value the API would drop throws instead', () => {
      expect(() => new Ship({ caller: 'has space' })).toThrow(/Caller/);
      expect(() => new Ship({ caller: 'a'.repeat(129) })).toThrow(/Caller/);
    });

    it('accepts a well-shaped caller and treats empty string as absence', () => {
      expect(() => new Ship({ caller: 'mcp.user-42' })).not.toThrow();
      expect(() => new Ship({ caller: '' })).not.toThrow();
    });
  });

  describe('session', () => {
    it('emits no Authorization header — cookies carry the identity', async () => {
      expect(await authorization({ session: true })).toBeUndefined();
    });

    it('deploys with the cookie session', async () => {
      const { ship, api } = client({ session: true });

      await ship.deploy(site());

      expect(api.sentTo('/deployments')).toHaveLength(1);
    });
  });

  describe('one client, one identity', () => {
    it('rejects token + session at construction', () => {
      expect(() => new Ship({ token: TEST_API_KEY, session: true })).toThrow(
        'Provide either `token` or `session`, not both.',
      );
    });
  });
});
