/**
 * `ship.getLimits()` and the deploy pipeline's limits: asked of the server
 * every time they are used, and never held.
 *
 * Limits are the account's policy, and a plan move or an operator's grant
 * changes them while a client lives on (a browser tab holds one for hours).
 * What only a server that changes its answer between calls can show is that
 * each read meets the limits stated NOW: the resolved values of a stale read
 * and a fresh one are otherwise identical, so the rows count requests and
 * change the server's answer mid-test.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Ship as NodeShip } from '../../src/node/index';
import { Ship as BrowserShip } from '../../src/shared/index';
import type { ShipClientOptions } from '../../src/shared/types';
import { deployToken, FREE_PLAN_LIMITS } from '../fixtures/builders';
import { type Answer, fakeApi } from '../mocks/fetch';

const DEMO_SITE = path.resolve(__dirname, '../fixtures/demo-site');
const MB = 1024 * 1024;

/** A client and the server it talks to. */
function client(
  answers: Record<string, Answer> = {},
  options: ShipClientOptions = {},
  Ship: typeof BrowserShip = NodeShip,
) {
  const api = fakeApi({ '/limits': FREE_PLAN_LIMITS, ...answers });
  const ship = new Ship({
    token: deployToken('a'),
    apiUrl: 'https://api.test',
    fetch: api.fetch,
    ...options,
  });
  return { ship, api };
}

describe('platform limits: asked every time, never held', () => {
  it.each([
    ['node', NodeShip],
    ['browser', BrowserShip],
  ] as const)(
    'getLimits() in %s answers what the server states now, one request each',
    async (_runtime, Ship) => {
      const { ship, api } = client(
        { '/limits': { ...FREE_PLAN_LIMITS, maxFileSize: 20 * MB } },
        {},
        Ship,
      );

      expect((await ship.getLimits()).maxFileSize).toBe(20 * MB);
      // The plan moved on the server: the next read sees it.
      api.answer('/limits', { ...FREE_PLAN_LIMITS, maxFileSize: 50 * MB });
      expect((await ship.getLimits()).maxFileSize).toBe(50 * MB);
      expect(api.sentTo('/limits')).toHaveLength(2);
    },
  );

  it('a deploy reads the limits once, at its start, and validates against them', async () => {
    const { ship, api } = client({ '/limits': { ...FREE_PLAN_LIMITS, maxFileSize: 1 } });

    // A one-byte ceiling refuses the site before anything is sent.
    await expect(ship.deploy(DEMO_SITE)).rejects.toThrow();
    expect(api.sentTo('/deployments')).toHaveLength(0);

    // The ceiling is raised on the server; the next deploy reads it.
    api.answer('/limits', FREE_PLAN_LIMITS);
    await ship.deploy(DEMO_SITE);
    expect(api.sentTo('/deployments')).toHaveLength(1);
    expect(api.sentTo('/limits')).toHaveLength(2);
  });

  it('a failed read fails only its own call, and the next call asks again', async () => {
    let first = true;
    const { ship, api } = client(
      {
        '/limits': () => {
          if (first) {
            first = false;
            throw new Error('network down');
          }
          return FREE_PLAN_LIMITS;
        },
      },
      // One attempt per call, so the second request is the second call's.
      { maxRetries: 0 },
    );

    await expect(ship.getLimits()).rejects.toThrow('network down');
    expect(await ship.getLimits()).toEqual(FREE_PLAN_LIMITS);
    expect(api.sentTo('/limits')).toHaveLength(2);
  });

  describe('the limits fetch is earned, not automatic', () => {
    it.each([
      ['domains.list()', (s: BrowserShip) => s.domains.list()],
      ['tokens.list()', (s: BrowserShip) => s.tokens.list()],
      ['deployments.list()', (s: BrowserShip) => s.deployments.list()],
      ['ping()', (s: BrowserShip) => s.ping()],
    ])('%s issues ONE request, and it is not /limits', async (_label, call) => {
      const { ship, api } = client();

      await call(ship);

      expect(api.sent).toHaveLength(1);
      expect(api.sentTo('/limits')).toEqual([]);
    });

    it('still fetches limits for a deploy, because the deploy reads them', async () => {
      // The other half: this is not "stop fetching limits", it is "fetch
      // them where they are consumed". A deploy validates against the
      // plan caps and the delivered blocklist, so it pays the request.
      const { ship, api } = client();

      await ship.deploy(DEMO_SITE);

      expect(api.sentTo('/limits')).toHaveLength(1);
    });

    it('a deploy that sends a project to be built asks for none: no limit judges a source', async () => {
      const { ship, api } = client();

      await ship.deploy([new File(['{}'], 'package.json')], { build: true });

      expect(api.sent.map((request) => request.path)).toEqual(['/deployments']);
    });

    it('getLimits() still fetches when asked directly', async () => {
      const { ship, api } = client();

      expect(await ship.getLimits()).toEqual(FREE_PLAN_LIMITS);
      expect(api.sent.map((request) => request.path)).toEqual(['/limits']);
    });
  });
});
