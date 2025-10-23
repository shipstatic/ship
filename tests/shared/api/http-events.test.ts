/**
 * @file Tests for ApiHttp event emission
 */

import { describe, expect, test, vi } from 'vitest';
import { ApiHttp } from '../../../src/shared/api/http.js';

describe('ApiHttp Events', () => {
  test('should emit request event', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { 
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );

    const apiHttp = new ApiHttp({
      apiUrl: 'https://api.example.com',
      getAuthHeaders: () => ({})
    });

    const requestHandler = vi.fn();
    apiHttp.on('request', requestHandler);

    await apiHttp.ping();

    expect(requestHandler).toHaveBeenCalledWith(
      'https://api.example.com/ping',
      expect.objectContaining({
        method: 'GET'
      })
    );

    mockFetch.mockRestore();
  });

  test('should emit response event', async () => {
    const mockResponse = new Response(JSON.stringify({ success: true }), { 
      status: 200,
      headers: { 'content-type': 'application/json' }
    });

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    const apiHttp = new ApiHttp({
      apiUrl: 'https://api.example.com',
      getAuthHeaders: () => ({})
    });

    const responseHandler = vi.fn();
    apiHttp.on('response', responseHandler);

    await apiHttp.ping();

    expect(responseHandler).toHaveBeenCalledWith(
      expect.any(Response),
      'https://api.example.com/ping'
    );

    mockFetch.mockRestore();
  });
});