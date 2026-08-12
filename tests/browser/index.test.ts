/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BrowserDefault, { Ship } from '../../src/browser/index';
import { __setTestEnvironment } from '../../src/shared/lib/env';
import type { Fetch } from '../../src/shared/types';
import { deployToken, FREE_PLAN_LIMITS } from '../fixtures/builders';
import { fakeTransport } from '../mocks/transport';

// Mock browser file processing.
//
// The content was an `ArrayBuffer` — a shape `StaticFile` does not admit and no
// pipeline emits — which went unnoticed only because the SPA pre-flight was
// stubbed a layer above. `checkSPA` reads the index itself now, so the shape
// has to be one it can read.
//
// It is a `Buffer` rather than the `Blob`/`File` the browser pipeline really
// produces, and that is a JSDOM limitation stated rather than papered over:
// jsdom's `Blob` has no `.text()`, so the real browser shape throws inside
// `checkSPA` and `detectAndConfigureSPA` swallows it — the pre-flight silently
// never happens, and this row would pass while proving nothing. The Blob and
// File arms are certified where they can be: on real Chromium in
// `tests-browser/`, and against Node's own `Blob` in `shared/lib/spa.test.ts`.
vi.mock('../../src/browser/core/browser-files', () => ({
  processFilesForBrowser: vi.fn().mockResolvedValue([
    {
      path: 'index.html',
      content: Buffer.from('<html></html>'),
      size: 13,
      md5: 'a'.repeat(32),
    },
  ]),
}));

// A deploy token in the platform's canonical shape, built from its constants
const TEST_DEPLOY_TOKEN = deployToken('a');

