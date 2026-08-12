/**
 * @file Subject: the retry loop in `src/shared/api/http.ts`.
 *
 * An aspect file beside the other `http-*` mirrors (recorded in
 * `npm/ship/CLAUDE.md`): retry is one cross-cutting concern over the single
 * wrap point, and it is policy rather than wire truth — which is why it has no
 * `tests/contract.ts` rows. The API is not promising to fail twice; this
 * client is promising what it does when it does.
 *
 * Everything here drives a real `Ship` through an injected `fetch` — a
 * published contract — so the attempt COUNT is observable without reaching
 * inside anything.
 */

import * as path from 'node:path';
import { ErrorType, ShipError } from '@shipstatic/types';
import { describe, expect, it, vi } from 'vitest';
import Ship from '../../../src/node/index';
import { apiKey } from '../../fixtures/builders';

const API = 'https://api.test.example';
const DEMO_SITE = path.resolve(__dirname, '../../fixtures/demo-site');

/** A JSON response, the way the API sends one. */
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** An error response in the platform's own envelope. */
const fail = (error: ShipError) => ok(error.toResponse(), error.status ?? 500);

const newShip = (fetchImpl: unknown, options: Record<string, unknown> = {}) =>
  new Ship({
    apiUrl: API,
    token: apiKey('a'),
    // Retries are the subject; the platform-limits fetch is not, so keep it
    // from being the first thing every case has to think about.
    fetch: fetchImpl as never,
    ...options,
  });

/** Answers `/limits` (the lazy init call), then runs the script for the rest. */
const scripted = (responses: Array<() => Response | Promise<Response>>) => {
  let call = 0;
  return vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith('/limits')) return ok({ maxFileSize: 1, maxFilesCount: 1 });
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return next();
  });
};

/** How many non-`/limits` calls actually went out. */
const attempts = (mock: ReturnType<typeof scripted>) =>
  mock.mock.calls.filter(([url]) => !String(url).endsWith('/limits')).length;

