/**
 * `ship.getLimits()` and the deploy pipeline's limits: asked of the server
 * every time they are used, and never held.
 *
 * Limits are the account's policy, and a plan move or an operator's grant
 * changes them while a client lives on (a browser tab holds one for hours).
 * What only a server that changes its answer between calls can show is that
 * each read meets the limits stated NOW: the resolved values of a stale read
 * and a fresh one are otherwise identical, so the rows count requests and
 * change the transport's answer mid-test.
 */

import path from 'node:path';
import type { PlatformLimits } from '@shipstatic/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Ship as BrowserShip } from '../../src/browser/index';
import { Ship as NodeShip } from '../../src/node/index';
import { __setTestEnvironment } from '../../src/shared/lib/env';
import { deployToken, FREE_PLAN_LIMITS } from '../fixtures/builders';
import { fakeTransport } from '../mocks/transport';

const DEMO_SITE = path.resolve(__dirname, '../fixtures/demo-site');
const TEST_DEPLOY_TOKEN = deployToken('a');
const mockLimits: PlatformLimits = FREE_PLAN_LIMITS;
const MB = 1024 * 1024;

describe('platform limits: asked every time, never held', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['node', () => new NodeShip({ token: TEST_DEPLOY_TOKEN })],
    ['browser', () => new BrowserShip({ token: TEST_DEPLOY_TOKEN })],
  ] as const)(
    'getLimits() in %s answers what the server states now, one request each',
    async (env, make) => {
      __setTestEnvironment(env);
      const ship = make();
      const transport = fakeTransport({ 'Get limits': { ...mockLimits, maxFileSize: 20 * MB } });
      (ship as any).http = transport;

      expect((await ship.getLimits()).maxFileSize).toBe(20 * MB);
      // The plan moved on the server: the next read sees it.
      transport.answer('Get limits', { ...mockLimits, maxFileSize: 50 * MB });
      expect((await ship.getLimits()).maxFileSize).toBe(50 * MB);
      expect(transport.carriedFor('Get limits')).toHaveLength(2);
    },
  );

  it('a deploy reads the limits once, at its start, and validates against them', async () => {
    __setTestEnvironment('node');
    const ship = new NodeShip({ token: TEST_DEPLOY_TOKEN });
    const transport = fakeTransport({
      'Get limits': { ...mockLimits, maxFileSize: 1 },
      Deploy: { deployment: 'dep_123', url: 'https://dep_123.shipstatic.com' },
    });
    (ship as any).http = transport;

    // A one-byte ceiling refuses the site before anything is sent.
    await expect(ship.deploy(DEMO_SITE)).rejects.toThrow();
    expect(transport.carriedFor('Deploy')).toHaveLength(0);

    // The ceiling is raised on the server; the next deploy reads it.
    transport.answer('Get limits', mockLimits);
    await ship.deploy(DEMO_SITE);
    expect(transport.carriedFor('Deploy')).toHaveLength(1);
    expect(transport.carriedFor('Get limits')).toHaveLength(2);
  });

  it('a failed read fails only its own call, and the next call asks again', async () => {
    __setTestEnvironment('node');
    const ship = new NodeShip({ token: TEST_DEPLOY_TOKEN });
    let first = true;
    const transport = fakeTransport({
      'Get limits': () => {
        if (first) {
          first = false;
          throw new Error('network down');
        }
        return mockLimits;
      },
    });
    (ship as any).http = transport;

    await expect(ship.getLimits()).rejects.toThrow('network down');
    expect(await ship.getLimits()).toEqual(mockLimits);
    expect(transport.carriedFor('Get limits')).toHaveLength(2);
  });

  describe('the limits fetch is earned, not automatic', () => {
    const jsonFetch = () => {
      const paths: string[] = [];
      const fetchImpl = vi.fn(async (url: string) => {
        paths.push(new URL(url).pathname);
        return new Response(
          JSON.stringify({
            ...mockLimits,
            deployments: [],
            domains: [],
            tokens: [],
            cursor: null,
            timestamp: 1,
            deployment: 'mock-deploy-001.shipstatic.com',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });
      return { paths, fetchImpl };
    };

    it.each([
      ['domains.list()', (s: NodeShip) => s.domains.list()],
      ['tokens.list()', (s: NodeShip) => s.tokens.list()],
      ['deployments.list()', (s: NodeShip) => s.deployments.list()],
      ['ping()', (s: NodeShip) => s.ping()],
    ])('%s issues ONE request, and it is not /limits', async (_label, call) => {
      const { paths, fetchImpl } = jsonFetch();
      const ship = new NodeShip({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.test',
        fetch: fetchImpl as unknown as typeof fetch,
      });

      await call(ship);

      expect(paths).toHaveLength(1);
      expect(paths).not.toContain('/limits');
    });

    it('still fetches limits for a deploy, because the deploy reads them', async () => {
      // The other half: this is not "stop fetching limits", it is "fetch
      // them where they are consumed". A deploy validates against the
      // plan caps and the delivered blocklist, so it pays the request.
      const { paths, fetchImpl } = jsonFetch();
      const ship = new NodeShip({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.test',
        fetch: fetchImpl as unknown as typeof fetch,
      });

      await ship.deploy(DEMO_SITE);

      expect(paths).toContain('/limits');
    });

    it('getLimits() still fetches when asked directly', async () => {
      const { paths, fetchImpl } = jsonFetch();
      const ship = new NodeShip({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.test',
        fetch: fetchImpl as unknown as typeof fetch,
      });

      expect(await ship.getLimits()).toMatchObject(mockLimits);
      expect(paths).toEqual(['/limits']);
    });
  });
});
