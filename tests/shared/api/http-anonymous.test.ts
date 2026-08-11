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

    expect(result.claim).toMatch(/^https:\/\/my\.shipstatic\.com\/claims\//);
    expect(result.expires).toBeGreaterThan(result.created);
  });

  it('carries no claim on a credentialed deploy', async () => {
    const ship = new Ship({ apiUrl: getMockServerUrl(), token: API_KEY });
    const result = await ship.deploy(site);

    expect(result.claim).toBeUndefined();
  });
});
