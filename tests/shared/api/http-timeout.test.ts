import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiHttp } from '../../../src/shared/api/http';
import { ShipError } from '@shipstatic/types';

// Mock deploy body creator
const mockCreateDeployBody = async () => ({
  body: new ArrayBuffer(0),
  headers: { 'Content-Type': 'multipart/form-data' }
});

// Helper to create mock response
function createMockResponse(data: any, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: { get: () => '20' },
    clone: function() { return this; },
    json: async () => data
  };
}

describe('ApiHttp Timeout & Cancellation', () => {
  let apiHttp: ApiHttp;

  beforeEach(() => {
    global.fetch = vi.fn();

    apiHttp = new ApiHttp({
      apiUrl: 'https://api.test.com',
      getAuthHeaders: () => ({ Authorization: 'Bearer test-key' }),
      createDeployBody: mockCreateDeployBody,
      timeout: 5000
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

    it('should use custom timeout from constructor options', async () => {
      const shortTimeoutApi = new ApiHttp({
        apiUrl: 'https://api.test.com',
        getAuthHeaders: () => ({}),
        createDeployBody: mockCreateDeployBody,
        timeout: 1000
      });

      (global.fetch as any).mockResolvedValue(createMockResponse({ success: true }));

      await shortTimeoutApi.ping();

      // Verify signal is passed (indicates timeout setup)
      const fetchCall = (fetch as any).mock.calls[0][1];
      expect(fetchCall.signal).toBeDefined();
    });

    it('should work with default timeout when not specified', async () => {
      const defaultTimeoutApi = new ApiHttp({
        apiUrl: 'https://api.test.com',
        getAuthHeaders: () => ({}),
        createDeployBody: mockCreateDeployBody
        // No timeout - should use default
      });

      (global.fetch as any).mockResolvedValue(createMockResponse({ success: true }));

      await defaultTimeoutApi.ping();

      const fetchCall = (fetch as any).mock.calls[0][1];
      expect(fetchCall.signal).toBeDefined();
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

      (global.fetch as any).mockResolvedValue(createMockResponse({
        deployment: 'test',
        files: 1,
        size: 4
      }));

      const files = [{ path: 'test.txt', content: Buffer.from('test'), size: 4, md5: 'abc' }];

      await apiHttp.deploy(files, { signal: userController.signal });

      const fetchCall = (fetch as any).mock.calls[0][1];
      // Signal should be present (combined signal or user signal)
      expect(fetchCall.signal).toBeDefined();
    });

    it('should throw when user aborts during deploy', async () => {
      const userController = new AbortController();

      // Simulate abort happening during fetch
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      (global.fetch as any).mockRejectedValue(abortError);

      const files = [{ path: 'test.txt', content: Buffer.from('test'), size: 4, md5: 'abc' }];

      await expect(apiHttp.deploy(files, { signal: userController.signal }))
        .rejects.toThrow('cancelled');
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

      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        headers: { get: () => 'application/json' },
        json: async () => ({ error: 'Server error' })
      });

      await expect(apiHttp.ping()).rejects.toThrow();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });

  describe('concurrent requests', () => {
    it('should handle multiple concurrent requests', async () => {
      (global.fetch as any).mockResolvedValue(createMockResponse({ success: true }));

      const promises = [
        apiHttp.ping(),
        apiHttp.getConfig(),
        apiHttp.listDeployments()
      ];

      await Promise.all(promises);

      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('should use independent signals for each request', async () => {
      const signals: AbortSignal[] = [];

      (global.fetch as any).mockImplementation((_url: string, options: RequestInit) => {
        signals.push(options.signal!);
        return Promise.resolve(createMockResponse({ success: true }));
      });

      await Promise.all([
        apiHttp.ping(),
        apiHttp.getConfig()
      ]);

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
        expect.objectContaining({ method: 'GET' })
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
        // Generic errors become business errors
        expect((error as ShipError).message).toContain('unexpected error');
      }
    });
  });
});
