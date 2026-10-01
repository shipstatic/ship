/**
 * @file Subject: `src/shared/base-ship.ts` — the abstract Ship both platform
 * entries extend. Owns credential state, the per-deploy `/limits` read, the
 * resource factories, and the `deploy`/`whoami` shortcuts.
 *
 * The ordering block absorbs `mixed-core/initialization-order.test.ts`. It runs
 * the REAL `ApiHttp` against an injected `fetch` rather than reassigning
 * `globalThis.fetch`: the `fetch` option is a published contract
 * (`ShipClientOptions.fetch`), so the test dogfoods it, and nothing global is
 * mutated for other files to trip over.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Ship } from '../../src/shared/base-ship';
import type { DeployInput, DeploymentOptions, Fetch, StaticFile } from '../../src/shared/types';
import { apiKey } from '../fixtures/builders';
import { type FakeTransport, fakeTransport } from '../mocks/transport';

/** An API key in the platform's canonical shape, built from its constants. */
const TEST_API_KEY = apiKey('a');

const INDEX_HTML: StaticFile = {
  path: 'index.html',
  content: Buffer.from('<html><body><div id="root"></div></body></html>'),
  size: 47,
  md5: 'test-hash',
};

class TestShip extends Ship {
  protected async processInput(
    _input: DeployInput,
    _options: DeploymentOptions,
  ): Promise<StaticFile[]> {
    return [INDEX_HTML];
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('Base Ship Class (Abstract)', () => {
  let ship: TestShip;
  let mockApiDeploy: ReturnType<typeof vi.fn>;
  let transport: FakeTransport;

  beforeEach(() => {
    mockApiDeploy = vi.fn().mockResolvedValue({
      deployment: 'brave-otter-a1b2c3d.shipstatic.com',
      url: 'https://brave-otter-a1b2c3d.shipstatic.com',
    });

    ship = new TestShip({ apiUrl: 'https://test-api.com', token: TEST_API_KEY });

    // Only the operations this file's subject actually reaches. Keying on the
    // operation NAME rather than on endpoint methods is what keeps the double
    // honest: an earlier revision listed `listApiKeys`/`removeApiKey`/`get` —
    // methods from removed eras — which no assertion could ever have caught.
    transport = fakeTransport({
      Deploy: mockApiDeploy,
      Ping: { success: true, timestamp: 1_700_000_000 },
      'Get limits': {},
      'SPA check': { isSPA: false },
      'List deployments': { deployments: [], cursor: null },
      'Get deployment': { deployment: 'brave-otter-a1b2c3d' },
      'Get account': { email: 'test@example.com' },
    });
    (ship as any).http = transport;
  });

  describe('constructor', () => {
    it('should initialize with provided options', () => {
      const options = { apiUrl: 'https://custom-api.com', token: 'test-key' };
      const testShip = new TestShip(options);

      expect((testShip as any).clientOptions).toEqual(options);
    });

    it('should create resource instances', () => {
      expect(ship.deployments).toBeDefined();
      expect(ship.domains).toBeDefined();
      expect(ship.account).toBeDefined();
    });
  });

  describe('deploy convenience method', () => {
    it('should call deployments.upload with input and options', async () => {
      const result = await ship.deploy(['./test'] as any, { labels: ['audit'] });

      expect(result).toEqual({
        deployment: 'brave-otter-a1b2c3d.shipstatic.com',
        url: 'https://brave-otter-a1b2c3d.shipstatic.com',
      });
      expect(transport.carriedFor('Deploy')).toHaveLength(1);
    });
  });

  describe('whoami convenience method', () => {
    it('should call account.get', async () => {
      const result = await ship.whoami();

      expect(result).toEqual({ email: 'test@example.com' });
      expect(transport.carriedFor('Get account')).toHaveLength(1);
    });
  });

  describe('ping method', () => {
    it('reaches /ping, and resolves the answer rather than a boolean', async () => {
      const result = await ship.ping();

      expect(result).toEqual({ success: true, timestamp: 1_700_000_000 });
      expect(transport.carriedFor('Ping')).toHaveLength(1);
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

  describe('initialization order (real transport, injected fetch)', () => {
    /** Records every path the SDK requests, in order, and answers each. */
    function recordingFetch(): { fetch: Fetch; paths: string[]; urls: string[] } {
      const paths: string[] = [];
      const urls: string[] = [];
      const fetch = vi.fn(async (input: any) => {
        const url = typeof input === 'string' ? input : input.url;
        urls.push(url);
        const { pathname } = new URL(url);
        paths.push(pathname);

        if (pathname === '/limits') {
          return json({ maxFileSize: 20971520, maxFilesCount: 500, maxTotalSize: 52428800 });
        }
        if (pathname === '/spa-check') {
          return json({ isSPA: true, debug: { tier: 'inclusions', reason: 'root mount' } });
        }
        if (pathname === '/deployments') {
          return json({
            deployment: 'brave-otter-a1b2c3d.shipstatic.com',
            url: 'https://brave-otter-a1b2c3d.shipstatic.com',
            files: 2,
            size: 100,
            status: 'success',
          });
        }
        return json({ error: 'not_found', message: 'not found', status: 404 }, 404);
      }) as unknown as Fetch;

      return { fetch, paths, urls };
    }

    it('reads limits before the SPA pre-flight, and both before the deploy', async () => {
      // Why the order is load-bearing: `/spa-check` and the deploy body are
      // both size-validated against the limits, so a deploy that raced ahead
      // of `/limits` would validate against nothing.
      const { fetch, paths } = recordingFetch();
      const client = new TestShip({ apiUrl: 'http://localhost:13579', token: TEST_API_KEY, fetch });

      await client.deployments.upload(['./ignored']);

      expect(paths).toEqual(['/limits', '/spa-check', '/deployments']);
    });

    it('sends every call to the configured apiUrl, never the default', async () => {
      const apiUrl = 'http://localhost:13579';
      const { fetch, urls } = recordingFetch();
      const client = new TestShip({ apiUrl, token: TEST_API_KEY, fetch });

      await client.deployments.upload(['./ignored']);

      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url.startsWith(apiUrl)).toBe(true);
      }
    });

    it('reads limits once per call that uses them, and holds none between calls', async () => {
      const { fetch, paths } = recordingFetch();
      const client = new TestShip({ apiUrl: 'http://localhost:13579', token: TEST_API_KEY, fetch });

      await client.getLimits();
      await client.getLimits();
      await client.deployments.upload(['./ignored']);

      expect(paths.filter((p) => p === '/limits')).toHaveLength(3);
    });
  });

  /**
   * Cancel stops a deploy wherever it is. A deploy is three requests (the
   * limits it validates against, the SPA question, the upload itself), and
   * the caller's one signal must reach each: a stop that only reached the
   * last left the form busy while the first two ran, and a stop during the
   * SPA question was swallowed by its fallback and read as a failure.
   */
  describe('cancellation reaches every request of a deploy (real transport)', () => {
    /** Answers every path, except one it holds open until its signal aborts. */
    function holdingFetch(held: string) {
      const paths: string[] = [];
      let heldSignal: AbortSignal | undefined;
      let reached: () => void = () => {};
      const arrived = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const fetch = vi.fn(async (input: any, init?: RequestInit) => {
        const { pathname } = new URL(typeof input === 'string' ? input : input.url);
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
        if (pathname === '/limits') {
          return json({ maxFileSize: 20971520, maxFilesCount: 500, maxTotalSize: 52428800 });
        }
        if (pathname === '/spa-check') return json({ isSPA: false });
        return json({ deployment: 'brave-otter-a1b2c3d.shipstatic.com', status: 'success' });
      }) as unknown as Fetch;
      return { fetch, paths, arrived, heldSignal: () => heldSignal };
    }

    it.each([
      ['/limits', ['/limits']],
      ['/spa-check', ['/limits', '/spa-check']],
      ['/deployments', ['/limits', '/spa-check', '/deployments']],
    ])(
      'a stop while %s is in flight cancels it, and sends nothing after it',
      async (held, sent) => {
        const { fetch, paths, arrived, heldSignal } = holdingFetch(held);
        const client = new TestShip({
          apiUrl: 'http://localhost:13579',
          token: TEST_API_KEY,
          fetch,
        });
        const controller = new AbortController();

        const upload = client.deployments.upload(['./ignored'], { signal: controller.signal });
        await arrived;
        controller.abort();

        await expect(upload).rejects.toMatchObject({ type: 'operation_cancelled' });
        expect(heldSignal()?.aborted).toBe(true);
        expect(paths).toEqual(sent);
      },
    );
  });
});
