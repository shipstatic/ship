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
  const abortError = () => {
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
          reject(abortError());
          return;
        }
        init.signal?.addEventListener('abort', () => reject(abortError()));
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
          timeout: 1000,
        });

        const pending = api.ping();
        const settled = vi.fn();
        pending.catch(settled);

        await vi.advanceTimersByTimeAsync(999);
        expect(settled).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).rejects.toMatchObject({ type: 'operation_cancelled' });
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
        });

        const pending = api.ping();
        const settled = vi.fn();
        pending.catch(settled);

        await vi.advanceTimersByTimeAsync(29_999);
        expect(settled).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).rejects.toMatchObject({ type: 'operation_cancelled' });
      } finally {
        vi.useRealTimers();
      }
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
        fetch: hangingFetch() as any,
      });
      const files = [{ path: 'test.txt', content: Buffer.from('test'), size: 4, md5: 'abc' }];

      await expect(api.deploy(files, { signal: AbortSignal.abort() })).rejects.toMatchObject({
        type: 'operation_cancelled',
      });
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