describe('retries', () => {
  it('rides out a transient 500 and returns the answer', async () => {
    const fetchImpl = scripted([
      () => fail(ShipError.api('upstream hiccup', 500)),
      () => ok({ timestamp: 123 }),
    ]);
    const ship = newShip(fetchImpl);

    await expect(ship.ping()).resolves.toEqual({ timestamp: 123 });
    expect(attempts(fetchImpl)).toBe(2);
  });

  it('rides out a transport failure', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/limits')) return ok({ maxFileSize: 1, maxFilesCount: 1 });
      call += 1;
      if (call === 1) throw new TypeError('Load failed'); // the WebKit shape
      return ok({ timestamp: 7 });
    });

    await expect(newShip(fetchImpl).ping()).resolves.toEqual({ timestamp: 7 });
    expect(call).toBe(2);
  });

  it('gives up after maxRetries and reports the last failure', async () => {
    const fetchImpl = scripted([() => fail(ShipError.api('still broken', 503))]);

    await expect(newShip(fetchImpl).ping()).rejects.toMatchObject({ status: 503 });
    expect(attempts(fetchImpl)).toBe(3); // the attempt plus two retries
  });

  it('maxRetries: 0 disables retrying entirely', async () => {
    const fetchImpl = scripted([() => fail(ShipError.api('broken', 500))]);

    await expect(newShip(fetchImpl, { maxRetries: 0 }).ping()).rejects.toThrow();
    expect(attempts(fetchImpl)).toBe(1);
  });

  it('does NOT retry a maintenance 503 — it is a state, not a fault', async () => {
    // The load-bearing exception. A maintenance message says when to come
    // back; retrying it three times with backoff only delays that sentence
    // reaching the person who needs it. Same STATUS as the retryable 503
    // above, which is exactly why the check reads the type.
    const fetchImpl = scripted([() => fail(ShipError.maintenance('Back at 14:30 UTC.'))]);

    await expect(newShip(fetchImpl).ping()).rejects.toMatchObject({
      type: ErrorType.Maintenance,
    });
    expect(attempts(fetchImpl)).toBe(1);
  });

  it('does NOT retry a 429 — the rate limiter has just answered', async () => {
    const fetchImpl = scripted([() => fail(ShipError.rateLimit())]);

    await expect(newShip(fetchImpl).ping()).rejects.toMatchObject({ status: 429 });
    expect(attempts(fetchImpl)).toBe(1);
  });

  it('does NOT retry a 4xx the caller has to fix', async () => {
    const fetchImpl = scripted([() => fail(ShipError.validation('bad label'))]);

    await expect(newShip(fetchImpl).ping()).rejects.toMatchObject({ status: 400 });
    expect(attempts(fetchImpl)).toBe(1);
  });

  it('does NOT retry a DELETE, whose repeat would misreport a success', async () => {
    // Semantically idempotent and still excluded: a DELETE whose response was
    // lost answers 404 on the retry, turning a success into a failure.
    const fetchImpl = scripted([() => fail(ShipError.api('gateway', 502))]);

    await expect(newShip(fetchImpl).deployments.delete('brave-otter-a1b2c3d')).rejects.toThrow();
    expect(attempts(fetchImpl)).toBe(1);
  });

  it('does NOT retry a PUT', async () => {
    const fetchImpl = scripted([() => fail(ShipError.api('gateway', 502))]);

    await expect(newShip(fetchImpl).domains.set('www.example.com')).rejects.toThrow();
    expect(attempts(fetchImpl)).toBe(1);
  });

  /**
   * The deploy is the only call that carries a caller `signal`, and — with a
   * key — the only non-GET that may be repeated at all. So these three drive
   * the real deploy path rather than a stand-in.
   */
  describe('a deploy, which is where a signal and a key actually reach', () => {
    /** `/limits` and `/spa-check` answer; the deploy POST runs the script. */
    const deployFetch = (onDeploy: (n: number) => Response | Promise<Response>) => {
      let posts = 0;
      const mock = vi.fn(async (url: string | URL | Request) => {
        const href = String(url);
        if (href.endsWith('/limits')) return ok({ maxFileSize: 1e9, maxFilesCount: 100 });
        if (href.endsWith('/spa-check')) return ok({ isSPA: false });
        posts += 1;
        return onDeploy(posts);
      });
      return Object.assign(mock, { posts: () => posts });
    };

    it('retries a deploy that carries an Idempotency-Key, and the replay wins', async () => {
      // Safe by construction rather than by assumption: the stored 201 replays,
      // so the retry cannot create a second deployment.
      const deployed = { deployment: 'brave-otter-a1b2c3d.shipstatic.com', url: 'https://x' };
      const fetchImpl = deployFetch((n) =>
        n === 1 ? fail(ShipError.api('gateway', 502)) : ok(deployed, 201),
      );

      await expect(
        newShip(fetchImpl).deploy(DEMO_SITE, { idempotencyKey: 'run-1-deploy' }),
      ).resolves.toMatchObject({ deployment: deployed.deployment });
      expect(fetchImpl.posts()).toBe(2);
    });

    it('does NOT retry a deploy without a key — it could deploy twice', async () => {
      const fetchImpl = deployFetch(() => fail(ShipError.api('gateway', 502)));

      await expect(newShip(fetchImpl).deploy(DEMO_SITE)).rejects.toThrow();
      expect(fetchImpl.posts()).toBe(1);
    });

    it("a caller's abort ends the loop rather than being retried through", async () => {
      // The retryable failure is a 502, so without the signal this deploy
      // would go out three times. It goes out once.
      //
      // The reported error is the one that actually happened, not a
      // manufactured "cancelled": the attempt really did fail that way, and
      // the signal's job is to stop the LOOP. What the signal must never do is
      // be retried through — a caller who said stop, and a client that keeps
      // going, is the failure this guard exists for.
      const controller = new AbortController();
      controller.abort();
      const fetchImpl = deployFetch(() => fail(ShipError.api('gateway', 502)));

      const started = Date.now();
      await expect(
        newShip(fetchImpl).deploy(DEMO_SITE, {
          idempotencyKey: 'run-2-deploy',
          signal: controller.signal,
        }),
      ).rejects.toThrow();

      expect(fetchImpl.posts()).toBe(1);
      // No backoff was waited out on the way to giving up.
      expect(Date.now() - started).toBeLessThan(250);
    });

    it("does not retry past a caller's own deadline, though a deadline IS Network", async () => {
      // The subtle one, and the reason `isRetryable` reads the caller's signal
      // rather than only the error type: a caller's `AbortSignal.timeout()`
      // classifies as `Network` (a deadline exchanged nothing), so on type
      // alone it would look retryable and silently outlive the ceiling that
      // caller set.
      const controller = new AbortController();
      const fetchImpl = deployFetch(() => {
        controller.abort(new DOMException('Timed out', 'TimeoutError'));
        throw controller.signal.reason;
      });

      await expect(
        newShip(fetchImpl).deploy(DEMO_SITE, {
          idempotencyKey: 'run-3-deploy',
          signal: controller.signal,
        }),
      ).rejects.toThrow();
      expect(fetchImpl.posts()).toBe(1);
    });
  });
});
