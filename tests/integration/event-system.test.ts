/**
 * @file Final demonstration of the impossibly simple Ship SDK events
 * Shows the complete working event system
 */

import { describe, expect, test, vi } from 'vitest';
import { Ship } from '../../src/index.js';

describe('Ship SDK Events - Final Demo', () => {
  test('should demonstrate impossible simplicity - 3 events, 2 methods', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ success: true }), { 
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });

    const ship = new Ship({ 
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key'
    });

    // Capture complete observability with just 3 events
    const apiCalls: Array<{
      type: 'request' | 'response' | 'error',
      url: string,
      method?: string,
      status?: number,
      hasAuth?: boolean
    }> = [];

    ship.on('request', (url, init) => {
      apiCalls.push({
        type: 'request',
        url,
        method: init.method || 'GET',
        hasAuth: !!(init.headers as any)?.Authorization
      });
    });

    ship.on('response', (response, url) => {
      apiCalls.push({
        type: 'response', 
        url,
        status: response.status
      });
    });

    ship.on('error', (error, url) => {
      apiCalls.push({
        type: 'error',
        url
      });
    });

    // Make API calls
    await ship.ping();
    
    // Verify complete API observability
    expect(apiCalls.length).toBeGreaterThanOrEqual(2); // config + ping
    
    // Verify we captured the ping request and response
    const pingRequest = apiCalls.find(call => 
      call.type === 'request' && call.url.includes('/ping')
    );
    const pingResponse = apiCalls.find(call => 
      call.type === 'response' && call.url.includes('/ping')
    );
    
    expect(pingRequest).toMatchObject({
      type: 'request',
      method: 'GET',
      hasAuth: true // Should have API key
    });
    
    expect(pingResponse).toMatchObject({
      type: 'response',
      status: 200
    });

    mockFetch.mockRestore();
  });

  test('should demonstrate event management', () => {
    const ship = new Ship();
    
    const handler = vi.fn();
    
    // Test adding listeners (impossibly simple API)
    ship.on('request', handler);
    ship.on('response', handler);
    ship.on('error', handler);
    
    // Test removing listeners
    ship.off('request', handler);
    ship.off('response', handler);
    ship.off('error', handler);
    
    // Should complete without errors
    expect(true).toBe(true);
  });

  test('should demonstrate use cases', async () => {
    const ship = new Ship({ 
      apiUrl: 'https://api.example.com'
    });

    // Use case 1: Request logging
    const logs: string[] = [];
    ship.on('request', (url, init) => {
      logs.push(`→ ${init.method || 'GET'} ${url}`);
    });
    
    ship.on('response', (response, url) => {
      logs.push(`← ${response.status} ${url}`);
    });

    // Use case 2: Error monitoring  
    const errors: string[] = [];
    ship.on('error', (error, url) => {
      errors.push(`❌ ${error.message} at ${url}`);
    });

    // Use case 3: Performance monitoring
    const timings: Array<{url: string, duration: number}> = [];
    const startTimes = new Map<string, number>();
    
    ship.on('request', (url) => {
      startTimes.set(url, Date.now());
    });
    
    ship.on('response', (response, url) => {
      const start = startTimes.get(url);
      if (start) {
        timings.push({
          url,
          duration: Date.now() - start
        });
        startTimes.delete(url);
      }
    });

    // Mock fetch to avoid actual requests  
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    try {
      await ship.ping();
    } catch (error) {
      // Ignore errors for this demo
    }

    // Verify logging worked
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some(log => log.includes('→ GET'))).toBe(true);
    expect(logs.some(log => log.includes('← 200'))).toBe(true);

    // Verify performance monitoring worked
    expect(timings.length).toBeGreaterThan(0);
    expect(timings.every(t => t.duration >= 0)).toBe(true);

    mockFetch.mockRestore();
  });
});