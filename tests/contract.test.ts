/**
 * @file The contract table, run against the MOCK. Runs in CI.
 *
 * Its twin is the `contract` block in `tests/e2e/smoke.e2e.test.ts`, which runs
 * the SAME table against the real API. Neither file states a contract point:
 * both import `tests/contract.ts`, which is the only place they are written.
 *
 * What this half proves and what it cannot: it proves the mock encodes the
 * table, so ~1000 tests are running against the behaviour the table describes.
 * It cannot prove the table matches `cloudflare/api` — only the live half can,
 * and only when someone runs it. That division is the honest one, and it is
 * why the mock-only rows carry their reason as a string rather than a boolean.
 */

import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import Ship from '../src/node';
import { CONTRACT, type ContractContext, expected, observe } from './contract';
import { getMockServerUrl } from './mocks/server';

const API_KEY = `ship-${'a'.repeat(64)}`;
/** The same fixture the e2e half deploys, so both halves upload like a user. */
const DEMO_SITE = path.resolve(__dirname, './fixtures/demo-site');

let ship: Ship;
let ctx: ContractContext;

// Per TEST, not per file: `setup-server.ts` resets the mock's state after each
// one (that isolation is what makes file parallelism safe), so fixtures built
// once would vanish before the second row ran. It also means a row that
// deletes its fixture cannot disturb the next.
beforeEach(async () => {
  ship = new Ship({ apiUrl: getMockServerUrl(), token: API_KEY });
  // Warm the lazy `/limits` fetch so it cannot be the last response event.
  await ship.getLimits();

  const deployment = await ship.deployments.upload(DEMO_SITE);
  const domain = await ship.domains.set('www.contract-fixture.com');
  const token = await ship.tokens.create({});

  ctx = {
    deployment: deployment.deployment,
    missingDeployment: 'no-such-deploy-0000000.shipstatic.com',
    domain: domain.domain,
    missingDomain: 'www.contract-absent.com',
    token: token.token,
  };
});

describe('the wire contract, against the mock', () => {
  it('states every point exactly once (a table nobody reads proves nothing)', () => {
    expect(CONTRACT.length).toBeGreaterThan(20);
    expect(new Set(CONTRACT.map((p) => p.name)).size).toBe(CONTRACT.length);
  });

  it.each(CONTRACT.map((point) => [point.name, point] as const))('%s', async (_name, point) => {
    expect(await observe(ship, point, ctx)).toEqual(expected(point));
  });

  it('says which points the real API never verifies, and why', () => {
    // Not a coverage complaint — a disclosure. The e2e tier has never touched
    // domains or tokens, and until this table existed nobody could tell which
    // contract points that left unverified against the real thing.
    const mockOnly = CONTRACT.filter((p) => p.live !== true);
    for (const point of mockOnly) {
      expect(typeof point.live, `${point.name} must say WHY it is mock-only`).toBe('string');
    }
    // The deployment lifecycle — the operations every client performs — is
    // verified live. If that stops being true, this is the assertion to read.
    const live = CONTRACT.filter((p) => p.live === true).map((p) => p.name);
    expect(live).toContain('deployments.delete');
    expect(live).toContain('deployments.get');
    expect(live).toContain('ping');
  });
});
