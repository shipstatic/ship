/**
 * @file E2E smoke — the real API, and the suite's contract-drift detector.
 *
 * The mock (`tests/mocks/handler.ts`) is a hand-maintained twin of
 * `cloudflare/api`, kept honest by `// wire:` citations. Between manual
 * alignments, THIS file is what catches drift: it asserts the same contract
 * points the mock encodes — field names, error `type` strings, HTTP statuses
 * — against the deployed API. When one of these fails, the API moved; update
 * the mock (and its citations) in the same change.
 *
 * Scope discipline:
 * - Only calls that leave no durable garbage (deployments are created with a
 *   run-scoped label and removed in cleanup).
 * - No domains (billing implications), no tokens (accumulate without
 *   cleanup), no anonymous deploys (uncredentialed, so cleanup is
 *   impossible; they expire server-side but would linger for days).
 *
 * Structure discipline: each describe owns its setup. The deployment the
 * lifecycle block reads is created in ITS `beforeAll`, so one failed deploy
 * fails that block loudly instead of cascading `undefined` ids through five
 * unrelated-looking failures.
 */

import path from 'node:path';
import { ErrorType, isShipError, type ShipError } from '@shipstatic/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Ship from '../../src/node';
import { CONTRACT, type ContractContext, expected, observe } from '../contract';
import { apiKey } from '../fixtures/builders';
import { E2E_API_KEY, E2E_API_URL, E2E_ENABLED, E2E_TEST_RUN_ID } from '../setup-e2e';

const TEST_SITE_PATH = path.resolve(__dirname, '../fixtures/demo-site');

/** Rejection capture with the type the assertion actually needs. */
async function captureError(promise: Promise<unknown>): Promise<ShipError> {
  const outcome = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  if (!isShipError(outcome)) {
    throw new Error(`Expected a ShipError rejection, got: ${String(outcome)}`);
  }
  return outcome;
}

