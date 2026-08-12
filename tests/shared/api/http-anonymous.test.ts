/**
 * @file Anonymous deploy claim contract.
 *
 * The claim URL is the centerpiece of the anonymous story: a credential-less
 * deploy lands under the public account, expires, and carries the URL that
 * converts it into a kept deployment. These fences pin the response contract
 * through the SDK end-to-end — anonymous deploys carry `claim` + `expires`,
 * credentialed deploys carry neither.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErrorType, isShipError } from '@shipstatic/types';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Ship from '../../../src/node';
import { apiKey } from '../../fixtures/builders';
import { getMockServerUrl, resetMockServer } from '../../mocks/server';

const API_KEY = apiKey('a');

const site = mkdtempSync(join(tmpdir(), 'ship-claim-test-'));
writeFileSync(join(site, 'index.html'), '<html>claim me</html>');

afterAll(() => rmSync(site, { recursive: true, force: true }));

describe('Anonymous deploy claim contract', () => {
  beforeEach(() => {
    resetMockServer();
    // Anonymity requires proven absence of credentials — keep the host's
    // SHIP_TOKEN out of the in-process constructor ('' = absence).
    vi.stubEnv('SHIP_TOKEN', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('carries the claim URL and expiry on an anonymous deploy', async () => {
    const ship = new Ship({ apiUrl: getMockServerUrl() });
    const result = await ship.deploy(site);

    expect(result.claim).toMatch(/^https:\/\/my\.shipstatic\.com\/claim\//);
    expect(result.expires).toBeGreaterThan(result.created);
  });

  it('carries no claim on a credentialed deploy', async () => {
    const ship = new Ship({ apiUrl: getMockServerUrl(), token: API_KEY });
    const result = await ship.deploy(site);

    expect(result.claim).toBeUndefined();
  });

  /**
   * A requested lifetime needs a deployer, and this is where the wire fact is
   * proven — `tests/contract.ts` cannot hold it, because a runner supplies ONE
   * client and every row runs against it, so a point about what happens
   * WITHOUT a credential would need a second runner rather than another row.
   * The anonymous client already lives here.
   */
  it('refuses a requested lifetime, typed, so the CLI can relay it', async () => {
    // Anonymity has no deployer, and the platform owns the anonymous window as
    // policy: the claim code's TTL is pinned to it, so a shorter deployment
    // would hand out a claim link outliving the thing it claims.
    const ship = new Ship({ apiUrl: getMockServerUrl() });
    const error = await ship.deploy(site, { ttl: 3600 }).catch((e) => e);

    expect(isShipError(error)).toBe(true);
    // Branch on the TYPE. Forbidden rather than Validation: the request is
    // well-formed and the identity IS resolved — it simply may not do this.
    expect(error.type).toBe(ErrorType.Forbidden);
    expect(error.status).toBe(403);
    expect(error.message).toMatch(/requires a credential/);
  });

  it('honours the same lifetime once a credential is present', async () => {
    // The pair that proves the refusal is about the CREDENTIAL and not about
    // the flag: identical call, one header different.
    const ship = new Ship({ apiUrl: getMockServerUrl(), token: API_KEY });
    const result = await ship.deploy(site, { ttl: 3600 });

    expect(result.expires).toBe(result.created + 3600);
    expect(result.claim).toBeUndefined();
  });
});
