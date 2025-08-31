/**
 * @file Comprehensive tests for bulletproof event system fixes
 */

import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { Ship } from '../../src/index.js';

describe('Bulletproof Event System', () => {
  let mockFetch: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ success: true }), { 
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  test('should handle response body reading in event handlers', async () => {
    const ship = new Ship({ apiUrl: 'https://api.example.com' });

    const responseContent: string[] = [];
    
    ship.on('response', async (response, url) => {
      // This should NOT fail because we use cloned response
      try {
        const data = await response.json();
        responseContent.push(JSON.stringify(data));
      } catch (error) {
        responseContent.push('FAILED');
      }
    });

    await ship.ping();
    
    // Should have successfully read response body in event handler
    expect(responseContent.length).toBeGreaterThan(0);
    expect(responseContent[0]).not.toBe('FAILED');
    expect(responseContent[0]).toContain('success');
  });

  test('should not emit duplicate response events', async () => {
    const ship = new Ship({ apiUrl: 'https://api.example.com' });

    const responseUrls: string[] = [];
    
    ship.on('response', (response, url) => {
      responseUrls.push(url);
    });

    await ship.ping();
    
    // Find ping responses (filter out config responses)
    const pingResponses = responseUrls.filter(url => url.includes('/ping'));
    
    // Should only have ONE ping response, not duplicates
    expect(pingResponses.length).toBe(1);
  });

  test('should handle empty responses without duplication', async () => {
    // Mock empty response (204 No Content)
    mockFetch.mockResolvedValueOnce(
      new Response(null, { 
        status: 204
      })
    );

    const ship = new Ship({ apiUrl: 'https://api.example.com' });

    const responseEvents: Array<{url: string, status: number}> = [];
    
    ship.on('response', (response, url) => {
      responseEvents.push({ url, status: response.status });
    });

    await ship.ping();
    
    // Find 204 responses 
    const emptyResponses = responseEvents.filter(e => e.status === 204);
    
    // Should only have ONE empty response event, not duplicates
    expect(emptyResponses.length).toBe(1);
  });

  test('should handle failing event handlers gracefully', async () => {
    const ship = new Ship({ apiUrl: 'https://api.example.com' });

    const goodHandlerCalls: string[] = [];
    const failingHandlerCalls: number[] = [];

    // Add a handler that always fails
    const failingHandler = vi.fn(() => {
      failingHandlerCalls.push(Date.now());
      throw new Error('Handler intentionally fails');
    });

    // Add a good handler
    const goodHandler = vi.fn((url: string) => {
      goodHandlerCalls.push(url);
    });

    ship.on('request', failingHandler);
    ship.on('request', goodHandler);

    // Make multiple API calls
    await ship.ping();
    await ship.ping();

    // Failing handler should be called for every request (no circuit breaker in simple implementation)
    expect(failingHandlerCalls.length).toBeGreaterThanOrEqual(1);
    
    // Good handler should be called for ALL requests
    expect(goodHandlerCalls.length).toBeGreaterThanOrEqual(2);
  });

  test('should clean up failed handlers when removed', async () => {
    const ship = new Ship({ apiUrl: 'https://api.example.com' });

    const failingHandler = vi.fn(() => {
      throw new Error('Handler fails');
    });

    ship.on('request', failingHandler);
    
    // Trigger failure
    await ship.ping();
    const firstCallCount = failingHandler.mock.calls.length;
    expect(firstCallCount).toBeGreaterThanOrEqual(1);

    // Remove handler
    ship.off('request', failingHandler);
    
    // Add same handler back - it should work again
    ship.on('request', failingHandler);
    
    // Should be called again (simple implementation always calls handlers)
    await ship.ping();
    expect(failingHandler.mock.calls.length).toBeGreaterThan(firstCallCount);
  });

  test('should transfer event listeners type-safely during initialization', async () => {
    const events: string[] = [];
    
    // Create ship and add listeners BEFORE any API calls
    const ship = new Ship({ 
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key'
    });

    ship.on('request', (url) => {
      events.push(`request:${url}`);
    });

    ship.on('response', (response, url) => {
      events.push(`response:${url}:${response.status}`);
    });

    // This triggers initialization which recreates the http instance
    // Our listeners should be transferred to the new instance
    await ship.ping();

    // Should have captured events from the NEW http instance
    const requestEvents = events.filter(e => e.startsWith('request:'));
    const responseEvents = events.filter(e => e.startsWith('response:'));
    
    expect(requestEvents.length).toBeGreaterThan(0);
    expect(responseEvents.length).toBeGreaterThan(0);
    
    // Verify ping request was captured
    expect(requestEvents.some(e => e.includes('/ping'))).toBe(true);
    expect(responseEvents.some(e => e.includes('/ping'))).toBe(true);
  });

  test('should handle concurrent event listeners safely', async () => {
    const ship = new Ship({ apiUrl: 'https://api.example.com' });

    const results: string[] = [];
    
    // Add multiple handlers that could interfere with each other
    for (let i = 0; i < 5; i++) {
      ship.on('request', (url) => {
        results.push(`handler-${i}:${url}`);
      });
    }

    await ship.ping();
    
    // All handlers should have been called
    const pingResults = results.filter(r => r.includes('/ping'));
    expect(pingResults.length).toBe(5);
    
    // Each handler should have unique identifier
    for (let i = 0; i < 5; i++) {
      expect(pingResults.some(r => r.startsWith(`handler-${i}:`))).toBe(true);
    }
  });

  test('should maintain event ordering guarantees', async () => {
    const ship = new Ship({ apiUrl: 'https://api.example.com' });

    const eventOrder: string[] = [];
    
    ship.on('request', (url) => {
      if (url.includes('/ping')) {
        eventOrder.push('request-ping');
      }
    });
    
    ship.on('response', (response, url) => {
      if (url.includes('/ping')) {
        eventOrder.push('response-ping');
      }
    });

    await ship.ping();
    
    // Should see request before response for ping
    const pingRequestIndex = eventOrder.indexOf('request-ping');
    const pingResponseIndex = eventOrder.indexOf('response-ping');
    
    expect(pingRequestIndex).toBeGreaterThanOrEqual(0);
    expect(pingResponseIndex).toBeGreaterThan(pingRequestIndex);
  });
});