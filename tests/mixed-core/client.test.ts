// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Ship as ShipClass } from '../../src/index'; // Import type for client
import type { ShipError as ShipErrorClassType } from '@shipstatic/types'; // Import type for ShipError

// 1. Use vi.hoisted() for variables used in vi.mock factories
const mockApiHttpInstance = {
  ping: vi.fn(),
  deploy: vi.fn(),
  getLimits: vi.fn().mockResolvedValue({
    maxFileSize: 10 * 1024 * 1024,
    maxFilesCount: 1000,
    maxTotalSize: 100 * 1024 * 1024,
  }),
};

const { MOCK_API_HTTP_MODULE } = vi.hoisted(() => {
  return {
    MOCK_API_HTTP_MODULE: {
      ApiHttp: vi.fn(() => mockApiHttpInstance),
      DEFAULT_API: 'https://mockapi.shipstatic.com'
    }
  };
});

// Specific mocks for file utilities
const { NODE_FILE_UTILS_MOCK } = vi.hoisted(() => ({
  NODE_FILE_UTILS_MOCK: { 
    processFilesForNode: vi.fn(),
    findNodeCommonParentDirectory: vi.fn().mockReturnValue('/common/path')
  }
}));

// Mock modules using the predefined implementations
vi.mock('../../src/shared/api/http', () => MOCK_API_HTTP_MODULE);
vi.mock('../../src/node/core/node-files', () => NODE_FILE_UTILS_MOCK);

// Aliases to the mocked implementations
const apiClientMock = mockApiHttpInstance;
const nodeFileUtilsMock = NODE_FILE_UTILS_MOCK;

