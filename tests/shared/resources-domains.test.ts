/**
 * @file Subject: `src/shared/resources.ts` — the domain resource, driven
 * end-to-end through a real `Ship` against the wire-truth handler.
 *
 * It was `http-domains.test.ts` until 2026-08-12, when the endpoint tier
 * folded down out of `ApiHttp` and its subject moved with it. Nothing in the
 * file changed: it always drove `ship.domains.*`, which is why it survived a
 * refactor that deleted every method it used to reach through. The
 * mock-delegation file that held this name — `expect(mockApi.setDomain)
 * .toHaveBeenCalledWith(...)` over an `ApiHttp` that no longer has the method
 * — went with the layer it was asserting.
 *
 * Re-pinned to the real API on 2026-07-27. Every assertion here previously
 * described an API that does not exist:
 *   - it authenticated with `'test-api-key'`, which `classifyToken` rejects;
 *   - it used bare labels (`staging`, `update-test`) as domain names, which the
 *     lookup schema refuses — it requires a dot;
 *   - it linked `test-deployment-1`, which fails the deployment-id pattern;
 *   - and it expected `validation_failed` / "external domains" where the API
 *     raises `business_logic_error` / "custom domains".
 */

import { ErrorType, isShipError } from '@shipstatic/types';
import { beforeEach, describe, expect, it } from 'vitest';
import Ship from '../../src/node';
import { apiKey, deploymentId, platformDomain } from '../fixtures/builders';
import { getMockServerUrl, resetMockServer } from '../mocks/server';

/** The deployment the mock state is seeded with. */
const DEPLOYMENT = deploymentId();
/** A platform subdomain: `<label>.shipstatic.com`. */
const PLATFORM = platformDomain('preview-site');
/** Anything not under the platform domain is custom. */
const CUSTOM = 'www.example.com';