describe('Ship - Browser Implementation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setTestEnvironment('browser'); // Ensure we're in browser environment for tests
  });

  describe('constructor', () => {
    it('should create Ship instance with explicit configuration', () => {
      const ship = new Ship({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.shipstatic.com',
      });
      expect(ship).toBeInstanceOf(Ship);
    });

    it('should work without API key (using deploy tokens)', () => {
      const ship = new Ship({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.shipstatic.com',
      });
      expect(ship).toBeInstanceOf(Ship);
    });
  });

  describe('configuration handling', () => {
    it('should use constructor options directly (no client config storage)', async () => {
      const ship = new Ship({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://custom-api.com',
      });

      // Mock the HTTP client to avoid actual network calls
      const getLimitsSpy = vi
        .fn()
        .mockResolvedValue({ maxFileSize: 10485760, maxFilesCount: 1000, maxTotalSize: 52428800 });
      (ship as any).http = fakeTransport({
        Ping: { success: true, timestamp: 1_700_000_000 },
        'Get limits': getLimitsSpy,
      });

      // Asking for the limits is what fetches them. `ping()` used to, which
      // made the cheapest call in the SDK issue two requests; the subject here
      // is that the browser has no ambient config source, not what triggers a
      // fetch.
      await ship.getLimits();

      expect(getLimitsSpy).toHaveBeenCalled();

      // Browser has no ambient config source
      // All config comes through constructor options
    });
  });

  describe('deploy functionality', () => {
    it('should process File[] correctly', async () => {
      const ship = new Ship({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.shipstatic.com',
      });

      // Mock the API client
      (ship as any).http = fakeTransport({
        Deploy: vi.fn().mockResolvedValue({
          id: 'dep_browser_123',
          url: 'https://dep_browser_123.shipstatic.com',
        }),
        'SPA check': { isSPA: false },
        'Get limits': vi.fn().mockResolvedValue({
          maxFileSize: 10485760,
          maxFilesCount: 1000,
          maxTotalSize: 52428800,
        }),
      });

      // Create mock File objects
      const mockFiles = [
        new File(['<html></html>'], 'index.html', { type: 'text/html' }),
        new File(['body {}'], 'style.css', { type: 'text/css' }),
      ];

      const result = await ship.deploy(mockFiles);

      expect(result).toEqual({
        id: 'dep_browser_123',
        url: 'https://dep_browser_123.shipstatic.com',
      });
    });
  });

  describe('SPA detection in browser', () => {
    it('should apply SPA detection for browser files (unified pipeline)', async () => {
      const ship = new Ship({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.shipstatic.com',
      });

      // Mock the API client with SPA detection
      (ship as any).http = fakeTransport({
        Deploy: vi.fn().mockResolvedValue({
          id: 'dep_spa_123',
          url: 'https://dep_spa_123.shipstatic.com',
        }),
        'SPA check': { isSPA: true }, // SPA detected
        'Get limits': vi.fn().mockResolvedValue({
          maxFileSize: 10485760,
          maxFilesCount: 1000,
          maxTotalSize: 52428800,
        }),
      });

      const mockFiles = [
        new File(['<html><script src="app.js"></script></html>'], 'index.html', {
          type: 'text/html',
        }),
      ];

      await ship.deploy(mockFiles, { spaDetect: true });

      // The unified pipeline asks the platform before it builds the body.
      expect((ship as any).http.carriedFor('SPA check')).toHaveLength(1);
    });
  });

  describe('module surface', () => {
    it('exports Ship as the default export', () => {
      // `import Ship from '@shipstatic/ship'` in a bundler is the browser
      // entry's primary documented shape.
      expect(BrowserDefault).toBe(Ship);
    });

    it('routes every request through an injected fetch, bypassing globalThis', async () => {
      // Transport injection is a published contract, and the browser entry is
      // where a service-worker / tracing fetcher would be handed in. Asserting
      // the request ARRIVES proves the wiring, not just that the option was
      // stored somewhere.
      const seen: string[] = [];
      const fetch = vi.fn(async (input: any) => {
        seen.push(typeof input === 'string' ? input : input.url);
        return new Response(JSON.stringify({ success: true, timestamp: 1_700_000_000 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as unknown as Fetch;

      const ship = new Ship({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'http://localhost:13579',
        fetch,
      });

      await expect(ship.ping()).resolves.toEqual({ success: true, timestamp: 1_700_000_000 });
      // ONE request. This read `['…/limits', '…/ping']` until 2026-08-12,
      // which is the wasted round trip written down as an expectation.
      expect(seen).toEqual(['http://localhost:13579/ping']);
    });
  });

  describe('exported utilities', () => {
    it('should export browser-specific utilities', async () => {
      const browserModule = await import('../../src/browser/index');

      expect(browserModule.processFilesForBrowser).toBeDefined();
    });

    it('should re-export shared utilities', async () => {
      const browserModule = await import('../../src/browser/index');

      // These come from shared exports
      expect(browserModule.ShipError).toBeDefined();
      expect(browserModule.getENV).toBeDefined();
      expect(browserModule.__setTestEnvironment).toBeDefined();
    });
  });

  describe('resource functionality', () => {
    it('should provide access to all resources (same as Node.js)', () => {
      const ship = new Ship({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.shipstatic.com',
      });

      expect(ship.deployments).toBeDefined();
      expect(ship.domains).toBeDefined();
      expect(ship.account).toBeDefined();
    });
  });

  describe('browser-specific behavior', () => {
    it('should receive all config via constructor (no file loading)', async () => {
      const ship = new Ship({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.shipstatic.com',
      });

      // Mock the HTTP client
      const getLimitsSpy = vi
        .fn()
        .mockResolvedValue({ maxFileSize: 10485760, maxFilesCount: 1000, maxTotalSize: 52428800 });
      (ship as any).http = fakeTransport({
        Ping: { success: true, timestamp: 1_700_000_000 },
        'Get limits': getLimitsSpy,
      });

      await ship.getLimits();

      // The browser reads no config file — the limits are the only thing it
      // ever fetches to configure itself, and only when asked.
      expect(getLimitsSpy).toHaveBeenCalled();
    });
  });

  describe('deployment edge cases (migrated from browser-sdk.test.ts)', () => {
    it('hands the hydrated platform limits to the file processor', async () => {
      // The limits are an argument, not a module singleton — two Ships against
      // different APIs must not clobber each other's caps. This is the seam
      // where that argument is threaded.
      const { processFilesForBrowser } = await import('../../src/browser/core/browser-files');
      const ship = new Ship({ token: TEST_DEPLOY_TOKEN, apiUrl: 'https://api.example.com' });
      (ship as any).http = fakeTransport({
        Deploy: vi.fn().mockResolvedValue({ deployment: 'brave-otter-a1b2c3d' }),
        'SPA check': { isSPA: false },
        'Get limits': vi.fn().mockResolvedValue(FREE_PLAN_LIMITS),
      });

      await ship.deploy([new File(['x'], 'index.html')]);

      expect(processFilesForBrowser).toHaveBeenCalledWith(
        [expect.any(File)],
        expect.any(Object),
        FREE_PLAN_LIMITS,
      );
    });

    it('should throw error for invalid input type in browser', async () => {
      const ship = new Ship({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.shipstatic.com',
      });

      // Should reject string paths (Node.js only input)
      await expect(ship.deploy('/path/to/file' as any)).rejects.toThrow();
    });

    it('should pass deployment options correctly', async () => {
      const ship = new Ship({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.shipstatic.com',
      });

      // Mock the API and processInput to verify options are passed
      const mockProcessInput = vi
        .fn()
        .mockResolvedValue([
          { path: 'test.txt', content: new ArrayBuffer(4), size: 4, md5: 'test-hash' },
        ]);

      (ship as any).processInput = mockProcessInput;
      (ship as any).http = fakeTransport({
        Deploy: vi.fn().mockResolvedValue({
          id: 'dep_options_123',
          url: 'https://dep_options_123.shipstatic.com',
        }),
        'SPA check': { isSPA: false },
        'Get limits': vi.fn().mockResolvedValue({
          maxFileSize: 10485760,
          maxFilesCount: 1000,
          maxTotalSize: 52428800,
        }),
      });

      const mockFiles = [new File(['test'], 'test.txt')];
      const options = {
        spaDetect: false,
        labels: ['browser-audit'],
      };

      await ship.deploy(mockFiles, options);

      // Verify options were passed to processInput
      expect(mockProcessInput).toHaveBeenCalledWith(mockFiles, expect.objectContaining(options));
    });

    it('should handle empty File[]', async () => {
      const ship = new Ship({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.shipstatic.com',
      });

      (ship as any).http = fakeTransport({
        Deploy: vi.fn().mockResolvedValue({
          id: 'dep_empty_123',
          url: 'https://dep_empty_123.shipstatic.com',
        }),
        'SPA check': { isSPA: false },
        'Get limits': vi.fn().mockResolvedValue({
          maxFileSize: 10485760,
          maxFilesCount: 1000,
          maxTotalSize: 52428800,
        }),
      });

      const emptyFiles: File[] = [];

      // Empty File[] is rejected early — aligned with Node behavior
      await expect(ship.deploy(emptyFiles)).rejects.toThrow('No files to deploy.');
    });

    it('should handle File objects with different MIME types', async () => {
      const ship = new Ship({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.shipstatic.com',
      });

      (ship as any).http = fakeTransport({
        Deploy: vi.fn().mockResolvedValue({
          id: 'dep_mime_123',
          url: 'https://dep_mime_123.shipstatic.com',
        }),
        'SPA check': { isSPA: false },
        'Get limits': vi.fn().mockResolvedValue({
          maxFileSize: 10485760,
          maxFilesCount: 1000,
          maxTotalSize: 52428800,
        }),
      });

      const mockFiles = [
        new File(['<html></html>'], 'index.html', { type: 'text/html' }),
        new File(['body {}'], 'style.css', { type: 'text/css' }),
        new File(['console.log("hi")'], 'app', { type: 'application/javascript' }),
        new File([new ArrayBuffer(100)], 'image.png', { type: 'image/png' }),
        new File(['{"test": true}'], 'data.json', { type: 'application/json' }),
      ];

      const result = await ship.deploy(mockFiles);

      expect(result).toEqual({
        id: 'dep_mime_123',
        url: 'https://dep_mime_123.shipstatic.com',
      });
    });
  });

  describe('standardized error handling', () => {
    it('should reject string paths with consistent error message', async () => {
      const ship = new Ship({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.shipstatic.com',
      });

      (ship as any).http = fakeTransport({
        'Get limits': vi.fn().mockResolvedValue({
          maxFileSize: 10485760,
          maxFilesCount: 1000,
          maxTotalSize: 52428800,
        }),
      });

      await expect(ship.deploy('/path/to/file' as any)).rejects.toThrow(
        'Invalid input type for browser environment. Expected File[].',
      );
    });

    it('should reject Node.js-style string arrays with consistent error message', async () => {
      const ship = new Ship({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.shipstatic.com',
      });

      (ship as any).http = fakeTransport({
        'Get limits': vi.fn().mockResolvedValue({
          maxFileSize: 10485760,
          maxFilesCount: 1000,
          maxTotalSize: 52428800,
        }),
      });

      await expect(ship.deploy(['./file1.html', './file2.css'] as any)).rejects.toThrow(
        'Invalid input type for browser environment. Expected File[].',
      );
    });

    it('should reject invalid object types with consistent error message', async () => {
      const ship = new Ship({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.shipstatic.com',
      });

      (ship as any).http = fakeTransport({
        'Get limits': vi.fn().mockResolvedValue({
          maxFileSize: 10485760,
          maxFilesCount: 1000,
          maxTotalSize: 52428800,
        }),
      });

      await expect(ship.deploy({ invalid: 'object' } as any)).rejects.toThrow(
        'Invalid input type for browser environment. Expected File[].',
      );
    });

    it('should handle network errors consistently', async () => {
      const ship = new Ship({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.shipstatic.com',
      });

      // Mock network timeout
      (ship as any).http = fakeTransport({
        Deploy: vi.fn().mockRejectedValue(new Error('Request timeout after 30000ms')),
        'SPA check': { isSPA: false },
        'Get limits': vi.fn().mockResolvedValue({
          maxFileSize: 10485760,
          maxFilesCount: 1000,
          maxTotalSize: 52428800,
        }),
      });

      const mockFiles = [new File(['test'], 'test.html')];

      await expect(ship.deploy(mockFiles)).rejects.toThrow('Request timeout after 30000ms');
    });

    it('should handle API errors consistently', async () => {
      const ship = new Ship({
        token: 'invalid-token',
        apiUrl: 'https://api.shipstatic.com',
      });

      // Mock API error
      (ship as any).http = fakeTransport({
        Deploy: vi.fn().mockRejectedValue(new Error('API key is invalid')),
        'SPA check': { isSPA: false },
        'Get limits': vi.fn().mockResolvedValue({
          maxFileSize: 10485760,
          maxFilesCount: 1000,
          maxTotalSize: 52428800,
        }),
      });

      const mockFiles = [new File(['test'], 'test.html')];

      await expect(ship.deploy(mockFiles)).rejects.toThrow('API key is invalid');
    });
  });
});
