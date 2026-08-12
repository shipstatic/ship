import { ShipError } from '@shipstatic/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiHttp } from '../../../src/shared/api/http';

// Mock deploy body creator
const mockCreateDeployBody = async () => ({
  body: new ArrayBuffer(0),
  headers: { 'Content-Type': 'multipart/form-data' },
});

/** A real Response — see the note in `http.test.ts` on why this is not a fake. */
function createMockResponse(data: any, status = 200) {
  const hasBody = data !== undefined && status !== 204;
  return new Response(hasBody ? JSON.stringify(data) : null, {
    status,
    headers: hasBody ? { 'Content-Type': 'application/json' } : {},
  });
}

/**
 * A fetch that never settles until its signal aborts — the only shape that can
 * observe a timeout. Mocking fetch to reject with a hand-made `AbortError`
 * (as this file used to) asserts nothing about whether the SDK aborts anything:
 * the rejection was authored by the test.
 */
function hangingFetch(): ReturnType<typeof vi.fn> {
  // The platform rejects with the signal's own REASON, verbatim — captured
  // 2026-08-12 across Node, Bun, chromium, firefox and webkit. This fake
  // fabricated an `AbortError` instead, which made it blind to the one
  // property the SDK now depends on: its own timeout aborts with a
  // `TimeoutError` reason so it can be told apart from a caller's cancel.
  // A fake that authors the answer cannot check it.
  const fallback = () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    return error;
  };

  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        // Faithful to the platform on BOTH paths: a real fetch rejects at once
        // when handed an already-aborted signal, and never emits a second
        // `abort` event for one. Listening only for a future event made this
        // fake hang where the platform would have rejected.
        if (init.signal?.aborted) {
          reject(init.signal.reason ?? fallback());
          return;
        }
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? fallback()));
      }),
  );
}