describe('BaseShipClient', () => {
  let client: ShipClass; // Typed client
  const MOCK_API_HOST = 'https://custom.example.com';

  afterEach(async () => {
    const { __setTestEnvironment } = await import('../../src/shared/lib/env');
    await __setTestEnvironment(null);
    vi.clearAllMocks();
    // Clear process.env variables set in tests
    delete process.env.SHIP_TOKEN;
    delete process.env.SHIP_API_URL;
  });

  describe('Constructor and Ship class', () => {
    it('should prefer explicit options over environment variables', async () => {
      process.env.SHIP_TOKEN = 'env_token';
      process.env.SHIP_API_URL = 'https://env.host';
      const { Ship } = await import('../../src/index');
      new Ship({ apiUrl: 'https://opt.host', token: 'opt_token' });
      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          apiUrl: 'https://opt.host',
          token: 'opt_token'
        })
      );
    });

    it('reads SHIP_* env vars at construction time', async () => {
      const { __setTestEnvironment } = await import('../../src/shared/lib/env');
      await __setTestEnvironment('node');

      // SDK's only ambient credential source — the "process boundary".
      process.env.SHIP_TOKEN = 'ship-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      process.env.SHIP_API_URL = 'https://test.api.shipstatic.com';

      MOCK_API_HTTP_MODULE.ApiHttp.mockClear();

      const { Ship } = await import('../../src/index');
      new Ship();

      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          apiUrl: 'https://test.api.shipstatic.com',
          token: 'ship-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        })
      );

      delete process.env.SHIP_TOKEN;
      delete process.env.SHIP_API_URL;
    });

    it('falls back to the default API host when env supplies only a token', async () => {
      const { __setTestEnvironment } = await import('../../src/shared/lib/env');
      await __setTestEnvironment('node');

      process.env.SHIP_TOKEN = 'ship-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      delete process.env.SHIP_API_URL;

      MOCK_API_HTTP_MODULE.ApiHttp.mockClear();

      const { Ship } = await import('../../src/index');
      new Ship({});

      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'ship-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        })
      );

      delete process.env.SHIP_TOKEN;
    });
  });

  describe('ShipClient.deployments.upload() - DeployOptions Passthrough', () => {
    beforeEach(async () => {
      const { __setTestEnvironment } = await import('../../src/shared/lib/env');
      await __setTestEnvironment('node');
      const { Ship } = await import('../../src/index');
      client = new Ship({ apiUrl: MOCK_API_HOST, token: 'mock_token' });
    });

    it('should use client default progress callbacks if not provided in options', async () => {
      const { Ship } = await import('../../src/index');
      const defaultProgressCallback = vi.fn();
      const clientWithDefaults = new Ship({
        apiUrl: MOCK_API_HOST,
        token: 'mock_token',
        onProgress: defaultProgressCallback,
        timeout: 8000
      });
      
      // Mock successful deployment with string array (Node.js expects file paths)
      const mockFiles = ['test.txt', 'test2.txt'];
      const processedFiles = [
        { path: 'test.txt', content: 'test content', md5: 'abc123', size: 12 },
        { path: 'test2.txt', content: 'test content 2', md5: 'def456', size: 14 }
      ];
      
      // Mock the file processing to return processed files
      nodeFileUtilsMock.processFilesForNode.mockResolvedValueOnce(processedFiles);
      
      // Call deploy without progress callback - should use default from Ship instance
      await clientWithDefaults.deployments.upload(mockFiles, {});
      
      // Verify the default progress callback was passed through
      expect(apiClientMock.deploy).toHaveBeenCalledWith(
        expect.any(Array), // The processed files
        expect.objectContaining({
          onProgress: defaultProgressCallback,
          timeout: 8000
        })
      );
    });
  });

  describe('Unsupported Environment', () => {
    it('should throw ShipError for unsupported environment', async () => {
      // Set environment to unknown before test
      const { __setTestEnvironment } = await import('../../src/shared/lib/env');
      await __setTestEnvironment('unknown');
      
      const { Ship } = await import('../../src/index');
      const { ShipError } = await import('@shipstatic/types'); // ShipError class for instanceof
      
      // The error should be thrown when creating the client, not when calling deploy
      expect(() => {
        new Ship({ apiUrl: MOCK_API_HOST, token: 'mock_token' });
      }).toThrow('Node.js Ship class can only be used in Node.js environment.');

      try {
        new Ship({ apiUrl: MOCK_API_HOST, token: 'mock_token' });
        // We shouldn't reach this point
        expect.fail('Should have thrown an error');
      } catch (e) {
        expect(e).toBeInstanceOf(ShipError);
        // Cast to ShipErrorClassType (which is typeof ShipError from errors.ts) or Error to access message
        expect((e as ShipErrorClassType | Error).message).toBe('Node.js Ship class can only be used in Node.js environment.');
      }
    });
  });

  describe('Configuration Loading Integration', () => {
    it('loads SHIP_* env vars when no constructor options are supplied', async () => {
      process.env.SHIP_TOKEN = 'env-test-key';
      process.env.SHIP_API_URL = 'https://env-test-api.com';

      const { __setTestEnvironment } = await import('../../src/shared/lib/env');
      await __setTestEnvironment('node');

      MOCK_API_HTTP_MODULE.ApiHttp.mockClear();

      const { Ship } = await import('../../src/index');
      new Ship();

      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'env-test-key',
          apiUrl: 'https://env-test-api.com',
        })
      );

      delete process.env.SHIP_TOKEN;
      delete process.env.SHIP_API_URL;
    });

    it('should prioritize constructor options over environment variables', async () => {
      // Set up environment variables that should be ignored
      process.env.SHIP_TOKEN = 'env-ignored-key';
      process.env.SHIP_API_URL = 'https://env-ignored.com';

      // Set Node.js environment
      const { __setTestEnvironment } = await import('../../src/shared/lib/env');
      await __setTestEnvironment('node');

      // Reset the ApiHttp mock to track calls
      MOCK_API_HTTP_MODULE.ApiHttp.mockClear();

      const { Ship } = await import('../../src/index');
      const ship = new Ship({
        token: 'constructor-priority-key',
        apiUrl: 'https://constructor-priority.com'
      });

      // Trigger config initialization
      await ship.ping();

      // Verify constructor options took precedence
      // First call should have constructor options
      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'constructor-priority-key',
          apiUrl: 'https://constructor-priority.com'
        })
      );

      // Clean up
      delete process.env.SHIP_TOKEN;
      delete process.env.SHIP_API_URL;
    });
  });
});
