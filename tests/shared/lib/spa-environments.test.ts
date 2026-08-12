/**
 * @file Subject: `src/shared/lib/spa.ts` — `checkSPA` under each runtime's own
 * content shapes. Aspect split of `spa.test.ts`, recorded in CLAUDE.md.
 *
 * It was `tests/shared/api/http-browser.test.ts` until 2026-08-12, when
 * `checkSPA` moved off the transport to the module that is its only caller.
 * The subject moved with the code; nothing else here changed, because these
 * rows always drove `checkSPA` and never the endpoint table around it.
 *
 * What it certifies that the jsdom-free rows cannot: a real `Buffer`-less
 * global scope. The `typeof Buffer !== 'undefined'` guard exists because a
 * browser bundle has no `Buffer` at all, and a check that reads it unguarded
 * is a ReferenceError rather than a wrong answer.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiHttp } from '../../../src/shared/api/http';
import { __setTestEnvironment } from '../../../src/shared/lib/env';
import { checkSPA } from '../../../src/shared/lib/spa';
import type { StaticFile } from '../../../src/shared/types';

// Mock fetch globally
global.fetch = vi.fn();

// Mock File and Blob for browser environment tests
global.File = class MockFile {
  name: string;
  type: string;
  size: number;
  private chunks: any[];

  constructor(chunks: any[], name: string, options: any = {}) {
    this.name = name;
    this.type = options.type || 'application/octet-stream';
    this.chunks = chunks;
    this.size = chunks.reduce((total: number, chunk: any) => total + (chunk.length || 0), 0);
  }

  async text() {
    return this.chunks.join('');
  }

  async arrayBuffer() {
    return new ArrayBuffer(0);
  }
} as any;

global.Blob = class MockBlob {
  type: string;
  size: number;
  private chunks: any[];

  constructor(chunks: any[], options: any = {}) {
    this.type = options.type || 'application/octet-stream';
    this.chunks = chunks;
    this.size = chunks.reduce((total: number, chunk: any) => total + (chunk.length || 0), 0);
  }

  async text() {
    return this.chunks.join('');
  }

  async arrayBuffer() {
    return new ArrayBuffer(0);
  }
} as any;

// Helper function to create standardized mock responses
function createMockResponse(data: any, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: {
      get: vi.fn().mockImplementation((header: string) => {
        if (header === 'Content-Length') {
          return status === 204 || data === undefined ? '0' : '15';
        }
        if (header === 'content-type') {
          return 'application/json';
        }
        return null;
      }),
    },
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

describe('checkSPA across environments', () => {
  let apiHttp: ApiHttp;
  const mockOptions = {
    apiUrl: 'https://api.test.com',
    getAuthHeaders: () => ({ Authorization: 'Bearer test-api-key' }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    apiHttp = new ApiHttp(mockOptions);
  });

  afterEach(() => {
    // Reset environment after each test
    __setTestEnvironment(null as any);
  });

  describe('checkSPA - Browser Environment Compatibility', () => {
    let mockFiles: StaticFile[];

    beforeEach(() => {
      // Set browser environment for these tests
      __setTestEnvironment('browser');

      mockFiles = [
        {
          path: 'index.html',
          content: new File(['<html><script src="app.js"></script></html>'], 'index.html', {
            type: 'text/html',
          }),
          size: 43,
          md5: 'html-hash',
        },
        {
          path: 'app.js',
          content: new File(['console.log("SPA app");'], 'app.js', {
            type: 'application/javascript',
          }),
          size: 22,
          md5: 'js-hash',
        },
      ];
    });

    it('should handle File objects in browser environment without Buffer reference errors', async () => {
      // Mock successful SPA check response
      (global.fetch as any).mockResolvedValue(createMockResponse({ isSPA: true }));

      // This should NOT throw "Buffer is not defined" error
      const result = await checkSPA(mockFiles, apiHttp);

      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/spa-check',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          }),
          body: JSON.stringify({
            files: ['index.html', 'app.js'],
            index: '<html><script src="app.js"></script></html>',
          }),
        }),
      );
    });

    it('should handle Blob objects in browser environment', async () => {
      const blobFiles: StaticFile[] = [
        {
          path: 'index.html',
          content: new Blob(['<html><script src="app.js"></script></html>'], { type: 'text/html' }),
          size: 43,
          md5: 'html-hash',
        },
      ];

      (global.fetch as any).mockResolvedValue(createMockResponse({ isSPA: false }));

      const result = await checkSPA(blobFiles, apiHttp);

      expect(result).toBe(false);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/spa-check',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            files: ['index.html'],
            index: '<html><script src="app.js"></script></html>',
          }),
        }),
      );
    });

    it('should return false for missing index.html in browser environment', async () => {
      const filesWithoutIndex: StaticFile[] = [
        {
          path: 'app.js',
          content: new File(['console.log("app");'], 'app.js'),
          size: 18,
          md5: 'js-hash',
        },
      ];

      // Should return false without making API call
      const result = await checkSPA(filesWithoutIndex, apiHttp);

      expect(result).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should return false for oversized index.html in browser environment', async () => {
      const oversizedContent = 'x'.repeat(150 * 1024); // 150KB, over the 100KB limit
      const oversizedFiles: StaticFile[] = [
        {
          path: 'index.html',
          content: new File([oversizedContent], 'index.html'),
          size: oversizedContent.length,
          md5: 'html-hash',
        },
      ];

      const result = await checkSPA(oversizedFiles, apiHttp);

      expect(result).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully in browser environment', async () => {
      (global.fetch as any).mockResolvedValue(
        createMockResponse({ error: 'SPA check failed' }, 500),
      );

      await expect(checkSPA(mockFiles, apiHttp)).rejects.toThrow('SPA check failed');
    });
  });

  describe('checkSPA - Node.js Environment Compatibility', () => {
    let mockFiles: StaticFile[];

    beforeEach(() => {
      // Set Node.js environment for these tests
      __setTestEnvironment('node');

      mockFiles = [
        {
          path: 'index.html',
          content: Buffer.from('<html><script src="app.js"></script></html>'),
          size: 43,
          md5: 'html-hash',
        },
        {
          path: 'app.js',
          content: Buffer.from('console.log("SPA app");'),
          size: 22,
          md5: 'js-hash',
        },
      ];
    });

    it('should handle Buffer objects in Node.js environment', async () => {
      (global.fetch as any).mockResolvedValue(createMockResponse({ isSPA: true }));

      const result = await checkSPA(mockFiles, apiHttp);

      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/spa-check',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            files: ['index.html', 'app.js'],
            index: '<html><script src="app.js"></script></html>',
          }),
        }),
      );
    });

    it('should return false for unsupported content types in Node.js environment', async () => {
      const invalidFiles: StaticFile[] = [
        {
          path: 'index.html',
          content: 'invalid-content-type' as any, // Neither Buffer, Blob, nor File
          size: 20,
          md5: 'html-hash',
        },
      ];

      const result = await checkSPA(invalidFiles, apiHttp);
      expect(result).toBe(false);
    });
  });

  describe('Cross-Environment Consistency', () => {
    it('should produce identical results across environments for same content', async () => {
      const htmlContent = '<html><div id="root"></div><script src="app.js"></script></html>';

      // Test in browser environment with File
      __setTestEnvironment('browser');
      const browserFiles: StaticFile[] = [
        {
          path: 'index.html',
          content: new File([htmlContent], 'index.html'),
          size: htmlContent.length,
          md5: 'test-hash',
        },
      ];

      // Test in Node.js environment with Buffer
      __setTestEnvironment('node');
      const nodeFiles: StaticFile[] = [
        {
          path: 'index.html',
          content: Buffer.from(htmlContent),
          size: htmlContent.length,
          md5: 'test-hash',
        },
      ];

      // Mock API response
      (global.fetch as any).mockResolvedValue(createMockResponse({ isSPA: true }));

      __setTestEnvironment('browser');
      const browserResult = await checkSPA(browserFiles, apiHttp);

      vi.clearAllMocks();
      (global.fetch as any).mockResolvedValue(createMockResponse({ isSPA: true }));

      __setTestEnvironment('node');
      const nodeResult = await checkSPA(nodeFiles, apiHttp);

      // Both should produce the same result
      expect(browserResult).toBe(nodeResult);
      expect(browserResult).toBe(true);
    });
  });

  describe('Critical Browser Compatibility Regression Tests', () => {
    it('should not reference Buffer without typeof check in browser environment', async () => {
      __setTestEnvironment('browser');

      // Temporarily remove Buffer from global scope to simulate real browser
      const originalBuffer = global.Buffer;
      delete (global as any).Buffer;

      try {
        const mockFiles: StaticFile[] = [
          {
            path: 'index.html',
            content: new File(['<html>test</html>'], 'index.html'),
            size: 17,
            md5: 'test-hash',
          },
        ];

        (global.fetch as any).mockResolvedValue(createMockResponse({ isSPA: false }));

        // This should NOT throw "Buffer is not defined" error
        const result = await checkSPA(mockFiles, apiHttp);
        expect(result).toBe(false);
      } finally {
        // Restore Buffer for other tests
        global.Buffer = originalBuffer;
      }
    });

    it('should gracefully handle mixed content types without environment-specific errors', async () => {
      __setTestEnvironment('browser');

      const mixedFiles: StaticFile[] = [
        {
          path: 'index.html',
          content: new File(['<html>test</html>'], 'index.html'),
          size: 17,
          md5: 'html-hash',
        },
        {
          path: 'app.js',
          content: new Blob(['console.log("app");'], { type: 'application/javascript' }),
          size: 18,
          md5: 'js-hash',
        },
      ];

      (global.fetch as any).mockResolvedValue(createMockResponse({ isSPA: true }));

      const result = await checkSPA(mixedFiles, apiHttp);
      expect(result).toBe(true);
    });
  });
});
