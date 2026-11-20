/**
 * @file Subject: `src/shared/ship.ts`, the Ship class every runtime
 * runs. Owns credential state, the per-deploy `/limits` read, the
 * resource factories, and the `deploy`/`whoami` shortcuts.
 *
 * Every row builds a real client on an injected `fetch` and reads the
 * requests that left it: the `fetch` option is a published contract
 * (`ShipClientOptions.fetch`), and nothing global is replaced for other
 * files to trip over.
 */

import type { PingResponse } from '@shipstatic/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Ship } from '../../src/shared/ship';
import type { Fetch } from '../../src/shared/types';
import { apiKey, FREE_PLAN_LIMITS } from '../fixtures/builders';
import { fakeApi } from '../mocks/fetch';

/** An API key in the platform's canonical shape, built from its constants. */
const TEST_API_KEY = apiKey('a');
const API_URL = 'http://localhost:13579';

const PAGE = '<html><body><div id="root"></div></body></html>';
const site = () => [new File([PAGE], 'index.html')];

const DEPLOYED = {
  deployment: 'brave-otter-a1b2c3d.shipstatic.com',
  url: 'https://brave-otter-a1b2c3d.shipstatic.com',
};

describe('The Ship class', () => {
  let api: ReturnType<typeof fakeApi>;
  let ship: Ship;

  beforeEach(() => {
    api = fakeApi({
      '/limits': FREE_PLAN_LIMITS,
      '/deployments': DEPLOYED,
      '/ping': { timestamp: 1_700_000_000 } satisfies PingResponse,
      '/account': { email: 'test@example.com' },
    });
    ship = new Ship({ apiUrl: API_URL, token: TEST_API_KEY, fetch: api.fetch });
  });

  describe('deploy convenience method', () => {
    it('should call deployments.upload with input and options', async () => {
      const result = await ship.deploy(site(), { labels: ['audit'] });

      expect(result).toEqual(DEPLOYED);
      const [deploy] = api.sentTo('/deployments');
      expect((deploy.body as FormData).get('labels')).toBe('["audit"]');
    });
  });

  describe("a deploy's input, where there is no filesystem", () => {
    it('sends Files under their names, judged by the limits it read once', async () => {
      await ship.deploy([new File([PAGE], 'index.html'), new File(['body {}'], 'css/app.css')]);

      expect(api.sentTo('/limits')).toHaveLength(1);
      const body = api.sentTo('/deployments')[0].body as FormData;
      expect((body.getAll('files[]') as File[]).map((file) => file.name)).toEqual([
        'index.html',
        'css/app.css',
      ]);
    });

    it.each([
      ['a path', '/path/to/site'],
      ['a list of paths', ['/path/to/site']],
    ])('refuses %s in words, with no request', async (_what, input) => {
      await expect(ship.deploy(input)).rejects.toThrow(
        'A deploy takes File objects here. Publishing from a path needs Node.js, Bun or Deno.',
      );
      expect(api.sent).toEqual([]);
    });

    it.each([
      // The commonest wrong input in a browser: `input.files` is no array.
      [
        "a file input's FileList",
        { 0: new File(['x'], 'index.html'), length: 1, item: () => null },
      ],
      ['a list that mixes Files and paths', [new File(['x'], 'index.html'), './dist']],
      ['nothing', undefined],
    ])('tells %s how to become a list, and says nothing of paths', async (_what, input) => {
      await expect(ship.deploy(input as any)).rejects.toThrow(
        'A deploy takes a list of File objects. To publish the files of a file input, pass Array.from(input.files).',
      );
      expect(api.sent).toEqual([]);
    });
  });

  describe('whoami convenience method', () => {
    it('should call account.get', async () => {
      const result = await ship.whoami();

      expect(result).toEqual({ email: 'test@example.com' });
      expect(api.sentTo('/account')).toHaveLength(1);
    });
  });

  describe('ping method', () => {
    it('reaches /ping, and resolves the server clock', async () => {
      const result = await ship.ping();

      expect(result).toEqual({ timestamp: 1_700_000_000 });
      expect(api.sentTo('/ping')).toHaveLength(1);
    });
  });

  describe('resource getters', () => {
    it('should provide access to all resources', () => {
      expect(typeof ship.deployments.upload).toBe('function');
      expect(typeof ship.deployments.list).toBe('function');
      expect(typeof ship.deployments.get).toBe('function');
      expect(typeof ship.deployments.set).toBe('function');
      expect(typeof ship.deployments.delete).toBe('function');

      expect(typeof ship.domains.set).toBe('function');
      expect(typeof ship.domains.get).toBe('function');
      expect(typeof ship.domains.list).toBe('function');
      expect(typeof ship.domains.delete).toBe('function');
      expect(typeof ship.domains.verify).toBe('function');

      expect(typeof ship.account.get).toBe('function');
    });
  });

  describe('the requests of a deploy', () => {
    it('reads limits before the deploy, and makes no other request', async () => {
      // Why the order is load-bearing: the deploy body is size-validated
      // against the limits, so a deploy that raced ahead of `/limits` would
      // validate against nothing. The single-page question rides the deploy.
      await ship.deployments.upload(site());

      expect(api.sent.map((request) => request.path)).toEqual(['/limits', '/deployments']);
    });

    it('sends every call to the configured apiUrl, never the default', async () => {
      await ship.deployments.upload(site());

      expect(api.sent.map((request) => new URL(request.url).origin)).toEqual([API_URL, API_URL]);
    });

    it('takes an origin with a slash at its end as the same origin', async () => {
      const slashed = new Ship({ apiUrl: `${API_URL}/`, fetch: api.fetch });

      await slashed.ping();

      expect(api.sent[0].url).toBe(`${API_URL}/ping`);
    });

    it('reads limits once per call that uses them, and holds none between calls', async () => {
      await ship.getLimits();
      await ship.getLimits();
      await ship.deployments.upload(site());

      expect(api.sentTo('/limits')).toHaveLength(3);
    });
  });

  /**
   * Cancel stops a deploy wherever it is. A deploy is two requests (the
   * limits it validates against, the upload itself), and the caller's one
   * signal must reach each: a stop that only reached the last left the form
   * busy while the first ran.
   */
  describe('cancellation reaches every request of a deploy', () => {
    /** Answers every path, except one it holds open until its signal aborts. */
    function holdingFetch(held: string) {
      const paths: string[] = [];
      let heldSignal: AbortSignal | undefined;
      let reached: () => void = () => {};
      const arrived = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const fetch = vi.fn(async (url: string, init?: RequestInit) => {
        const { pathname } = new URL(url);
        paths.push(pathname);
        if (pathname === held) {
          heldSignal = init?.signal ?? undefined;
          reached();
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted.', 'AbortError')),
            );
          });
        }
        return Response.json(pathname === '/limits' ? FREE_PLAN_LIMITS : DEPLOYED);
      }) as unknown as Fetch;
      return { fetch, paths, arrived, heldSignal: () => heldSignal };
    }

    it.each([
      ['/limits', ['/limits']],
      ['/deployments', ['/limits', '/deployments']],
    ])(
      'a stop while %s is in flight cancels it, and sends nothing after it',
      async (held, sent) => {
        const { fetch, paths, arrived, heldSignal } = holdingFetch(held);
        const client = new Ship({ apiUrl: API_URL, token: TEST_API_KEY, fetch });
        const controller = new AbortController();

        const upload = client.deployments.upload(site(), { signal: controller.signal });
        await arrived;
        controller.abort();

        await expect(upload).rejects.toMatchObject({ type: 'operation_cancelled' });
        expect(heldSignal()?.aborted).toBe(true);
        expect(paths).toEqual(sent);
      },
    );
  });
});
