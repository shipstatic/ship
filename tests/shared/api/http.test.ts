import { ErrorType, ShipError } from '@shipstatic/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiHttp } from '../../../src/shared/api/http';
import type { DeployInput, Fetch } from '../../../src/shared/types';
import { deploy, deploymentsOver, getAccount, getLimits, listDeployments, ping } from './vehicles';

// Mock fetch globally
global.fetch = vi.fn();

/**
 * A REAL `Response`, not a hand-shaped object.
 *
 * The previous fake answered `'15'` to every `headers.get(...)` — including
 * `Content-Type`, which is not a length — and had no `clone()`, so every
 * assertion about event payloads silently exercised `safeClone`'s fallback
 * path instead of the cloning one production takes. A real Response costs
 * nothing and cannot lie about its own shape.
 */
function createMockResponse(data: any, status = 200) {
  // 204/205/304 and a `void` result must have a null body — the Response
  // constructor enforces it, which is itself a check on the test's intent.
  const hasBody = data !== undefined && status !== 204;
  return new Response(hasBody ? JSON.stringify(data) : null, {
    status,
    headers: hasBody ? { 'Content-Type': 'application/json' } : {},
  });
}

describe('ApiHttp', () => {
  let apiHttp: ApiHttp;
  const mockOptions = {
    apiUrl: 'https://api.test.com',
    getAuthHeaders: () => ({ Authorization: 'Bearer test-api-key' }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    apiHttp = new ApiHttp(mockOptions);
  });

  describe('constructor', () => {
    it('should initialize with provided options', () => {
      const api = new ApiHttp(mockOptions);
      expect(api).toBeDefined();
    });

    it('should work with minimal options', () => {
      const api = new ApiHttp({
        apiUrl: 'https://test.com',
        getAuthHeaders: () => ({}),
      });
      expect(api).toBeDefined();
    });

    it('binds the default fetch to globalThis (browser Illegal invocation regression)', async () => {
      // Browser `window.fetch` throws "Illegal invocation" when called with
      // `this` set to anything other than `window`. Simulate that contract.
      const original = globalThis.fetch;
      const strictFetch = vi.fn(function (this: any) {
        if (this !== globalThis) {
          throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
        }
        return createMockResponse({ success: true, message: 'pong' });
      });
      globalThis.fetch = strictFetch as unknown as typeof fetch;

      try {
        const api = new ApiHttp(mockOptions);
        await expect(ping(api)).resolves.toBeDefined();
        expect(strictFetch).toHaveBeenCalled();
      } finally {
        globalThis.fetch = original;
      }
    });
  });

  describe('credential resolution failures', () => {
    // Credential resolution runs inside executeRequest's error boundary:
    // whatever a token provider throws must surface as a typed ShipError
    // and an `error` event, exactly like a transport failure.
    it('normalizes a throwing token provider into a typed ShipError and emits the error event', async () => {
      const api = new ApiHttp({
        apiUrl: 'https://api.test.com',
        getAuthHeaders: async () => {
          throw new Error('refresh failed');
        },
      });
      const errors: Error[] = [];
      api.on('error', (err) => errors.push(err));

      let caught: unknown;
      try {
        await ping(api);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ShipError);
      expect((caught as ShipError).message).toContain('refresh failed');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBe(caught);
      // The failure happened at credential resolution — fetch was never reached.
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('passes the fail-closed authentication error through the boundary unchanged', async () => {
      const providerError = ShipError.authentication('Token provider returned no token.');
      const api = new ApiHttp({
        apiUrl: 'https://api.test.com',
        getAuthHeaders: async () => {
          throw providerError;
        },
      });
      const errors: Error[] = [];
      api.on('error', (err) => errors.push(err));

      await expect(ping(api)).rejects.toBe(providerError);
      expect(errors).toEqual([providerError]);
    });
  });

  describe('ping', () => {
    it('should make GET request to /ping endpoint', async () => {
      (global.fetch as any).mockResolvedValue(
        createMockResponse({ success: true, timestamp: 1_700_000_000 }),
      );

      const result = await ping(apiHttp);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/ping',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
      expect(result).toEqual({ success: true, timestamp: 1_700_000_000 });
    });

    it('should handle network errors', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      await expect(ping(apiHttp)).rejects.toThrow('Network error');
    });

    it('should handle API errors', async () => {
      (global.fetch as any).mockResolvedValue(
        createMockResponse({ error: 'Internal server error' }, 500),
      );

      await expect(ping(apiHttp)).rejects.toThrow();
    });

    it('should map HTTP 429 to ShipError with ErrorType.RateLimit', async () => {
      // Regression: rate-limit responses must classify as RateLimit, not Authentication.
      // Embedded consumers (MCP) rely on the type to render the right hint —
      // string-matching the message is fragile and was removed in favor of trusting the type.
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: (h: string) => (h === 'content-type' ? 'application/json' : null) },
        json: async () => ({
          error: ErrorType.RateLimit,
          message: 'Too many requests',
          status: 429,
        }),
        clone() {
          return this;
        },
      });

      await expect(ping(apiHttp)).rejects.toMatchObject({
        type: ErrorType.RateLimit,
        status: 429,
      });
    });

    it('should map HTTP 401 to ShipError with ErrorType.Authentication', async () => {
      // Companion check: 401 must classify as Authentication so MCP shows the SHIP_TOKEN hint.
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 401,
        headers: { get: (h: string) => (h === 'content-type' ? 'application/json' : null) },
        json: async () => ({
          error: ErrorType.Authentication,
          message: 'Authentication required',
          status: 401,
        }),
        clone() {
          return this;
        },
      });

      await expect(ping(apiHttp)).rejects.toMatchObject({
        type: ErrorType.Authentication,
        status: 401,
      });
    });
  });

  describe('getLimits', () => {
    it('should fetch platform limits', async () => {
      const mockLimits = {
        maxFileSize: 10 * 1024 * 1024,
        maxFilesCount: 1000,
        maxTotalSize: 100 * 1024 * 1024,
      };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockLimits));

      const result = await getLimits(apiHttp);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/limits',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
      expect(result).toEqual(mockLimits);
    });
  });

  describe('Cookie-based Authentication', () => {
    let apiHttpCookieAuth: ApiHttp;

    beforeEach(() => {
      vi.clearAllMocks();
      // First-party browser app: session opts into cookie-based auth
      apiHttpCookieAuth = new ApiHttp({
        apiUrl: 'https://api.test.com',
        session: true,
        getAuthHeaders: () => ({}),
      });
    });

    it('should include credentials when session is true', async () => {
      (global.fetch as any).mockResolvedValue(
        createMockResponse({ success: true, message: 'pong' }),
      );

      await ping(apiHttpCookieAuth);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/ping',
        expect.objectContaining({
          method: 'GET',
          credentials: 'include',
          headers: expect.not.objectContaining({
            Authorization: expect.any(String),
          }),
        }),
      );
    });

    it('should NOT include credentials when session is not set', async () => {
      const apiHttpDefault = new ApiHttp({
        apiUrl: 'https://api.test.com',
        getAuthHeaders: () => ({}),
      });
      (global.fetch as any).mockResolvedValue(
        createMockResponse({ success: true, message: 'pong' }),
      );

      await ping(apiHttpDefault);

      const fetchCall = (fetch as any).mock.calls[0][1];
      expect(fetchCall.credentials).toBeUndefined();
    });

    it('should NOT include credentials when Authorization header is present', async () => {
      const apiHttpWithKey = new ApiHttp({
        apiUrl: 'https://api.test.com',
        session: true,
        getAuthHeaders: () => ({ Authorization: 'Bearer test-key' }),
      });
      (global.fetch as any).mockResolvedValue(
        createMockResponse({ success: true, message: 'pong' }),
      );

      await ping(apiHttpWithKey);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/ping',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
          }),
        }),
      );

      const fetchCall = (fetch as any).mock.calls[0][1];
      expect(fetchCall.credentials).toBeUndefined();
    });

    it('should support deploy tokens via callback', async () => {
      const apiHttpWithToken = new ApiHttp({
        apiUrl: 'https://api.test.com',
        getAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
      });
      (global.fetch as any).mockResolvedValue(
        createMockResponse({ success: true, message: 'pong' }),
      );

      await ping(apiHttpWithToken);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/ping',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );

      const fetchCall = (fetch as any).mock.calls[0][1];
      expect(fetchCall.credentials).toBeUndefined();
    });

    it('should use cookies for account operations', async () => {
      const mockAccount = { account: 'user123', name: 'Test User', email: 'test@example.com' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockAccount));

      const result = await getAccount(apiHttpCookieAuth);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/account',
        expect.objectContaining({
          method: 'GET',
          credentials: 'include',
          headers: expect.not.objectContaining({
            Authorization: expect.any(String),
          }),
        }),
      );
      expect(result).toEqual(mockAccount);
    });

    it('should use cookies for deployment operations', async () => {
      const mockDeployment = { deployment: 'dep123', url: 'https://example.com' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDeployment));

      const mockFiles = [
        { path: 'index.html', content: Buffer.from('<html></html>'), md5: 'abc123', size: 13 },
      ];

      const result = await deploymentsOver(apiHttpCookieAuth).upload(
        mockFiles as unknown as DeployInput,
        {},
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/deployments',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: expect.not.objectContaining({
            Authorization: expect.any(String),
          }),
        }),
      );
      expect(result).toEqual(mockDeployment);
    });
  });

  describe('the caller header', () => {
    // `caller` is INSTANCE identity, like the credential — so it rides every
    // request rather than any one operation, which is why these rows send two.
    it('sends X-Caller on every request when the caller option is set', async () => {
      // Caller is instance identity metadata, like the credential: the API
      // buckets rate limits by X-Caller on every write, so the header rides
      // every request, not just deploys.
      const api = new ApiHttp({
        apiUrl: 'https://api.test.com',
        caller: 'end-user-42',
        getAuthHeaders: () => ({}),
      });
      const mockFiles = [
        { path: 'index.html', content: Buffer.from('<html></html>'), md5: 'abc123', size: 13 },
      ];
      (global.fetch as any).mockResolvedValue(
        createMockResponse({
          deployment: 'test-deployment',
          files: 1,
          size: 13,
        }),
      );

      await deploy(api, mockFiles);
      await ping(api);

      for (const call of (global.fetch as any).mock.calls) {
        expect(call[1].headers).toEqual(expect.objectContaining({ 'X-Caller': 'end-user-42' }));
      }
    });

    it('should not include X-Caller header when caller option is not provided', async () => {
      const mockFiles = [
        { path: 'index.html', content: Buffer.from('<html></html>'), md5: 'abc123', size: 13 },
      ];
      (global.fetch as any).mockResolvedValue(
        createMockResponse({
          deployment: 'test-deployment',
          files: 1,
          size: 13,
        }),
      );

      await deploy(apiHttp, mockFiles);

      const fetchCall = (global.fetch as any).mock.calls[0];
      const headers = fetchCall[1].headers;
      expect(headers['X-Caller']).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should handle 401 authentication errors', async () => {
      (global.fetch as any).mockResolvedValue(
        createMockResponse({ error: 'authentication_failed', message: 'Invalid API key' }, 401),
      );

      await expect(ping(apiHttp)).rejects.toThrow(ShipError);
      try {
        await ping(apiHttp);
      } catch (e: any) {
        expect(e.type).toBe('authentication_failed');
      }
    });

    it('should handle 429 rate-limit errors with body message preserved', async () => {
      // Custom mock — the shared createMockResponse returns "15" for every
      // header, which defeats content-type sniffing in the new fromHttpResponse
      // path. Build a real Response-shaped mock here.
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 429,
        headers: {
          get: vi
            .fn()
            .mockImplementation((header: string) =>
              header === 'content-type' ? 'application/json' : null,
            ),
        },
        json: async () => ({
          error: 'rate_limit_exceeded',
          message: 'Slow down',
          status: 429,
        }),
      });

      try {
        await ping(apiHttp);
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ShipError);
        expect(e.type).toBe(ErrorType.RateLimit);
        expect(e.status).toBe(429);
        expect(e.message).toBe('Slow down');
      }
    });

    it('should handle non-JSON error responses', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        headers: {
          get: vi.fn().mockImplementation((header: string) => {
            if (header === 'content-type') return 'text/plain';
            return null;
          }),
        },
        text: async () => 'Internal Server Error',
      });

      await expect(ping(apiHttp)).rejects.toThrow('Internal Server Error');
    });

    it('should fall back to operation-name message when error body fails to parse', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        headers: {
          get: vi.fn().mockImplementation((header: string) => {
            if (header === 'content-type') return 'application/json';
            return null;
          }),
        },
        json: async () => {
          throw new Error('JSON parse error');
        },
      });

      await expect(ping(apiHttp)).rejects.toThrow('Ping failed');
    });

    it('should handle AbortError', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      (global.fetch as any).mockRejectedValue(abortError);

      await expect(ping(apiHttp)).rejects.toThrow('cancelled');
    });

    it('should handle TypeError fetch errors as network errors', async () => {
      const typeError = new TypeError('fetch failed');
      (global.fetch as any).mockRejectedValue(typeError);

      await expect(ping(apiHttp)).rejects.toThrow('fetch failed');
    });
  });

  describe('timeout functionality', () => {
    it('should use custom timeout from options', async () => {
      const apiWithTimeout = new ApiHttp({
        apiUrl: 'https://api.test.com',
        getAuthHeaders: () => ({}),
        timeout: 5000,
      });
      (global.fetch as any).mockResolvedValue(createMockResponse({ success: true }));

      await ping(apiWithTimeout);

      // Verify the signal was passed (indicates timeout setup)
      const fetchCall = (fetch as any).mock.calls[0][1];
      expect(fetchCall.signal).toBeDefined();
    });
  });

  describe('fetch injection', () => {
    it('should use globalThis.fetch by default', async () => {
      (global.fetch as any).mockResolvedValue(
        createMockResponse({ success: true, timestamp: 1_700_000_000 }),
      );

      const api = new ApiHttp(mockOptions);
      const result = await ping(api);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.com/ping',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual({ success: true, timestamp: 1_700_000_000 });
    });

    it('should route every API call through the injected fetcher and bypass globalThis.fetch', async () => {
      const injected = vi
        .fn<Fetch>()
        .mockResolvedValue(
          createMockResponse({ success: true, message: 'pong' }) as unknown as Response,
        );

      const api = new ApiHttp({ ...mockOptions, fetch: injected });
      await ping(api);
      await getAccount(api);
      await listDeployments(api);

      expect(injected).toHaveBeenCalledTimes(3);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should pass the same RequestInit shape to the injected fetcher (headers, method, signal)', async () => {
      const injected = vi
        .fn<Fetch>()
        .mockResolvedValue(
          createMockResponse({ success: true, message: 'pong' }) as unknown as Response,
        );

      const api = new ApiHttp({ ...mockOptions, fetch: injected });
      await ping(api);

      const [url, init] = injected.mock.calls[0];
      expect(url).toBe('https://api.test.com/ping');
      expect(init?.method).toBe('GET');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-api-key' });
      expect(init?.signal).toBeDefined();
    });

    it('should normalise injected-fetcher throws via ShipError.fromFetchError', async () => {
      const injected = vi.fn<Fetch>().mockRejectedValue(new TypeError('fetch failed'));

      const api = new ApiHttp({ ...mockOptions, fetch: injected });

      await expect(ping(api)).rejects.toBeInstanceOf(ShipError);
      await expect(ping(api)).rejects.toThrow('fetch failed');
    });

    it('should normalise injected-fetcher non-OK responses via ShipError.fromHttpResponse', async () => {
      const injected = vi.fn<Fetch>().mockResolvedValue({
        ok: false,
        status: 401,
        headers: {
          get: vi
            .fn()
            .mockImplementation((header: string) =>
              header === 'content-type' ? 'application/json' : null,
            ),
        },
        json: async () => ({ error: ErrorType.Authentication, message: 'bad key', status: 401 }),
      } as unknown as Response);

      const api = new ApiHttp({ ...mockOptions, fetch: injected });

      await expect(ping(api)).rejects.toMatchObject({
        type: ErrorType.Authentication,
        status: 401,
      });
    });

    it('should emit request/response events for injected-fetcher calls', async () => {
      const injected = vi
        .fn<Fetch>()
        .mockResolvedValue(
          createMockResponse({ success: true, message: 'pong' }) as unknown as Response,
        );
      const api = new ApiHttp({ ...mockOptions, fetch: injected });

      const onRequest = vi.fn();
      const onResponse = vi.fn();
      api.on('request', onRequest);
      api.on('response', onResponse);

      await ping(api);

      expect(onRequest).toHaveBeenCalledWith(
        'https://api.test.com/ping',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(onResponse).toHaveBeenCalledWith(expect.anything(), 'https://api.test.com/ping');
    });

    it('should emit retry then a terminal error event when injected fetcher throws', async () => {
      const injected = vi.fn<Fetch>().mockRejectedValue(new TypeError('fetch failed'));
      const api = new ApiHttp({ ...mockOptions, fetch: injected });

      const onRetry = vi.fn();
      const onError = vi.fn();
      api.on('retry', onRetry);
      api.on('error', onError);

      await expect(ping(api)).rejects.toBeInstanceOf(ShipError);
      // Three attempts, three events — but only the last one ended the call.
      expect(injected).toHaveBeenCalledTimes(3);
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(
        expect.any(ShipError),
        'https://api.test.com/ping',
        expect.any(Number),
      );
      expect(onError).toHaveBeenCalledWith(expect.any(ShipError), 'https://api.test.com/ping');
    });
  });
});
