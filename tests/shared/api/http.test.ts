import { ErrorType, ShipError } from '@shipstatic/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiHttp } from '../../../src/shared/api/http';
import type { Fetch } from '../../../src/shared/types';
import { deployToken } from '../../fixtures/builders';

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

/**
 * The multipart body the most recent request put on the wire.
 *
 * The body creator used to be INJECTED here as a `vi.fn`, so these rows read
 * the context it was handed. One builder serves both platforms now, so there
 * is nothing left to inject — and reading the real `FormData` is the stronger
 * assertion anyway: it observes the artifact the API receives rather than what
 * a collaborator was told to build.
 */
const lastDeployBody = (): FormData => (global.fetch as any).mock.calls.at(-1)[1].body;

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
        await expect(api.ping()).resolves.toBeDefined();
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
        await api.ping();
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

      await expect(api.ping()).rejects.toBe(providerError);
      expect(errors).toEqual([providerError]);
    });
  });

  describe('ping', () => {
    it('should make GET request to /ping endpoint', async () => {
      (global.fetch as any).mockResolvedValue(
        createMockResponse({ success: true, timestamp: 1_700_000_000 }),
      );

      const result = await apiHttp.ping();

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

      await expect(apiHttp.ping()).rejects.toThrow('Network error');
    });

    it('should handle API errors', async () => {
      (global.fetch as any).mockResolvedValue(
        createMockResponse({ error: 'Internal server error' }, 500),
      );

      await expect(apiHttp.ping()).rejects.toThrow();
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

      await expect(apiHttp.ping()).rejects.toMatchObject({
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

      await expect(apiHttp.ping()).rejects.toMatchObject({
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

      const result = await apiHttp.getLimits();

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

  describe('deploy', () => {
    it('should deploy files array', async () => {
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

      const result = await apiHttp.deploy(mockFiles);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/deployments',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
      expect(result).toEqual({
        deployment: 'test-deployment',
        files: 1,
        size: 13,
      });
    });

    it('sends Idempotency-Key when given one, and omits the header when not', async () => {
      // Agents retry on timeout; the same key on the retry replays the
      // original 201 instead of creating a second deployment. The header is
      // what makes that reachable — the capability existed on the API long
      // before the SDK could send it.
      const mockFiles = [
        { path: 'index.html', content: Buffer.from('<html></html>'), md5: 'abc123', size: 13 },
      ];
      (global.fetch as any).mockResolvedValue(createMockResponse({ deployment: 'd' }));

      await apiHttp.deploy(mockFiles, { idempotencyKey: '  run-42  ' });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/deployments',
        expect.objectContaining({
          // Trimmed, matching what the API compares against.
          headers: expect.objectContaining({ 'Idempotency-Key': 'run-42' }),
        }),
      );

      // Absent by omission rather than by empty string: a header the caller
      // did not ask for must not appear at all.
      (global.fetch as any).mockClear();
      await apiHttp.deploy(mockFiles);
      const sent = (global.fetch as any).mock.calls[0][1].headers;
      expect(Object.keys(sent)).not.toContain('Idempotency-Key');
    });

    it('refuses an over-long idempotency key before any request', async () => {
      const mockFiles = [
        { path: 'index.html', content: Buffer.from('<html></html>'), md5: 'abc123', size: 13 },
      ];
      (global.fetch as any).mockClear();

      await expect(
        apiHttp.deploy(mockFiles, { idempotencyKey: 'x'.repeat(257) }),
      ).rejects.toMatchObject({ type: ErrorType.Validation });
      // The deploy body is expensive to build; the verdict is reached first.
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should deploy files array with labels', async () => {
      const mockFiles = [
        { path: 'index.html', content: Buffer.from('<html></html>'), md5: 'abc123', size: 13 },
      ];
      const labels = ['production', 'v1.0.0'];
      (global.fetch as any).mockResolvedValue(
        createMockResponse({
          deployment: 'test-deployment',
          files: 1,
          size: 13,
          labels: labels,
        }),
      );

      const result = await apiHttp.deploy(mockFiles, { labels });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/deployments',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
      expect(result).toEqual({
        deployment: 'test-deployment',
        files: 1,
        size: 13,
        labels: labels,
      });
    });

    it('should handle empty files array', async () => {
      await expect(apiHttp.deploy([])).rejects.toThrow('No files to deploy');
    });

    it('runs the config pre-flight before anything reaches the wire', async () => {
      // The pre-flight's own cases live with the validator
      // (`tests/shared/lib/validation.unit.test.ts`). What belongs here is
      // the transport fact: a bad config costs no upload.
      const files = [
        { path: 'index.html', content: Buffer.from('<html></html>'), md5: 'def456', size: 13 },
        { path: 'ship.json', content: Buffer.from('{"redirects":[],}'), md5: 'abc123', size: 17 },
      ];

      await expect(apiHttp.deploy(files)).rejects.toMatchObject({ type: ErrorType.Config });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should identify itself as sdk when via is not provided', async () => {
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

      await apiHttp.deploy(mockFiles);

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe('https://api.test.com/deployments');
      expect(fetchCall[1].method).toBe('POST');
      // Every deploy carries an attribution: a direct SDK call is `sdk`, so an
      // absent `via` on the wire means an unattributed caller, never the SDK.
      expect(lastDeployBody().get('via')).toBe('sdk');
    });

    it('should let an explicit via win over the sdk default', async () => {
      const mockFiles = [
        { path: 'index.html', content: Buffer.from('<html></html>'), md5: 'abc123', size: 13 },
      ];
      (global.fetch as any).mockResolvedValue(
        createMockResponse({ deployment: 'test-deployment', files: 1, size: 13, via: 'web' }),
      );

      await apiHttp.deploy(mockFiles, { via: 'web' });

      expect(lastDeployBody().get('via')).toBe('web');
    });

    it('should include custom via field when provided', async () => {
      const mockFiles = [
        { path: 'index.html', content: Buffer.from('<html></html>'), md5: 'abc123', size: 13 },
      ];
      (global.fetch as any).mockResolvedValue(
        createMockResponse({
          deployment: 'test-deployment',
          files: 1,
          size: 13,
          via: 'cli',
        }),
      );

      const result = await apiHttp.deploy(mockFiles, { via: 'cli' });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/deployments',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result.via).toBe('cli');
    });

    it('forwards the captcha proof into the deploy body', async () => {
      // The anonymous human channel: the reCAPTCHA proof rides the deploy
      // body as a form field — the API grants the public-account identity
      // per request. This row used to assert that the proof reached the body
      // CREATOR, which is one seam short of the claim: the field is what the
      // API reads, so the field is what is read back here.
      const api = new ApiHttp({
        apiUrl: 'https://api.test.com',
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

      await api.deploy(mockFiles, { captcha: 'captcha-proof', via: 'web' });

      expect(lastDeployBody().get('captcha')).toBe('captcha-proof');
      expect(lastDeployBody().get('via')).toBe('web');
    });

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

      await api.deploy(mockFiles);
      await api.ping();

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

      await apiHttp.deploy(mockFiles);

      const fetchCall = (global.fetch as any).mock.calls[0];
      const headers = fetchCall[1].headers;
      expect(headers['X-Caller']).toBeUndefined();
    });

    it('should use deployEndpoint from constructor when provided', async () => {
      const customApiHttp = new ApiHttp({
        ...mockOptions,
        deployEndpoint: '/upload',
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

      await customApiHttp.deploy(mockFiles);

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe('https://api.test.com/upload');
    });

    it('should default to /deployments endpoint when deployEndpoint not provided', async () => {
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

      await apiHttp.deploy(mockFiles);

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe('https://api.test.com/deployments');
    });
  });

  describe('listDeployments', () => {
    it('should list deployments', async () => {
      const mockDeployments = {
        deployments: [
          { deployment: 'test-1', status: 'success' },
          { deployment: 'test-2', status: 'pending' },
        ],
      };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDeployments));

      const result = await apiHttp.listDeployments();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/deployments',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
      expect(result).toEqual(mockDeployments);
    });

    it('serializes pagination options as limit/cursor query params', async () => {
      (global.fetch as any).mockResolvedValue(
        createMockResponse({ deployments: [], cursor: null }),
      );

      await apiHttp.listDeployments({ limit: 2, cursor: 'abc123' });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/deployments?limit=2&cursor=abc123',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('sends no query string when no pagination options are given', async () => {
      (global.fetch as any).mockResolvedValue(
        createMockResponse({ deployments: [], cursor: null }),
      );

      await apiHttp.listDeployments({});

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/deployments',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('getDeployment', () => {
    it('should get specific deployment', async () => {
      const mockDeployment = { deployment: 'test-deployment', status: 'success' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDeployment));

      const result = await apiHttp.getDeployment('test-deployment');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/deployments/test-deployment',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
      expect(result).toEqual(mockDeployment);
    });
  });

  describe('deleteDeployment', () => {
    it('should delete deployment', async () => {
      (global.fetch as any).mockResolvedValue(createMockResponse(undefined, 204));

      const result = await apiHttp.deleteDeployment('test-deployment');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/deployments/test-deployment',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
      expect(result).toBeUndefined();
    });
  });

  describe('getAccount', () => {
    it('should get account information', async () => {
      const mockAccount = { account: 'test-account', email: 'test@example.com' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockAccount));

      const result = await apiHttp.getAccount();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/account',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
      expect(result).toEqual(mockAccount);
    });
  });

  describe('checkSPA', () => {
    it('should return false when no index.html file present', async () => {
      const mockFiles = [
        { path: 'main', content: Buffer.from('console.log("hello")'), md5: 'abc123', size: 20 },
        { path: 'style.css', content: Buffer.from('body {}'), md5: 'def456', size: 7 },
      ];

      const result = await apiHttp.checkSPA(mockFiles);

      expect(result).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should return false when index.html is too large', async () => {
      const largeContent = Buffer.alloc(150 * 1024, 'x'); // 150KB
      const mockFiles = [
        { path: 'index.html', content: largeContent, md5: 'abc123', size: largeContent.length },
      ];

      const result = await apiHttp.checkSPA(mockFiles);

      expect(result).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should return false when index.html content type is unsupported', async () => {
      const mockFiles = [
        { path: 'index.html', content: 123 as any, md5: 'abc123', size: 50 }, // Invalid content type
      ];

      const result = await apiHttp.checkSPA(mockFiles);

      expect(result).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should make API request with Buffer content', async () => {
      const indexContent = '<html><head><script src="app.js"></script></head></html>';
      const mockFiles = [
        {
          path: 'index.html',
          content: Buffer.from(indexContent),
          md5: 'abc123',
          size: indexContent.length,
        },
        { path: 'app', content: Buffer.from('app code'), md5: 'def456', size: 8 },
      ];
      (global.fetch as any).mockResolvedValue(createMockResponse({ isSPA: true }));

      const result = await apiHttp.checkSPA(mockFiles);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/spa-check',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            files: ['index.html', 'app'],
            index: indexContent,
          }),
        }),
      );
      expect(result).toBe(true);
    });

    it('should return false for unsupported content types (simulating Blob failure)', async () => {
      // Test that when content type is not Buffer and browser objects fail, we return false
      const mockFiles = [
        { path: 'index.html', content: { someObject: true } as any, md5: 'abc123', size: 50 },
      ];

      const result = await apiHttp.checkSPA(mockFiles);

      expect(result).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should handle different index.html path formats', async () => {
      const indexContent = '<html></html>';
      const mockFiles = [
        {
          path: '/index.html',
          content: Buffer.from(indexContent),
          md5: 'abc123',
          size: indexContent.length,
        }, // Leading slash
      ];
      (global.fetch as any).mockResolvedValue(createMockResponse({ isSPA: true }));

      const result = await apiHttp.checkSPA(mockFiles);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/spa-check',
        expect.objectContaining({
          body: JSON.stringify({
            files: ['/index.html'],
            index: indexContent,
          }),
        }),
      );
      expect(result).toBe(true);
    });

    it('should handle API errors gracefully', async () => {
      const indexContent = '<html></html>';
      const mockFiles = [
        {
          path: 'index.html',
          content: Buffer.from(indexContent),
          md5: 'abc123',
          size: indexContent.length,
        },
      ];
      (global.fetch as any).mockResolvedValue(
        createMockResponse({ error: 'Service unavailable' }, 503),
      );

      await expect(apiHttp.checkSPA(mockFiles)).rejects.toThrow();
    });

    it('should send file paths in correct order', async () => {
      const indexContent = '<html></html>';
      const mockFiles = [
        { path: 'components/App', content: Buffer.from('app'), md5: 'abc', size: 3 },
        {
          path: 'index.html',
          content: Buffer.from(indexContent),
          md5: 'def',
          size: indexContent.length,
        },
        { path: 'assets/style.css', content: Buffer.from('css'), md5: 'ghi', size: 3 },
      ];
      (global.fetch as any).mockResolvedValue(createMockResponse({ isSPA: true }));

      await apiHttp.checkSPA(mockFiles);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/spa-check',
        expect.objectContaining({
          body: JSON.stringify({
            files: ['components/App', 'index.html', 'assets/style.css'],
            index: indexContent,
          }),
        }),
      );
    });
  });

  describe('domain operations', () => {
    it('should set domain (update - 200 status)', async () => {
      const mockDomain = { domain: 'staging', deployment: 'test-deployment' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDomain, 200));

      const result = await apiHttp.setDomain('staging', 'test-deployment');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains/staging',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ deployment: 'test-deployment' }),
        }),
      );
      expect(result).toEqual({ ...mockDomain, isCreate: false });
    });

    it('should set domain (create - 201 status)', async () => {
      const mockDomain = { domain: 'new-domain', deployment: 'test-deployment' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDomain, 201));

      const result = await apiHttp.setDomain('new-domain', 'test-deployment');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains/new-domain',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ deployment: 'test-deployment' }),
        }),
      );
      expect(result).toEqual({ ...mockDomain, isCreate: true });
    });

    it('should set domain with labels', async () => {
      const labels = ['production', 'v2.0.0'];
      const mockDomain = { domain: 'prod', deployment: 'test-deployment', labels };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDomain, 201));

      const result = await apiHttp.setDomain('prod', 'test-deployment', labels);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains/prod',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ deployment: 'test-deployment', labels }),
        }),
      );
      expect(result).toEqual({ ...mockDomain, isCreate: true });
    });

    it('should get domain', async () => {
      const mockDomain = { domain: 'staging', deployment: 'test-deployment' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDomain));

      const result = await apiHttp.getDomain('staging');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains/staging',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
      expect(result).toEqual(mockDomain);
    });

    it('should list domains', async () => {
      const mockDomains = {
        domains: [
          { domain: 'staging', deployment: 'test-1' },
          { domain: 'production', deployment: 'test-2' },
        ],
      };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDomains));

      const result = await apiHttp.listDomains();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
      expect(result).toEqual(mockDomains);
    });

    it('should delete domain', async () => {
      (global.fetch as any).mockResolvedValue(createMockResponse(undefined, 204));

      const result = await apiHttp.deleteDomain('staging');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains/staging',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
      expect(result).toBeUndefined();
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

      await apiHttpCookieAuth.ping();

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

      await apiHttpDefault.ping();

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

      await apiHttpWithKey.ping();

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

      await apiHttpWithToken.ping();

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

      const result = await apiHttpCookieAuth.getAccount();

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

      const result = await apiHttpCookieAuth.deploy(mockFiles, {});

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

  describe('token operations', () => {
    it('should create token with ttl', async () => {
      const mockResponse = {
        token: 'a1b2c3d',
        secret: deployToken('1'),
        expires: 1234567890,
        labels: [],
      };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockResponse));

      const result = await apiHttp.createToken(3600);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/tokens',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ ttl: 3600 }),
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should create token with labels', async () => {
      const mockResponse = {
        token: 'd3f4567',
        secret: deployToken('d'),
        expires: 1234567890,
        labels: ['cicd', 'deploy'],
      };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockResponse));

      const result = await apiHttp.createToken(undefined, ['cicd', 'deploy']);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/tokens',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ labels: ['cicd', 'deploy'] }),
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should create token with both ttl and labels', async () => {
      const mockResponse = {
        token: 'g7h8i9j',
        secret: 'deploy-g7h8i9j0123456789abcdef0123456789abcdef0123456789abcdef01234567',
        expires: 1234567890,
        labels: ['production'],
      };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockResponse));

      const result = await apiHttp.createToken(7200, ['production']);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/tokens',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ ttl: 7200, labels: ['production'] }),
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should create token without parameters', async () => {
      const mockResponse = {
        token: 't0kn001',
        secret: 'deploy-t0kn0010123456789abcdef0123456789abcdef0123456789abcdef01234567',
        expires: 1234567890,
        labels: [],
      };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockResponse));

      const result = await apiHttp.createToken();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/tokens',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({}),
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should list tokens', async () => {
      const mockResponse = { tokens: [{ token: 'token-1' }, { token: 'token-2' }] };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockResponse));

      const result = await apiHttp.listTokens();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/tokens',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should delete token', async () => {
      (global.fetch as any).mockResolvedValue(createMockResponse(undefined, 204));

      await apiHttp.deleteToken('deploy-to-delete');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/tokens/deploy-to-delete',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('domain DNS operations', () => {
    it('should get domain DNS info', async () => {
      const mockResponse = { domain: 'example.com', dns: { type: 'CNAME', value: 'target.com' } };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockResponse));

      const result = await apiHttp.getDomainDns('example.com');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains/example.com/dns',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should get domain records', async () => {
      const mockResponse = { domain: 'example.com', records: [{ type: 'A', value: '1.2.3.4' }] };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockResponse));

      const result = await apiHttp.getDomainRecords('example.com');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains/example.com/records',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should get domain share hash', async () => {
      const mockResponse = { domain: 'example.com', hash: 'share-hash-123' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockResponse));

      const result = await apiHttp.getDomainShare('example.com');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains/example.com/share',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should verify domain', async () => {
      const mockResponse = { message: 'DNS verification queued successfully' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockResponse));

      const result = await apiHttp.verifyDomain('example.com');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains/example.com/verify',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should encode special characters in domain names', async () => {
      // Input that actually requires encoding. The previous version passed
      // `test.example.com`, whose encoded form is itself — so the assertion
      // held identically with no `encodeURIComponent` call at all.
      (global.fetch as any).mockResolvedValue(
        createMockResponse({ domain: 'tëst.example.com', dns: {} }),
      );

      await apiHttp.getDomainDns('tëst.example.com');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains/t%C3%ABst.example.com/dns',
        expect.anything(),
      );
    });

    it('should encode a path separator so it cannot forge a sub-route', async () => {
      // The SDK is a transparent pipe and does not validate domain names, so
      // encoding is the only thing standing between a hostile name and a
      // different endpoint.
      (global.fetch as any).mockResolvedValue(createMockResponse({ domain: 'x', dns: {} }));

      await apiHttp.getDomainDns('evil.com/../../account');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains/evil.com%2F..%2F..%2Faccount/dns',
        expect.anything(),
      );
    });
  });

  describe('error handling', () => {
    it('should handle 401 authentication errors', async () => {
      (global.fetch as any).mockResolvedValue(
        createMockResponse({ error: 'authentication_failed', message: 'Invalid API key' }, 401),
      );

      await expect(apiHttp.ping()).rejects.toThrow(ShipError);
      try {
        await apiHttp.ping();
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
        await apiHttp.ping();
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

      await expect(apiHttp.ping()).rejects.toThrow('Internal Server Error');
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

      await expect(apiHttp.ping()).rejects.toThrow('Ping failed');
    });

    it('should handle AbortError', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      (global.fetch as any).mockRejectedValue(abortError);

      await expect(apiHttp.ping()).rejects.toThrow('cancelled');
    });

    it('should handle TypeError fetch errors as network errors', async () => {
      const typeError = new TypeError('fetch failed');
      (global.fetch as any).mockRejectedValue(typeError);

      await expect(apiHttp.ping()).rejects.toThrow('fetch failed');
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

      await apiWithTimeout.ping();

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
      const result = await api.ping();

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
      await api.ping();
      await api.getAccount();
      await api.listDeployments();

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
      await api.ping();

      const [url, init] = injected.mock.calls[0];
      expect(url).toBe('https://api.test.com/ping');
      expect(init?.method).toBe('GET');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-api-key' });
      expect(init?.signal).toBeDefined();
    });

    it('should normalise injected-fetcher throws via ShipError.fromFetchError', async () => {
      const injected = vi.fn<Fetch>().mockRejectedValue(new TypeError('fetch failed'));

      const api = new ApiHttp({ ...mockOptions, fetch: injected });

      await expect(api.ping()).rejects.toBeInstanceOf(ShipError);
      await expect(api.ping()).rejects.toThrow('fetch failed');
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

      await expect(api.ping()).rejects.toMatchObject({
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

      await api.ping();

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

      await expect(api.ping()).rejects.toBeInstanceOf(ShipError);
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

  describe('setDomain without deployment', () => {
    it('should set domain without deployment parameter', async () => {
      const mockDomain = { domain: 'staging' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDomain, 200));

      const result = await apiHttp.setDomain('staging');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains/staging',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({}),
        }),
      );
      expect(result).toEqual({ ...mockDomain, isCreate: false });
    });

    it('should set domain with empty labels array (included in body to clear labels)', async () => {
      const mockDomain = { domain: 'staging', deployment: 'dep1', labels: [] };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDomain, 200));

      const result = await apiHttp.setDomain('staging', 'dep1', []);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains/staging',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ deployment: 'dep1', labels: [] }),
        }),
      );
      expect(result).toEqual({ ...mockDomain, isCreate: false });
    });
  });
});
