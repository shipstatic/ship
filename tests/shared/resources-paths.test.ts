/**
 * @file Subject: `src/shared/resources.ts` — the URLs it builds.
 *
 * Every other resource mirror drives a real `Ship` against the wire-truth
 * handler, which is the right altitude for behaviour: what the API answers and
 * what the SDK resolves. It is the wrong altitude for the two facts below,
 * because a mock server that ROUTES a request has already forgiven whatever
 * the client did to the URL on the way in.
 *
 * So this file stubs `fetch` and reads the string. Two things live here:
 *
 *  - **Path-parameter encoding.** The SDK is a transparent pipe and does not
 *    validate domain names or deployment ids, so `encodeURIComponent` is the
 *    only thing standing between a hostile identifier and a different
 *    endpoint. That is a security property of the URL, not of the response.
 *  - **Pagination serialization.** `limit`/`cursor` become a query string or
 *    nothing at all, and "nothing at all" is invisible from the answer.
 *
 * Both moved here on 2026-08-12 with the endpoint tier: they were assertions
 * about `ApiHttp`'s URL building, and the URLs are the resources' now.
 */

import { describe, expect, it, vi } from 'vitest';
import { ApiHttp } from '../../src/shared/api/http';
import {
  createDeploymentResource,
  createDomainResource,
  createTokenResource,
} from '../../src/shared/resources';
import type { StaticFile } from '../../src/shared/types';

global.fetch = vi.fn();

const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

/** The URL the most recent request went to. */
const lastUrl = () => (global.fetch as any).mock.calls.at(-1)[0] as string;

function resources() {
  const api = new ApiHttp({
    apiUrl: 'https://api.test.com',
    getAuthHeaders: () => ({ Authorization: 'Bearer test' }),
  });
  const ctx = { getApi: () => api };
  return {
    domains: createDomainResource(ctx),
    tokens: createTokenResource(ctx),
    deployments: createDeploymentResource({
      ...ctx,
      processInput: async (input) => input as unknown as StaticFile[],
    }),
  };
}

describe('the URLs the resources build', () => {
  describe('path parameters are encoded', () => {
    it('percent-encodes a non-ASCII domain name', async () => {
      // Input that actually REQUIRES encoding. An earlier version of this row
      // passed `test.example.com`, whose encoded form is itself — so the
      // assertion held identically with no `encodeURIComponent` call at all.
      (global.fetch as any).mockResolvedValue(json({ domain: 'tëst.example.com', dns: {} }));

      await resources().domains.dns('tëst.example.com');

      expect(lastUrl()).toBe('https://api.test.com/domains/t%C3%ABst.example.com/dns');
    });

    it('encodes a path separator so a name cannot forge a sub-route', async () => {
      // The SDK does not validate domain names — the API owns that vocabulary
      // — so encoding is the whole of the client-side defence.
      (global.fetch as any).mockResolvedValue(json({ domain: 'x', dns: {} }));

      await resources().domains.dns('evil.com/../../account');

      expect(lastUrl()).toBe('https://api.test.com/domains/evil.com%2F..%2F..%2Faccount/dns');
    });

    it.each([
      ['domains.get', (r: ReturnType<typeof resources>) => r.domains.get('a/../b.example.com')],
      [
        'domains.delete',
        (r: ReturnType<typeof resources>) => r.domains.delete('a/../b.example.com'),
      ],
      [
        'domains.verify',
        (r: ReturnType<typeof resources>) => r.domains.verify('a/../b.example.com'),
      ],
      [
        'domains.records',
        (r: ReturnType<typeof resources>) => r.domains.records('a/../b.example.com'),
      ],
      ['domains.share', (r: ReturnType<typeof resources>) => r.domains.share('a/../b.example.com')],
      ['deployments.get', (r: ReturnType<typeof resources>) => r.deployments.get('a/../b')],
      ['deployments.delete', (r: ReturnType<typeof resources>) => r.deployments.delete('a/../b')],
      [
        'deployments.set',
        (r: ReturnType<typeof resources>) => r.deployments.set('a/../b', { labels: [] }),
      ],
      ['tokens.get', (r: ReturnType<typeof resources>) => r.tokens.get('a/../b')],
      ['tokens.delete', (r: ReturnType<typeof resources>) => r.tokens.delete('a/../b')],
    ])('%s cannot be escaped by a traversal in its identifier', async (_name, call) => {
      // Quantified over EVERY resource method taking a path parameter: one
      // method forgetting `encodeURIComponent` is the whole defect class, and
      // a hand-picked example only ever proves the method someone remembered.
      (global.fetch as any).mockResolvedValue(json({}));

      await call(resources());

      expect(lastUrl()).not.toContain('/../');
      expect(lastUrl()).toContain('%2F..%2F');
    });
  });

  describe('pagination becomes a query string, or nothing', () => {
    it.each([
      ['deployments', (r: ReturnType<typeof resources>) => r.deployments.list, '/deployments'],
      ['domains', (r: ReturnType<typeof resources>) => r.domains.list, '/domains'],
      ['tokens', (r: ReturnType<typeof resources>) => r.tokens.list, '/tokens'],
    ])('%s serializes limit and cursor', async (_name, pick, path) => {
      (global.fetch as any).mockResolvedValue(json({ cursor: null }));

      await pick(resources())({ limit: 2, cursor: 'abc123' });

      expect(lastUrl()).toBe(`https://api.test.com${path}?limit=2&cursor=abc123`);
    });

    it.each([
      ['deployments', (r: ReturnType<typeof resources>) => r.deployments.list, '/deployments'],
      ['domains', (r: ReturnType<typeof resources>) => r.domains.list, '/domains'],
      ['tokens', (r: ReturnType<typeof resources>) => r.tokens.list, '/tokens'],
    ])('%s sends no query string when given no options', async (_name, pick, path) => {
      // An empty object and an absent one must both produce a bare path — a
      // trailing `?` is a different URL to a cache and to a log.
      (global.fetch as any).mockResolvedValue(json({ cursor: null }));

      await pick(resources())({});
      expect(lastUrl()).toBe(`https://api.test.com${path}`);

      await pick(resources())();
      expect(lastUrl()).toBe(`https://api.test.com${path}`);
    });
  });

  describe('the deploy endpoint is the transport’s to redirect', () => {
    it('posts to /deployments by default', async () => {
      (global.fetch as any).mockResolvedValue(json({ deployment: 'd1' }));

      await resources().deployments.upload([
        { path: 'index.html', content: Buffer.from('x'), md5: 'a'.repeat(32), size: 1 },
      ] as never);

      expect(lastUrl()).toBe('https://api.test.com/deployments');
    });

    it('honours the @internal deployEndpoint override', async () => {
      // `web/my` and `web/www` target `/upload`, which runs server-side build
      // and SPA detection. The option is transport's; the resource reads it
      // rather than restating either path.
      const api = new ApiHttp({
        apiUrl: 'https://api.test.com',
        getAuthHeaders: () => ({}),
        deployEndpoint: '/upload',
      });
      const deployments = createDeploymentResource({
        getApi: () => api,
        processInput: async (input) => input as unknown as StaticFile[],
      });
      (global.fetch as any).mockResolvedValue(json({ deployment: 'd1' }));

      await deployments.upload([
        { path: 'index.html', content: Buffer.from('x'), md5: 'a'.repeat(32), size: 1 },
      ] as never);

      expect(lastUrl()).toBe('https://api.test.com/upload');
    });
  });
});
