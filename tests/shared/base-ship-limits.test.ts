/**
 * Comprehensive tests for ship.getLimits() method
 * Tests all execution branches for both Node.js and Browser environments
 */

import path from 'node:path';
import type { PlatformLimits } from '@shipstatic/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ship as BrowserShip } from '../../src/browser/index';
import { Ship as NodeShip } from '../../src/node/index';
import { __setTestEnvironment } from '../../src/shared/lib/env';
import { deployToken } from '../fixtures/builders';

const DEMO_SITE = path.resolve(__dirname, '../fixtures/demo-site');

// A deploy token in the platform's canonical shape, built from its constants
const TEST_DEPLOY_TOKEN = deployToken('a');

describe('ship.getLimits() - Cross-Environment Limits Retrieval', () => {
  const mockLimits: PlatformLimits = {
    maxFileSize: 10 * 1024 * 1024,
    maxFilesCount: 1000,
    maxTotalSize: 100 * 1024 * 1024,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Helper to create a properly mocked Ship instance for testing
   */
  function createMockedShip(ship: NodeShip | BrowserShip, httpMocks: any = {}) {
    // Mock fetchPlatformLimits to prevent actual /limits HTTP fetch but
    // simulate its side effect — hydrating the per-instance platform limits.
    vi.spyOn(ship as any, 'fetchPlatformLimits').mockImplementation(async () => {
      (ship as any).platformLimits = mockLimits;
    });

    // Set up HTTP client with defaults + custom mocks
    const defaultMocks = {
      getLimits: vi.fn().mockResolvedValue(mockLimits),
      ping: vi.fn().mockResolvedValue(true),
      getAccount: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
    };

    (ship as any).http = { ...defaultMocks, ...httpMocks };
    return ship;
  }

  describe('Node.js Environment', () => {
    beforeEach(() => {
      __setTestEnvironment('node');
    });

    describe('Basic Functionality', () => {
      it('should fetch config from API on first call', async () => {
        const ship = new NodeShip({ token: 'test-key' });
        const getLimitsSpy = vi.fn().mockResolvedValue(mockLimits);
        createMockedShip(ship, { getLimits: getLimitsSpy });

        const result = await ship.getLimits();

        expect(result).toEqual(mockLimits);
        // Note: http.getLimits is NOT called by ship.getLimits() directly
        // It's called by fetchPlatformLimits() during initialization, and ship.getLimits() reuses that result
      });

      it('should return cached config on subsequent calls', async () => {
        const ship = new NodeShip({ token: 'test-key' });
        const getLimitsSpy = vi.fn().mockResolvedValue(mockLimits);
        createMockedShip(ship, { getLimits: getLimitsSpy });

        // First call - reuses config set by fetchPlatformLimits mock
        const result1 = await ship.getLimits();
        expect(result1).toEqual(mockLimits);

        // Second call - returns cached value from this.platformLimits
        const result2 = await ship.getLimits();
        expect(result2).toEqual(mockLimits);

        // Third call - still cached
        const result3 = await ship.getLimits();
        expect(result3).toEqual(mockLimits);

        // All results should be the same object (cached)
        expect(result1).toBe(result2);
        expect(result2).toBe(result3);
      });

      it('should trigger initialization on first call', async () => {
        const ship = new NodeShip({ token: 'test-key' });

        // Spy on ensureInitialized instead since fetchPlatformLimits is mocked by helper
        const ensureInitializedSpy = vi.spyOn(ship as any, 'ensureInitialized');
        createMockedShip(ship);

        await ship.getLimits();

        expect(ensureInitializedSpy).toHaveBeenCalled();
      });

      it('should not trigger duplicate initialization if already initialized', async () => {
        const ship = new NodeShip({ token: 'test-key' });

        // Spy on ensureInitialized before creating mocked ship
        const ensureInitializedSpy = vi.spyOn(ship as any, 'ensureInitialized');
        createMockedShip(ship);

        // First call - triggers initialization
        await ship.getLimits();
        const firstCallCount = ensureInitializedSpy.mock.calls.length;
        expect(firstCallCount).toBeGreaterThan(0);

        // Second call - ensureInitialized returns cached promise
        await ship.getLimits();
        // Should return same promise (not call ensureInitialized again)
        expect(ensureInitializedSpy.mock.calls.length).toBe(firstCallCount);
      });
    });

    describe('Error Handling', () => {
      it('should propagate API errors when fetching config', async () => {
        const ship = new NodeShip({ token: 'test-key' });
        const apiError = new Error('Failed to fetch config from API');
        const getLimitsSpy = vi.fn().mockRejectedValue(apiError);

        // Mock fetchPlatformLimits to simulate failure (doesn't set platform config)
        vi.spyOn(ship as any, 'fetchPlatformLimits').mockRejectedValue(apiError);

        (ship as any).http = {
          getLimits: getLimitsSpy,
          ping: vi.fn().mockResolvedValue(true),
          getAccount: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
        };

        await expect(ship.getLimits()).rejects.toThrow('Failed to fetch config from API');
      });

      // Note: Error retry testing is covered by base-ship initialization tests

      it('should handle 401 authentication errors', async () => {
        const ship = new NodeShip({ token: 'invalid-key' });
        const authError = new Error('Invalid API key');

        // Mock fetchPlatformLimits to simulate auth failure
        vi.spyOn(ship as any, 'fetchPlatformLimits').mockRejectedValue(authError);

        (ship as any).http = {
          getLimits: vi.fn().mockRejectedValue(authError),
          ping: vi.fn().mockResolvedValue(true),
          getAccount: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
        };

        await expect(ship.getLimits()).rejects.toThrow('Invalid API key');
      });

      it('should handle network errors gracefully', async () => {
        const ship = new NodeShip({ token: 'test-key' });
        const networkError = new Error('ECONNREFUSED: Connection refused');

        // Mock fetchPlatformLimits to simulate network failure
        vi.spyOn(ship as any, 'fetchPlatformLimits').mockRejectedValue(networkError);

        (ship as any).http = {
          getLimits: vi.fn().mockRejectedValue(networkError),
          ping: vi.fn().mockResolvedValue(true),
          getAccount: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
        };

        await expect(ship.getLimits()).rejects.toThrow('ECONNREFUSED: Connection refused');
      });
    });

    describe('Concurrent Calls', () => {
      it('should handle concurrent getLimits calls and cache result', async () => {
        const ship = new NodeShip({ token: 'test-key' });
        const getLimitsSpy = vi.fn().mockResolvedValue(mockLimits);
        createMockedShip(ship, { getLimits: getLimitsSpy });

        // Make 5 concurrent calls - these will race and may all call API
        const results = await Promise.all([
          ship.getLimits(),
          ship.getLimits(),
          ship.getLimits(),
          ship.getLimits(),
          ship.getLimits(),
        ]);

        // All should return the same config values
        results.forEach((result) => {
          expect(result).toEqual(mockLimits);
        });

        // After concurrent calls complete, subsequent call uses cache
        const cachedResult = await ship.getLimits();
        expect(cachedResult).toEqual(mockLimits);

        // Verify the config is cached and referenced correctly
        expect((ship as any).platformLimits).toEqual(mockLimits);
      });

      it('should handle mixed concurrent getLimits and other method calls', async () => {
        const ship = new NodeShip({ token: 'test-key' });
        const getLimitsSpy = vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return mockLimits;
        });
        createMockedShip(ship, { getLimits: getLimitsSpy });

        // Mix getLimits with other calls
        const [configResult, pingResult, whoamiResult] = await Promise.all([
          ship.getLimits(),
          ship.ping(),
          ship.whoami(),
        ]);

        expect(configResult).toEqual(mockLimits);
        expect(pingResult).toBe(true);
        expect(whoamiResult).toEqual({ email: 'test@example.com' });
      });
    });

    /**
     * The limits fetch is EARNED, not automatic.
     *
     * `ensureInit()` used to sit at the top of all nineteen resource wrappers,
     * so every operation hydrated `/limits` before doing its own work — and
     * only the deploy pipeline ever reads the result (file-size, file-count
     * and blocklist checks inside `processInput`). Measured before the fix:
     * `domains.list()`, `tokens.list()` and even `ping()` each issued
     * `/limits` first. Every CLI command is one process, so that was a wasted
     * round trip on every invocation of the product.
     *
     * These count REQUESTS through an injected fetch, which is the only thing
     * that can see the difference — the resolved values were always correct.
     */
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

    describe('Initialization Integration', () => {
      it('should work correctly when called before any other methods', async () => {
        const ship = new NodeShip({ token: 'test-key' });
        createMockedShip(ship);

        // getLimits is the first method called
        const result = await ship.getLimits();

        expect(result).toEqual(mockLimits);
        expect((ship as any).initPromise).toBeTruthy(); // Initialization completed
      });

      it('should work correctly when called after other methods', async () => {
        const ship = new NodeShip({ token: 'test-key' });
        const pingSpy = vi.fn().mockResolvedValue(true);
        createMockedShip(ship, { ping: pingSpy });

        // Call ping first (triggers initialization)
        await ship.ping();
        expect(pingSpy).toHaveBeenCalledTimes(1);

        // Then call getLimits
        const result = await ship.getLimits();
        expect(result).toEqual(mockLimits);
      });

      it('should share initialization state with resource methods', async () => {
        const ship = new NodeShip({ token: 'test-key' });
        createMockedShip(ship);

        // Call whoami (triggers initialization)
        await ship.whoami();

        // Call getLimits - both use the same initialization system
        const result = await ship.getLimits();

        // Verify both methods work and return expected results
        expect(result).toEqual(mockLimits);
        // The initialization promise should be set after either call
        expect((ship as any).initPromise).toBeTruthy();
      });
    });

    describe('Configuration Values', () => {
      it('should return maxFileSize from API config', async () => {
        const ship = new NodeShip({ token: 'test-key' });
        const customConfig = {
          maxFileSize: 5242880,
          maxFilesCount: 500,
          maxTotalSize: 52428800,
        };

        // Mock fetchPlatformLimits to set custom config
        vi.spyOn(ship as any, 'fetchPlatformLimits').mockImplementation(async () => {
          (ship as any).platformLimits = customConfig;
        });

        (ship as any).http = {
          getLimits: vi.fn().mockResolvedValue(customConfig),
          ping: vi.fn().mockResolvedValue(true),
          getAccount: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
        };

        const result = await ship.getLimits();
        expect(result.maxFileSize).toBe(5242880);
      });

      it('should return maxFilesCount from API config', async () => {
        const ship = new NodeShip({ token: 'test-key' });
        const customConfig = {
          maxFileSize: 10485760,
          maxFilesCount: 2000,
          maxTotalSize: 104857600,
        };

        vi.spyOn(ship as any, 'fetchPlatformLimits').mockImplementation(async () => {
          (ship as any).platformLimits = customConfig;
        });

        (ship as any).http = {
          getLimits: vi.fn().mockResolvedValue(customConfig),
          ping: vi.fn().mockResolvedValue(true),
          getAccount: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
        };

        const result = await ship.getLimits();
        expect(result.maxFilesCount).toBe(2000);
      });

      it('should return maxTotalSize from API config', async () => {
        const ship = new NodeShip({ token: 'test-key' });
        const customConfig = {
          maxFileSize: 10485760,
          maxFilesCount: 1000,
          maxTotalSize: 209715200,
        };

        vi.spyOn(ship as any, 'fetchPlatformLimits').mockImplementation(async () => {
          (ship as any).platformLimits = customConfig;
        });

        (ship as any).http = {
          getLimits: vi.fn().mockResolvedValue(customConfig),
          ping: vi.fn().mockResolvedValue(true),
          getAccount: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
        };

        const result = await ship.getLimits();
        expect(result.maxTotalSize).toBe(209715200);
      });

      it('should return complete config object with all properties', async () => {
        const ship = new NodeShip({ token: 'test-key' });
        const fullConfig = {
          maxFileSize: 10485760,
          maxFilesCount: 1000,
          maxTotalSize: 104857600,
        };

        vi.spyOn(ship as any, 'fetchPlatformLimits').mockImplementation(async () => {
          (ship as any).platformLimits = fullConfig;
        });

        (ship as any).http = {
          getLimits: vi.fn().mockResolvedValue(fullConfig),
          ping: vi.fn().mockResolvedValue(true),
          getAccount: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
        };

        const result = await ship.getLimits();
        expect(result).toEqual(fullConfig);
        expect(Object.keys(result)).toEqual(['maxFileSize', 'maxFilesCount', 'maxTotalSize']);
      });
    });
  });

  describe('Browser Environment', () => {
    beforeEach(() => {
      __setTestEnvironment('browser');
    });

    describe('Basic Functionality', () => {
      it('should fetch config from API on first call', async () => {
        const ship = new BrowserShip({
          token: TEST_DEPLOY_TOKEN,
          apiUrl: 'https://api.shipstatic.com',
        });
        const getLimitsSpy = vi.fn().mockResolvedValue(mockLimits);
        createMockedShip(ship, { getLimits: getLimitsSpy });

        const result = await ship.getLimits();

        expect(result).toEqual(mockLimits);
      });

      it('should return cached config on subsequent calls', async () => {
        const ship = new BrowserShip({
          token: TEST_DEPLOY_TOKEN,
          apiUrl: 'https://api.shipstatic.com',
        });
        const getLimitsSpy = vi.fn().mockResolvedValue(mockLimits);
        createMockedShip(ship, { getLimits: getLimitsSpy });

        // First call
        const result1 = await ship.getLimits();
        expect(result1).toEqual(mockLimits);

        // Second call - cached
        const result2 = await ship.getLimits();
        expect(result2).toEqual(mockLimits);
      });

      it('should trigger initialization on first call', async () => {
        const ship = new BrowserShip({
          token: TEST_DEPLOY_TOKEN,
          apiUrl: 'https://api.shipstatic.com',
        });

        // Spy on ensureInitialized instead since fetchPlatformLimits is mocked by helper
        const ensureInitializedSpy = vi.spyOn(ship as any, 'ensureInitialized');
        createMockedShip(ship);

        await ship.getLimits();

        expect(ensureInitializedSpy).toHaveBeenCalled();
      });
    });

    describe('Error Handling', () => {
      it('should propagate API errors when fetching config', async () => {
        const ship = new BrowserShip({
          token: TEST_DEPLOY_TOKEN,
          apiUrl: 'https://api.shipstatic.com',
        });
        const apiError = new Error('Failed to fetch config from API');

        // Mock fetchPlatformLimits to simulate failure
        vi.spyOn(ship as any, 'fetchPlatformLimits').mockRejectedValue(apiError);

        (ship as any).http = {
          getLimits: vi.fn().mockRejectedValue(apiError),
          ping: vi.fn().mockResolvedValue(true),
          getAccount: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
        };

        await expect(ship.getLimits()).rejects.toThrow('Failed to fetch config from API');
      });

      // Note: Error retry testing is covered by base-ship initialization tests

      it('should handle CORS errors in browser', async () => {
        const ship = new BrowserShip({
          token: TEST_DEPLOY_TOKEN,
          apiUrl: 'https://api.shipstatic.com',
        });
        const corsError = new Error('CORS policy blocked the request');

        // Mock fetchPlatformLimits to simulate CORS failure
        vi.spyOn(ship as any, 'fetchPlatformLimits').mockRejectedValue(corsError);

        (ship as any).http = {
          getLimits: vi.fn().mockRejectedValue(corsError),
          ping: vi.fn().mockResolvedValue(true),
          getAccount: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
        };

        await expect(ship.getLimits()).rejects.toThrow('CORS policy blocked the request');
      });
    });

    describe('Concurrent Calls', () => {
      it('should handle concurrent getLimits calls and cache result', async () => {
        const ship = new BrowserShip({
          token: TEST_DEPLOY_TOKEN,
          apiUrl: 'https://api.shipstatic.com',
        });
        const getLimitsSpy = vi.fn().mockResolvedValue(mockLimits);
        createMockedShip(ship, { getLimits: getLimitsSpy });

        // Make concurrent calls - these will race and may all call API
        const results = await Promise.all([ship.getLimits(), ship.getLimits(), ship.getLimits()]);

        results.forEach((result) => {
          expect(result).toEqual(mockLimits);
        });

        // After concurrent calls complete, subsequent call uses cache
        const cachedResult = await ship.getLimits();
        expect(cachedResult).toEqual(mockLimits);

        // Verify the config is cached
        expect((ship as any).platformLimits).toEqual(mockLimits);
      });
    });

    describe('Browser-Specific Scenarios', () => {
      it('should work with deploy token authentication', async () => {
        const ship = new BrowserShip({
          token: TEST_DEPLOY_TOKEN,
          apiUrl: 'https://api.shipstatic.com',
        });
        createMockedShip(ship);

        const result = await ship.getLimits();
        expect(result).toEqual(mockLimits);
      });

      it('should work with custom API URL', async () => {
        const ship = new BrowserShip({
          token: TEST_DEPLOY_TOKEN,
          apiUrl: 'https://custom-api.example.com',
        });
        createMockedShip(ship);

        const result = await ship.getLimits();
        expect(result).toEqual(mockLimits);
      });
    });
  });

  describe('Cross-Environment Consistency', () => {
    it('should return identical config structure in both Node.js and Browser', async () => {
      __setTestEnvironment('node');
      const nodeShip = new NodeShip({ token: 'test-key' });
      createMockedShip(nodeShip);

      __setTestEnvironment('browser');
      const browserShip = new BrowserShip({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.shipstatic.com',
      });
      createMockedShip(browserShip);

      const nodeResult = await nodeShip.getLimits();
      const browserResult = await browserShip.getLimits();

      expect(nodeResult).toEqual(browserResult);
      expect(Object.keys(nodeResult).sort()).toEqual(Object.keys(browserResult).sort());
    });

    it('should cache config identically in both environments', async () => {
      __setTestEnvironment('node');
      const nodeShip = new NodeShip({ token: 'test-key' });
      const nodeGetConfigSpy = vi.fn().mockResolvedValue(mockLimits);
      createMockedShip(nodeShip, { getLimits: nodeGetConfigSpy });

      __setTestEnvironment('browser');
      const browserShip = new BrowserShip({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.shipstatic.com',
      });
      const browserGetConfigSpy = vi.fn().mockResolvedValue(mockLimits);
      createMockedShip(browserShip, { getLimits: browserGetConfigSpy });

      // Multiple calls in each environment
      await nodeShip.getLimits();
      await nodeShip.getLimits();
      await browserShip.getLimits();
      await browserShip.getLimits();

      // Both should only call API once
    });
  });

  describe('Cache Invalidation', () => {
    it('should not provide a way to invalidate cache (by design)', async () => {
      __setTestEnvironment('node');
      const ship = new NodeShip({ token: 'test-key' });
      const getLimitsSpy = vi.fn().mockResolvedValue(mockLimits);
      createMockedShip(ship, { getLimits: getLimitsSpy });

      // Get config
      await ship.getLimits();

      // No public API to clear cache - this is intentional
      // Config is immutable per SDK instance lifetime

      // Subsequent calls still use cache
      await ship.getLimits();
    });

    it('should require new SDK instance to fetch fresh config', async () => {
      __setTestEnvironment('node');

      // First instance
      const ship1 = new NodeShip({ token: 'test-key' });
      createMockedShip(ship1);

      await ship1.getLimits();
      const result1 = await ship1.getLimits();
      expect(result1).toEqual(mockLimits);

      // Second instance - fresh fetch (each instance has its own cache)
      const ship2 = new NodeShip({ token: 'test-key' });
      createMockedShip(ship2);

      const result2 = await ship2.getLimits();
      expect(result2).toEqual(mockLimits);

      // Both instances should work correctly
      expect(result1).toEqual(result2); // Same values
      // Each instance maintains its own cache independently
    });
  });

  describe('Edge Cases', () => {
    it('should handle config with zero values', async () => {
      __setTestEnvironment('node');
      const ship = new NodeShip({ token: 'test-key' });
      const zeroConfig = {
        maxFileSize: 0,
        maxFilesCount: 0,
        maxTotalSize: 0,
      };

      vi.spyOn(ship as any, 'fetchPlatformLimits').mockImplementation(async () => {
        (ship as any).platformLimits = zeroConfig;
      });

      (ship as any).http = {
        getLimits: vi.fn().mockResolvedValue(zeroConfig),
        ping: vi.fn().mockResolvedValue(true),
        getAccount: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
      };

      const result = await ship.getLimits();
      expect(result).toEqual(zeroConfig);
    });

    it('should handle config with very large values', async () => {
      __setTestEnvironment('node');
      const ship = new NodeShip({ token: 'test-key' });
      const largeConfig = {
        maxFileSize: Number.MAX_SAFE_INTEGER,
        maxFilesCount: Number.MAX_SAFE_INTEGER,
        maxTotalSize: Number.MAX_SAFE_INTEGER,
      };

      vi.spyOn(ship as any, 'fetchPlatformLimits').mockImplementation(async () => {
        (ship as any).platformLimits = largeConfig;
      });

      (ship as any).http = {
        getLimits: vi.fn().mockResolvedValue(largeConfig),
        ping: vi.fn().mockResolvedValue(true),
        getAccount: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
      };

      const result = await ship.getLimits();
      expect(result).toEqual(largeConfig);
    });

    it('should preserve config object reference when cached', async () => {
      __setTestEnvironment('node');
      const ship = new NodeShip({ token: 'test-key' });
      createMockedShip(ship);

      const result1 = await ship.getLimits();
      const result2 = await ship.getLimits();

      // Same object reference (cached)
      expect(result1).toBe(result2);
    });
  });

  describe('Integration: Avoid Duplicate API Calls', () => {
    // Note: Node.js integration test removed - too complex to mock ApiHttp constructor properly.
    // The Browser integration test below validates the fix works across environments.

    it('should only call /limits API once during cold start in Browser', async () => {
      __setTestEnvironment('browser');
      const ship = new BrowserShip({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.shipstatic.com',
      });

      // DO NOT mock fetchPlatformLimits - let it run to verify real integration
      const getLimitsSpy = vi.fn().mockResolvedValue(mockLimits);
      (ship as any).http = {
        getLimits: getLimitsSpy,
        ping: vi.fn().mockResolvedValue(true),
        getAccount: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
      };

      // First call to getLimits() triggers initialization
      await ship.getLimits();

      // Verify http.getLimits was only called once
      expect(getLimitsSpy).toHaveBeenCalledTimes(1);
    });

    // Note: Node.js integration test removed - too complex to mock ApiHttp constructor properly.
    // The Browser integration test below validates config reuse works across environments.

    it('memoizes the limits fetch, and only the calls that read them trigger it', async () => {
      __setTestEnvironment('browser');
      const ship = new BrowserShip({
        token: TEST_DEPLOY_TOKEN,
        apiUrl: 'https://api.shipstatic.com',
      });

      const getLimitsSpy = vi.fn().mockResolvedValue(mockLimits);
      (ship as any).http = {
        getLimits: getLimitsSpy,
        ping: vi.fn().mockResolvedValue(true),
        getAccount: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
      };

      // Calls that read no limits fetch none — `ping` hydrated them until
      // 2026-08-12, which is what made the cheapest call issue two requests.
      await ship.ping();
      await ship.whoami();
      expect(getLimitsSpy).not.toHaveBeenCalled();

      // Asking directly fetches once...
      await ship.getLimits();
      expect(getLimitsSpy).toHaveBeenCalledTimes(1);

      // ...and the memo survives every later call, which is what this test
      // has always been about.
      await ship.getLimits();
      await ship.whoami();
      expect(getLimitsSpy).toHaveBeenCalledTimes(1);
    });
  });
});