describe.skipIf(!E2E_ENABLED)('E2E smoke', () => {
  let ship: Ship;
  const deploymentsToCleanup: string[] = [];

  beforeAll(() => {
    ship = new Ship({ token: E2E_API_KEY!, apiUrl: E2E_API_URL });
  });

  afterAll(async () => {
    for (const deploymentId of deploymentsToCleanup) {
      // Cleanup errors are non-fatal — the row may already be gone.
      await ship.deployments.delete(deploymentId).catch(() => {});
    }
  });

  describe('connectivity and limits', () => {
    it('pings the API, which answers the server clock', async () => {
      // `ping()` resolved a boolean until 2026-07-29; reachability is the
      // absence of a throw. This assertion said `toBe(true)` for a day after
      // the wire changed, and nothing noticed — the cost of a tier that is
      // opt-in, and the reason the contract table below exists.
      expect(typeof (await ship.ping()).timestamp).toBe('number');
    });

    it('serves plan limits in the shape the SDK validates against', async () => {
      const limits = await ship.getLimits();
      // Contract point: the three limit fields, all positive numbers —
      // client-side validation is calibrated against exactly these.
      expect(limits.maxFileSize).toBeGreaterThan(0);
      expect(limits.maxFilesCount).toBeGreaterThan(0);
      expect(limits.maxTotalSize).toBeGreaterThan(0);
    });
  });

  describe('account', () => {
    it('returns the account with the fields the CLI formats', async () => {
      const account = await ship.whoami();
      expect(typeof account.email).toBe('string');
      expect(typeof account.plan).toBe('string');
      expect(typeof account.created).toBe('number');
      // `used` is always emitted, possibly null — the CLI renders it as a
      // timestamp, which is why its presence is contract, not trivia.
      expect('used' in account).toBe(true);
    });
  });

  describe('deployment lifecycle', () => {
    let deployed: Awaited<ReturnType<typeof ship.deploy>>;

    beforeAll(async () => {
      // `E2E_TEST_RUN_ID` alone, not decorated. It already opens `e2e-` and
      // already identifies the run, which is its whole job, and it is 17
      // characters of a 25-character rule — so `e2e-smoke-${…}` was 27 and
      // this deploy has been refused CLIENT-SIDE, before any request, for as
      // long as labels have been validated (`LABEL_CONSTRAINTS.MAX_LENGTH`
      // has read 25 since 2026-07-28). Nothing caught it because this tier is
      // opt-in: an unrun suite reports nothing, including about itself.
      deployed = await ship.deploy(TEST_SITE_PATH, {
        labels: [E2E_TEST_RUN_ID],
      });
      deploymentsToCleanup.push(deployed.deployment);
    }, 60000);

    it('creates a deployment carrying the full wire shape', () => {
      // Contract points mirrored by `makeDeployment` in the fixtures: these
      // exact field names, `deployment` (never `id`), numeric timestamps.
      expect(deployed.deployment).toContain('.');
      expect(deployed.url).toBe(`https://${deployed.deployment}`);
      expect(deployed.status).toBe('success');
      expect(deployed.files).toBeGreaterThan(0);
      expect(deployed.size).toBeGreaterThan(0);
      expect(typeof deployed.created).toBe('number');
      expect(deployed.via).toBe('sdk');
      expect('expires' in deployed).toBe(true);
      // Credentialed deploys never carry a claim — the fail-closed invariant.
      expect(deployed.claim).toBeUndefined();
    });

    it('lists in the list contract shape — the collection and its cursor', async () => {
      // Against the REAL API: two fields and nothing else. This is the
      // contract detector for the server half — a list that regrows a field
      // fails here even though every mock in the suite still agrees.
      const result = await ship.deployments.list();
      expect(Object.keys(result).sort()).toEqual(['cursor', 'deployments']);
      expect(Array.isArray(result.deployments)).toBe(true);
      expect(result.deployments.some((d) => d.deployment === deployed.deployment)).toBe(true);
    });

    it('gets the deployment by id', async () => {
      const fetched = await ship.deployments.get(deployed.deployment);
      expect(fetched.deployment).toBe(deployed.deployment);
      expect(fetched.status).toBe('success');
    });

    it('serves the deployed site over HTTP', async () => {
      const response = await fetch(`https://${deployed.deployment}`);
      expect(response.status).toBe(200);
      expect((await response.text()).length).toBeGreaterThan(0);
    });

    it('deletes the deployment; the row survives the transition, marked deleting', async () => {
      // This asserted a typed 404 on the follow-up get, and had done since
      // before deletion became asynchronous. The platform answers 202, marks
      // the row `deleting` and queues the cleanup — the row and the files both
      // outlive the call by however long the queue takes (~26s measured) — so
      // the 404 arrives eventually and never immediately. Three independent
      // statements already said so and only this one line disagreed: the API's
      // own handler (`getDeployment` gates on nothing but existence),
      // `tests/contract.ts` (`deployments.delete` → 202, live), and the
      // acknowledgement law in `@shipstatic/types`. An opt-in tier reports
      // nothing until it is run, including about itself.
      //
      // The transitional state is also the contract worth pinning here, since
      // it is what makes the CLI say "deleting — served until cleanup
      // completes" instead of a completed past tense over a live site.
      const acknowledgement = await ship.deployments.delete(deployed.deployment);
      expect(acknowledgement.status).toBe('deleting');

      const during = await ship.deployments.get(deployed.deployment);
      expect(during.deployment).toBe(deployed.deployment);
      expect(during.status).toBe('deleting');

      // Left in the cleanup list deliberately: the queue owns the removal, and
      // the teardown's delete is idempotent against a row already going.
    });
  });

  describe('the wire contract', () => {
    /**
     * The SAME table `tests/contract.test.ts` runs against the mock
     * (`tests/contract.ts`). This is the half that can say the table matches
     * `cloudflare/api` — the mock half can only say the mock matches the table.
     *
     * Rows the e2e tier must not run carry their reason as a string rather than
     * `live: true`, so the coverage gap is stated in the table instead of being
     * inferred from what this file happens to call.
     */
    const live = CONTRACT.filter((point) => point.live === true);
    let ctx: ContractContext;

    beforeEach(async () => {
      // A fresh deployment per row, matching the mock half — a shared fixture
      // would make row ORDER load-bearing (one row deletes it), which is the
      // kind of coupling that is invisible until it bites.
      const deployment = await ship.deployments.upload(TEST_SITE_PATH, {
        labels: [E2E_TEST_RUN_ID],
      });
      deploymentsToCleanup.push(deployment.deployment);
      ctx = {
        deployment: deployment.deployment,
        missingDeployment: 'no-such-deploy-0000000.shipstatic.com',
        missingDomain: `www.no-such-${E2E_TEST_RUN_ID}.com`,
      };
    });

    it('covers the deployment lifecycle live (the rest is stated as mock-only)', () => {
      expect(live.length).toBeGreaterThan(5);
      expect(live.map((p) => p.name)).toContain('deployments.delete');
    });

    it.each(live.map((point) => [point.name, point] as const))('%s', async (_name, point) => {
      expect(await observe(ship, point, ctx)).toEqual(expected(point));
    });
  });

  describe('error contract', () => {
    it('unknown deployment: not_found type with HTTP 404', async () => {
      const error = await captureError(ship.deployments.get('nonexistent-deployment-zzz9999'));
      expect(error.type).toBe(ErrorType.NotFound);
      expect(error.status).toBe(404);
    });

    it('well-formed but unknown API key: authentication type with HTTP 401', async () => {
      const invalidShip = new Ship({
        token: apiKey('a'),
        apiUrl: E2E_API_URL,
      });
      const error = await captureError(invalidShip.whoami());
      expect(error.type).toBe(ErrorType.Authentication);
      expect(error.status).toBe(401);
    });
  });
});