describe('domain operations', () => {
  let ship: Ship;

  beforeEach(() => {
    resetMockServer();
    ship = new Ship({ token: apiKey(), apiUrl: getMockServerUrl() });
  });

  describe('status on create', () => {
    it('starts a custom domain as pending (DNS not yet verified)', async () => {
      const domain = await ship.domains.set(CUSTOM, { deployment: DEPLOYMENT });

      expect(domain.status).toBe('pending');
      expect(domain.isCreate).toBe(true);
    });

    it('starts a platform domain as success (nothing to verify)', async () => {
      const domain = await ship.domains.set(PLATFORM, { deployment: DEPLOYMENT });

      expect(domain.status).toBe('success');
    });
  });

  describe('sub-resources are custom-domain only', () => {
    beforeEach(async () => {
      await ship.domains.set(CUSTOM, { deployment: DEPLOYMENT });
    });

    it('returns the DNS provider for an unverified custom domain', async () => {
      const dns = await ship.domains.dns(CUSTOM);

      expect(dns.domain).toBe(CUSTOM);
      expect(dns.dns?.provider?.name).toBe('Cloudflare');
    });

    it('returns the required records, A before CNAME', async () => {
      const records = await ship.domains.records(CUSTOM);

      expect(records.domain).toBe(CUSTOM);
      expect(records.apex).toBe('example.com');
      // A first: it is the apex redirect. CNAME second: it is the hosted
      // endpoint. The order is the instruction the user follows.
      expect(records.records).toEqual([
        { type: 'A', name: '@', value: '15.204.149.253' },
        { type: 'CNAME', name: 'www', value: 'cname.shipstatic.com' },
      ]);
    });

    it('returns the finished setup share link', async () => {
      const share = await ship.domains.share(CUSTOM);

      expect(share.domain).toBe(CUSTOM);
      // The mock plants the wire's own composition: connect host, domain
      // first, 16-hex hash second. The SDK relays it untouched.
      expect(share.url).toBe(`https://connect.shipstatic.com/${CUSTOM}/a1b2c3d4e5f6a7b8`);
    });

    it.each([
      ['dns', (s: Ship, d: string) => s.domains.dns(d), 'DNS information'],
      ['records', (s: Ship, d: string) => s.domains.records(d), 'DNS information'],
      ['share', (s: Ship, d: string) => s.domains.share(d), 'Setup sharing'],
      ['verify', (s: Ship, d: string) => s.domains.verify(d), 'DNS verification'],
    ])('rejects %s on a platform domain as a business rule', async (_name, call, subject) => {
      await ship.domains.set(PLATFORM, { deployment: DEPLOYMENT });

      const error = await call(ship, PLATFORM).catch((e) => e);

      // wire: routes/domains.ts:103,129,152 + lib/domains/verify.ts:24 —
      // `ShipError.business(..., 400)`, and the wording is "custom domains".
      expect(isShipError(error)).toBe(true);
      expect(error.type).toBe(ErrorType.Business);
      expect(error.status).toBe(400);
      expect(error.message).toBe(`${subject} is only available for custom domains`);
    });
  });

  describe('verify', () => {
    beforeEach(async () => {
      await ship.domains.set(CUSTOM, { deployment: DEPLOYMENT });
    });

    it('queues a verification', async () => {
      const result = await ship.domains.verify(CUSTOM);

      // The acknowledgement is the canonical domain and nothing else — the
      // 202 says "queued", so no field repeats it and no prose rides along.
      expect(result).toEqual({ domain: CUSTOM });
    });

    it('answers a repeat request with the real 429 contract', async () => {
      await ship.domains.verify(CUSTOM);

      const error = await ship.domains.verify(CUSTOM).catch((e) => e);

      // The whole contract, not just the status: an earlier revision let the
      // mock send a `validation_failed` / `status: 400` BODY under a 429 head,
      // with no `Retry-After` — so a client reading `error.type` saw a
      // validation failure where production sends a rate limit.
      // wire: lib/domains/verify.ts:46-49 + api/src/index.ts:140-146
      expect(isShipError(error)).toBe(true);
      expect(error.type).toBe(ErrorType.RateLimit);
      expect(error.status).toBe(429);
      expect(error.message).toMatch(/already requested recently/);
      expect(error.details?.resetAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('scopes the cooldown to one domain', async () => {
      const other = 'www.other-example.com';
      await ship.domains.set(other, { deployment: DEPLOYMENT });
      await ship.domains.verify(CUSTOM);

      await expect(ship.domains.verify(other)).resolves.toEqual({ domain: other });
    });
  });

  describe('set is a merge-upsert', () => {
    it('creates with 201 and reports isCreate', async () => {
      const created = await ship.domains.set(CUSTOM, { labels: ['env'] });

      expect(created.isCreate).toBe(true);
      expect(created.labels).toEqual(['env']);
    });

    it('updates with 200 and reports isCreate false', async () => {
      await ship.domains.set(CUSTOM, { deployment: DEPLOYMENT });

      const updated = await ship.domains.set(CUSTOM, { labels: ['production'] });

      expect(updated.isCreate).toBe(false);
      expect(updated.labels).toEqual(['production']);
    });

    it('preserves the fields the update omits', async () => {
      const created = await ship.domains.set(CUSTOM, { deployment: DEPLOYMENT });

      const updated = await ship.domains.set(CUSTOM, { labels: ['updated'] });

      // `created`, `links` and the deployment link belong to the ROW; a
      // labels-only update must not regenerate them.
      expect(updated.deployment).toBe(created.deployment);
      expect(updated.status).toBe(created.status);
      expect(updated.created).toBe(created.created);
      expect(updated.links).toBe(created.links);
    });

    it('reserves a domain when no deployment is given', async () => {
      const reserved = await ship.domains.set(CUSTOM, { labels: [] });

      expect(reserved.deployment).toBeNull();
      expect(reserved.isCreate).toBe(true);
    });

    it('clears labels with an explicit empty array', async () => {
      await ship.domains.set(CUSTOM, { deployment: DEPLOYMENT, labels: ['initial'] });

      const cleared = await ship.domains.set(CUSTOM, { deployment: DEPLOYMENT, labels: [] });

      expect(cleared.labels).toEqual([]);
    });

    it('rejects a deployment that does not exist as a 422 business rule', async () => {
      // wire: lib/domains/upsert.ts:81-86 — 422, not 404: the request is
      // well-formed, the referenced resource just cannot back a domain.
      const error = await ship.domains
        .set(CUSTOM, { deployment: 'brave-otter-9999999' })
        .catch((e) => e);

      expect(error.type).toBe(ErrorType.Business);
      expect(error.status).toBe(422);
      expect(error.message).toMatch(/can only point at a deployment/);
    });
  });

  describe('delete', () => {
    it('deletes the row, so a follow-up read 404s', async () => {
      await ship.domains.set(CUSTOM, { deployment: DEPLOYMENT });

      await ship.domains.delete(CUSTOM);

      // wire: routes/domains.ts:203 — 200 `{domain}` AND the row is gone. The
      // previous mock answered 204 and kept the row, so a delete that did
      // nothing would have passed.
      await expect(ship.domains.get(CUSTOM)).rejects.toMatchObject({
        type: ErrorType.NotFound,
      });
    });
  });
});
