/**
 * @file Tests to verify SDK initialization order prevents race conditions
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Ship } from '../../src/index.js';
import { __setTestEnvironment } from '../../src/lib/env.js';
import { setupMockServer, cleanupMockServer } from '../mocks/server.js';

describe('SDK Initialization Order', () => {
  const mockServerPort = 3000; // Standard port used by the mock server
  
  beforeAll(async () => {
    __setTestEnvironment('node');
    await setupMockServer();
  });

  afterAll(async () => {
    await cleanupMockServer();
  });

  it('should ensure API client is fully initialized before SPA detection', async () => {
    // Create a spy to track API calls and their order
    const apiCalls: string[] = [];
    
    // Mock fetch to track calls
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      const urlObj = new URL(url);
      apiCalls.push(urlObj.pathname);
      
      // Mock responses
      if (urlObj.pathname === '/config') {
        return new Response(JSON.stringify({ 
          maxFileSize: 10485760, 
          maxFilesCount: 1000, 
          maxTotalSize: 104857600 
        }), { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      if (urlObj.pathname === '/spa-check') {
        return new Response(JSON.stringify({ 
          isSPA: true,
          debug: { tier: 'inclusions', reason: 'React mount point detected' }
        }), { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      if (urlObj.pathname === '/deployments') {
        return new Response(JSON.stringify({
          deployment: 'test-deployment-id',
          files: 1,
          size: 100,
          status: 'success',
          url: 'https://test-deployment.example.com',
          created: Math.floor(Date.now() / 1000)
        }), { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      return originalFetch(url, options);
    });

    try {
      // Create Ship instance with custom API URL
      const ship = new Ship({ 
        deployToken: 'token-test123',
        apiUrl: `http://localhost:${mockServerPort}`
      });

      // Create a simple file for deployment (Node.js expects file paths)
      const files = ['./tests/fixtures/demo-site/index.html'];
      
      // Deploy - this should trigger initialization and SPA detection
      await ship.deployments.create(files);
      
      // Verify that /config was called before /spa-check
      expect(apiCalls).toContain('/config');
      expect(apiCalls).toContain('/spa-check');
      expect(apiCalls).toContain('/deployments');
      
      const configIndex = apiCalls.indexOf('/config');
      const spaCheckIndex = apiCalls.indexOf('/spa-check');
      
      // Config should be called before SPA check (initialization order)
      expect(configIndex).toBeLessThan(spaCheckIndex);
      
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should use correct API URL for all calls after initialization', async () => {
    const customApiUrl = `http://localhost:${mockServerPort}`;
    const apiUrls: string[] = [];
    
    // Mock fetch to track URLs
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      apiUrls.push(url);
      
      // Mock responses with correct host
      if (url.includes('/config')) {
        return new Response(JSON.stringify({ 
          maxFileSize: 10485760, 
          maxFilesCount: 1000, 
          maxTotalSize: 104857600 
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      
      if (url.includes('/spa-check')) {
        return new Response(JSON.stringify({ 
          isSPA: false,
          debug: { tier: 'exclusions', reason: 'No SPA indicators found' }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      
      if (url.includes('/deployments')) {
        return new Response(JSON.stringify({
          deployment: 'test-deployment-id',
          files: 1,
          size: 100,
          status: 'success',
          url: 'https://test-deployment.example.com',
          created: Math.floor(Date.now() / 1000)
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      
      return originalFetch(url, options);
    });

    try {
      // Create Ship instance with custom API URL
      const ship = new Ship({ 
        deployToken: 'token-test123',
        apiUrl: customApiUrl
      });

      // Create a simple file for deployment (Node.js expects file paths)  
      const files = ['./tests/fixtures/demo-site/index.html'];
      
      // Deploy
      await ship.deployments.create(files);
      
      // All API calls should use the custom API URL, not the default
      apiUrls.forEach(url => {
        expect(url.startsWith(customApiUrl)).toBe(true);
        expect(url).not.toContain('api.shipstatic.com'); // Should not use default
      });
      
    } finally {
      global.fetch = originalFetch;
    }
  });
});