describe('ApiHttp Timeout & Cancellation', () => {
  let apiHttp: ApiHttp;

  beforeEach(() => {
    global.fetch = vi.fn();

    apiHttp = new ApiHttp({
      apiUrl: 'https://api.test.com',
      getAuthHeaders: () => ({ Authorization: 'Bearer test-key' }),
      createDeployBody: mockCreateDeployBody,
      // The subject here is the CEILING, not the retry loop.
      maxRetries: 0,
      timeout: 5000,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('timeout configuration', () => {
    it('should pass signal to fetch for timeout support', async () => {
      (global.fetch as any).mockResolvedValue(createMockResponse({ success: true }));

      await apiHttp.ping();

      const fetchCall = (fetch as any).mock.calls[0][1];
      expect(fetchCall.signal).toBeDefined();
      expect(fetchCall.signal).toBeInstanceOf(AbortSignal);
    });

    it('aborts at exactly the constructor timeout, not before', async () => {
      vi.useFakeTimers();
      try {
        global.fetch = hangingFetch() as any;
        const api = new ApiHttp({
          apiUrl: 'https://api.test.com',
          getAuthHeaders: () => ({}),
          createDeployBody: mockCreateDeployBody,
          // The subject here is the CEILING, not the retry loop.
          maxRetries: 0,
          timeout: 1000,
        });

        const pending = api.ping();
        const settled = vi.fn();
        pending.catch(settled);

        await vi.advanceTimersByTimeAsync(999);
        expect(settled).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).rejects.toMatchObject({ type: 'network_error' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('uses the 30s default when the constructor names no timeout', async () => {
      vi.useFakeTimers();
      try {
        global.fetch = hangingFetch() as any;
        const api = new ApiHttp({
          apiUrl: 'https://api.test.com',
          getAuthHeaders: () => ({}),
          createDeployBody: mockCreateDeployBody,
          // The subject here is the CEILING, not the retry loop.
          maxRetries: 0,
        });

        const pending = api.ping();
        const settled = vi.fn();
        pending.catch(settled);

        await vi.advanceTimersByTimeAsync(29_999);
        expect(settled).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).rejects.toMatchObject({ type: 'network_error' });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  /**
   * THE PAIR. Two deadlines reach the same `fetch` through the same composed
   * signal, and the whole of the retry policy rests on telling them apart:
   * the SDK's own ceiling is a fault worth another attempt, a caller's cancel
   * is an instruction.
   *
   * Both used to abort BARE, so both arrived as `AbortError` and both read as
   * `Cancelled` — "you cancelled this" for a deadline nobody set by hand. The
   * fake hid it besides, by authoring an `AbortError` of its own regardless of
   * the reason. Nothing here is observable without a fake that relays the
   * signal's reason the way the platform does.
   */
  describe('the SDK timeout and a caller cancel are told apart', () => {
    const hangingApi = (options: Record<string, unknown> = {}) =>
      new ApiHttp({
        apiUrl: 'https://api.test.com',
        getAuthHeaders: () => ({}),
        createDeployBody: mockCreateDeployBody,
        timeout: 1000,
        ...options,
      });

    it("the SDK's own ceiling is a deadline: Network, and the sentence says so", async () => {
      vi.useFakeTimers();
      try {
        global.fetch = hangingFetch() as any;
        const pending = hangingApi({ maxRetries: 0 }).ping();
        pending.catch(() => {});

        await vi.advanceTimersByTimeAsync(1000);
        await expect(pending).rejects.toMatchObject({
          type: 'network_error',
          message: 'Ping timed out',
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('and is RETRIED — the attempt failed, the caller did not say stop', async () => {
      vi.useFakeTimers();
      try {
        const fetchImpl = hangingFetch();
        global.fetch = fetchImpl as any;
        const pending = hangingApi().ping();
        pending.catch(() => {});

        // Three ceilings and two backoffs (capped at 2s each) is a generous
        // envelope; what matters is that a second attempt happens at all.
        await vi.advanceTimersByTimeAsync(1000 * 3 + 2000 * 2 + 10);
        await expect(pending).rejects.toMatchObject({ type: 'network_error' });
        expect(fetchImpl.mock.calls.length).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a caller cancel is an instruction: Cancelled, and NOT retried', async () => {
      const controller = new AbortController();
      const fetchImpl = hangingFetch();
      global.fetch = fetchImpl as any;

      const files = [{ path: 'a.txt', content: Buffer.from('a'), size: 1, md5: 'x' }];
      const pending = hangingApi().deploy(files, { signal: controller.signal });
      pending.catch(() => {});
      controller.abort();

      await expect(pending).rejects.toMatchObject({ type: 'operation_cancelled' });
      // The one that matters: a cancel the client retried through would be the
      // client ignoring the caller.
      expect(fetchImpl.mock.calls.length).toBe(1);
    });
  });

  describe('AbortError handling', () => {
    it('should convert AbortError to ShipError.cancelled', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      (global.fetch as any).mockRejectedValue(abortError);

      try {
        await apiHttp.ping();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ShipError);
        expect((error as ShipError).type).toBe('operation_cancelled');
        expect((error as ShipError).message).toContain('cancelled');
      }
    });

    it('should include operation name in cancelled error message', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      (global.fetch as any).mockRejectedValue(abortError);

      try {
        await apiHttp.ping();
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as ShipError).message).toContain('Ping');
      }
    });

    it('should handle AbortError during deploy operation', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      (global.fetch as any).mockRejectedValue(abortError);

      const files = [{ path: 'test.txt', content: Buffer.from('test'), size: 4, md5: 'abc' }];

      try {
        await apiHttp.deploy(files);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ShipError);
        expect((error as ShipError).type).toBe('operation_cancelled');
        expect((error as ShipError).message).toContain('Deploy');
      }
    });

    it('should handle AbortError during list deployments', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';

      (global.fetch as any).mockRejectedValue(abortError);

      await expect(apiHttp.listDeployments()).rejects.toThrow('cancelled');
    });

    it('should handle AbortError during domain operations', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';

      (global.fetch as any).mockRejectedValue(abortError);

      await expect(apiHttp.listDomains()).rejects.toThrow('cancelled');
    });
  });

  describe('user-provided AbortSignal', () => {
    it('should pass user signal to deploy operation', async () => {
      const userController = new AbortController();

      (global.fetch as any).mockResolvedValue(
        createMockResponse({
          deployment: 'test',
          files: 1,
          size: 4,
        }),
      );

      const files = [{ path: 'test.txt', content: Buffer.from('test'), size: 4, md5: 'abc' }];

      await apiHttp.deploy(files, { signal: userController.signal });

      const fetchCall = (fetch as any).mock.calls[0][1];
      // Signal should be present (combined signal or user signal)
      expect(fetchCall.signal).toBeDefined();
    });

    it('aborts the in-flight request when the user aborts their controller', async () => {
      // The real thing: nothing here fabricates an AbortError. The user's
      // controller is aborted mid-flight and the SDK must propagate it.
      // `fetch` is injected rather than assigned onto the global, because
      // ApiHttp captures `globalThis.fetch` at CONSTRUCTION time — a later
      // reassignment would never be seen.
      const hanging = hangingFetch();
      const api = new ApiHttp({
        apiUrl: 'https://api.test.com',
        getAuthHeaders: () => ({}),
        createDeployBody: mockCreateDeployBody,
        // The subject here is the CEILING, not the retry loop.
        maxRetries: 0,
        fetch: hanging as any,
      });
      const userController = new AbortController();
      const files = [{ path: 'test.txt', content: Buffer.from('test'), size: 4, md5: 'abc' }];

      const pending = api.deploy(files, { signal: userController.signal });
      const settled = vi.fn();
      pending.catch(settled);

      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();

      userController.abort();

      await expect(pending).rejects.toMatchObject({ type: 'operation_cancelled' });
    });

    it('aborts immediately when the user signal is already aborted', async () => {
      const api = new ApiHttp({
        apiUrl: 'https://api.test.com',
        getAuthHeaders: () => ({}),
        createDeployBody: mockCreateDeployBody,
        // The subject here is the CEILING, not the retry loop.
        maxRetries: 0,
        fetch: hangingFetch() as any,
      });
      const files = [{ path: 'test.txt', content: Buffer.from('test'), size: 4, md5: 'abc' }];

      await expect(api.deploy(files, { signal: AbortSignal.abort() })).rejects.toMatchObject({
        type: 'operation_cancelled',
      });
    });
  });

  describe('deploys get their own ceiling', () => {
    const files = [
      { path: 'index.html', content: Buffer.from('<html></html>'), md5: 'abc123', size: 13 },
    ];

    it('does not abort a deploy at the 30s read default', async () => {
      // The platform permits 50MB; 50MB in 30s needs ~13 Mbit/s of upload,
      // which is above what most residential links give. A deployment the API
      // explicitly allows must not be aborted here by default — and this is
      // the exact timeout `Idempotency-Key` exists to repair, so the cause
      // has to go, not just the remedy.
      vi.useFakeTimers();
      try {
        global.fetch = hangingFetch() as any;
        const api = new ApiHttp({
          apiUrl: 'https://api.test.com',
          getAuthHeaders: () => ({}),
          createDeployBody: mockCreateDeployBody,
          // The subject here is the CEILING, not the retry loop.
          maxRetries: 0,
        });

        const pending = api.deploy(files);
        const settled = vi.fn();
        pending.catch(settled);

        // Well past the read default, and still in flight.
        await vi.advanceTimersByTimeAsync(120_000);
        expect(settled).not.toHaveBeenCalled();

        // Still bounded, though: a hung socket must end.
        await vi.advanceTimersByTimeAsync(180_000);
        await expect(pending).rejects.toMatchObject({ type: 'network_error' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('gives a build deploy room for the server-side build budget', async () => {
      // A build waits for work the SERVER does after the upload lands: the
      // API gives the build service 300s, and the client must outlast the
      // upload AND that budget AND the commit. A flat deploy ceiling aborted
      // these — and `web/my` sends `build: true` through this same client,
      // so the path is real.
      vi.useFakeTimers();
      try {
        global.fetch = hangingFetch() as any;
        const api = new ApiHttp({
          apiUrl: 'https://api.test.com',
          getAuthHeaders: () => ({}),
          createDeployBody: mockCreateDeployBody,
          // The subject here is the CEILING, not the retry loop.
          maxRetries: 0,
        });

        const pending = api.deploy(files, { build: true });
        const settled = vi.fn();
        pending.catch(settled);

        // Past the plain-deploy ceiling, still in flight.
        await vi.advanceTimersByTimeAsync(300_000);
        expect(settled).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(300_000);
        await expect(pending).rejects.toMatchObject({ type: 'network_error' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not extend the ceiling for spa detection, which never reaches the build service', async () => {
      // `spa` is local detection bounded by the AI tier's own 10s
      // (`api/src/lib/upload-processing.ts` forwards only build/prerender),
      // so it keeps the plain deploy budget. The distinction matters: a flag
      // set is not the same question as which flags cost server time.
      vi.useFakeTimers();
      try {
        global.fetch = hangingFetch() as any;
        const api = new ApiHttp({
          apiUrl: 'https://api.test.com',
          getAuthHeaders: () => ({}),
          createDeployBody: mockCreateDeployBody,
          // The subject here is the CEILING, not the retry loop.
          maxRetries: 0,
        });

        const pending = api.deploy(files, { spa: true });
        const settled = vi.fn();
        pending.catch(settled);

        await vi.advanceTimersByTimeAsync(299_999);
        expect(settled).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).rejects.toMatchObject({ type: 'network_error' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('honours an explicit timeout on deploys too', async () => {
      // Only the DEFAULT splits by operation. A caller who names a ceiling
      // asked for a ceiling, not for one with an exception.
      vi.useFakeTimers();
      try {
        global.fetch = hangingFetch() as any;
        const api = new ApiHttp({
          apiUrl: 'https://api.test.com',
          getAuthHeaders: () => ({}),
          createDeployBody: mockCreateDeployBody,
          // The subject here is the CEILING, not the retry loop.
          maxRetries: 0,
          timeout: 1000,
        });

        const pending = api.deploy(files);
        const settled = vi.fn();
        pending.catch(settled);

        await vi.advanceTimersByTimeAsync(999);
        expect(settled).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).rejects.toMatchObject({ type: 'network_error' });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('timeout cleanup', () => {
    it('should clear timeout on successful response', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      (global.fetch as any).mockResolvedValue(createMockResponse({ success: true }));

      await apiHttp.ping();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('should clear timeout on error response', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      await expect(apiHttp.ping()).rejects.toThrow();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('should clear timeout on HTTP error response', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      (global.fetch as any).mockResolvedValue(
        createMockResponse({ error: 'internal_server_error', message: 'Server error' }, 500),
      );

      await expect(apiHttp.ping()).rejects.toThrow();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });

  describe('concurrent requests', () => {
    it('should handle multiple concurrent requests', async () => {
      (global.fetch as any).mockResolvedValue(createMockResponse({ success: true }));

      const promises = [apiHttp.ping(), apiHttp.getLimits(), apiHttp.listDeployments()];

      await Promise.all(promises);

      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('should use independent signals for each request', async () => {
      const signals: AbortSignal[] = [];

      (global.fetch as any).mockImplementation((_url: string, options: RequestInit) => {
        signals.push(options.signal!);
        return Promise.resolve(createMockResponse({ success: true }));
      });

      await Promise.all([apiHttp.ping(), apiHttp.getLimits()]);

      expect(signals).toHaveLength(2);
      // Each request should have its own signal
      expect(signals[0]).not.toBe(signals[1]);
    });
  });

  describe('event emission during cancellation', () => {
    it('should emit error event when request is aborted', async () => {
      const errorHandler = vi.fn();
      apiHttp.on('error', errorHandler);

      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      (global.fetch as any).mockRejectedValue(abortError);

      await expect(apiHttp.ping()).rejects.toThrow();

      expect(errorHandler).toHaveBeenCalled();
    });

    it('should emit request event before cancellation', async () => {
      const requestHandler = vi.fn();
      apiHttp.on('request', requestHandler);

      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      (global.fetch as any).mockRejectedValue(abortError);

      await expect(apiHttp.ping()).rejects.toThrow();

      // Request event should have been emitted before the abort
      expect(requestHandler).toHaveBeenCalledWith(
        'https://api.test.com/ping',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('network error vs abort error', () => {
    it('should differentiate network errors from abort errors', async () => {
      const networkError = new TypeError('Failed to fetch');
      (global.fetch as any).mockRejectedValue(networkError);

      try {
        await apiHttp.ping();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ShipError);
        expect((error as ShipError).type).toBe('network_error');
      }
    });

    it('should handle generic errors', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Unknown error'));

      try {
        await apiHttp.ping();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ShipError);
        // Generic errors become business errors with operation name prefix
        expect((error as ShipError).message).toContain('Ping failed');
      }
    });
  });
});
