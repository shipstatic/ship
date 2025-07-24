// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Ship as ShipClass } from '../../src/index'; // Import type for client
import type { ShipError as ShipErrorClassType } from '@shipstatic/types'; // Import type for ShipError

// 1. Use vi.hoisted() for variables used in vi.mock factories
const mockApiHttpInstance = {
  ping: vi.fn(),
  deploy: vi.fn(),
  getConfig: vi.fn().mockResolvedValue({
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

const { CONFIG_LOADER_MOCK_IMPLEMENTATION } = vi.hoisted(() => {
  return {
    CONFIG_LOADER_MOCK_IMPLEMENTATION: {
      loadConfig: vi.fn(),
      DEFAULT_API: 'https://loaded.config.host',
      resolveConfig: vi.fn((userDeployOptions: Record<string, any> = {}, loadedConfig: Record<string, any> = {}) => ({ // Added basic types
        apiUrl: userDeployOptions.apiUrl || loadedConfig.apiUrl || 'https://api.shipstatic.com',
        apiKey: userDeployOptions.apiKey !== undefined ? userDeployOptions.apiKey : loadedConfig.apiKey
      })),
      mergeDeployOptions: vi.fn((userOptions: Record<string, any> = {}, clientDefaults: Record<string, any> = {}) => ({
        ...clientDefaults,
        ...userOptions
      }))
    }
  };
});

// 2. Mock modules using the predefined implementations
vi.mock('../../src/api/http', () => MOCK_API_HTTP_MODULE);
vi.mock('../../src/lib/node-files', () => NODE_FILE_UTILS_MOCK);
vi.mock('../../src/core/config', () => CONFIG_LOADER_MOCK_IMPLEMENTATION);

// Aliases to the mocked implementations
const apiClientMock = mockApiHttpInstance;
const nodeFileUtilsMock = NODE_FILE_UTILS_MOCK;
const configLoaderMock = CONFIG_LOADER_MOCK_IMPLEMENTATION.loadConfig; // Direct reference to the mock function

describe('BaseShipClient', () => {
  let client: ShipClass; // Typed client
  const MOCK_API_HOST = 'https://custom.example.com';

  afterEach(async () => {
    const { __setTestEnvironment } = await import('@/lib/env');
    await __setTestEnvironment(null);
    vi.clearAllMocks();
    // Clear process.env variables set in tests
    delete process.env.SHIPSTATIC_API_KEY;
    delete process.env.SHIPSTATIC_API;
  });

  describe('Constructor and Ship class', () => {
    it('should prefer explicit options over environment variables', async () => {
      process.env.SHIPSTATIC_API_KEY = 'env_api_key';
      process.env.SHIPSTATIC_API = 'https://env.host';
      const { Ship } = await import('../../src/index');
      const shipInstance = new Ship({ api: 'opt_host', apiKey: 'opt_api_key' }); // Renamed to avoid conflict
      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          api: 'opt_host',
          apiKey: 'opt_api_key'
        })
      );
    });

    it('should use loaded config if no direct options provided for Ship class', async () => {
      const { __setTestEnvironment } = await import('../../src/lib/env');
      await __setTestEnvironment('node');
      configLoaderMock.mockReturnValueOnce({ apiUrl: 'loaded.host.specific', apiKey: 'loaded.api_key.specific' });
      MOCK_API_HTTP_MODULE.ApiHttp.mockClear();
      const { Ship } = await import('../../src/index');
      const shipInstance = new Ship(); // Call without args, Renamed
      await shipInstance.ping(); // This will trigger config loading
      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          apiUrl: 'loaded.host.specific',
          apiKey: 'loaded.api_key.specific'
        })
      );
    });

    it('should use default API host from core/config.ts if loadConfig provides no host and no direct option', async () => {
      const { __setTestEnvironment } = await import('../../src/lib/env');
      await __setTestEnvironment('node');
      configLoaderMock.mockReturnValueOnce({ apiKey: 'loaded.api_key.no.host' }); // loadConfig returns no api
      MOCK_API_HTTP_MODULE.ApiHttp.mockClear();
      const { Ship } = await import('../../src/index');
      const shipInstance = new Ship({}); // Call with empty options, Renamed
      await shipInstance.ping(); // This will trigger config loading
      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          apiUrl: 'https://api.shipstatic.com', // Actual default from constants.ts
          apiKey: 'loaded.api_key.no.host'
        })
      );
    });
  });

  describe('ShipClient.deployments.create() - DeployOptions Passthrough', () => {
    beforeEach(async () => {
      const { __setTestEnvironment } = await import('../../src/lib/env');
      await __setTestEnvironment('node');
      const { Ship } = await import('../../src/index');
      client = new Ship({ apiUrl: MOCK_API_HOST, apiKey: 'mock_api_key' });
    });
    
    it('should use client default progress callbacks if not provided in options', async () => {
      const { Ship } = await import('../../src/index');
      const defaultProgressCallback = vi.fn();
      const clientWithDefaults = new Ship({ 
        apiUrl: MOCK_API_HOST, 
        apiKey: 'mock_api_key',
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
      await clientWithDefaults.deployments.create(mockFiles, {});
      
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
      const { __setTestEnvironment } = await import('../../src/lib/env');
      await __setTestEnvironment('unknown');
      
      const { Ship } = await import('../../src/index');
      const { ShipError } = await import('@shipstatic/types'); // ShipError class for instanceof
      
      // The error should be thrown when creating the client, not when calling deploy
      expect(() => {
        new Ship({ api: MOCK_API_HOST, apiKey: 'mock_api_key' });
      }).toThrow('Unsupported execution environment');
      
      try {
        new Ship({ api: MOCK_API_HOST, apiKey: 'mock_api_key' });
        // We shouldn't reach this point
        expect.fail('Should have thrown an error');
      } catch (e) {
        expect(e).toBeInstanceOf(ShipError);
        // Cast to ShipErrorClassType (which is typeof ShipError from errors.ts) or Error to access message
        expect((e as ShipErrorClassType | Error).message).toBe('Unsupported execution environment.');
      }
    });
  });

  describe('Configuration Loading Integration', () => {
    it('should load configuration from environment variables when none provided to constructor', async () => {
      // Set up environment variables
      process.env.SHIP_API_KEY = 'env-test-key';
      process.env.SHIP_API_URL = 'https://env-test-api.com';  
      
      // Set Node.js environment
      const { __setTestEnvironment } = await import('../../src/lib/env');
      await __setTestEnvironment('node');
      
      // Clear existing mocks for the config loader
      configLoaderMock.mockReturnValueOnce({
        apiKey: 'env-test-key',
        apiUrl: 'https://env-test-api.com'
      });
      
      // Reset the ApiHttp mock to track calls
      MOCK_API_HTTP_MODULE.ApiHttp.mockClear();
      
      const { Ship } = await import('../../src/index');
      const ship = new Ship(); // No options provided - should load from env/config
      
      // Trigger config loading
      await ship.ping();
      
      // Verify that the ApiHttp instance was re-created with the loaded config
      // The second call should have the correct configuration
      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenLastCalledWith(
        expect.objectContaining({
          apiKey: 'env-test-key',
          apiUrl: 'https://env-test-api.com'
        })
      );
      
      // Clean up
      delete process.env.SHIP_API_KEY;
      delete process.env.SHIP_API_URL;
    });

    it('should prioritize constructor options over environment variables', async () => {
      // Set up environment variables that should be ignored
      process.env.SHIP_API_KEY = 'env-ignored-key';
      process.env.SHIP_API_URL = 'https://env-ignored.com';  
      
      // Set Node.js environment
      const { __setTestEnvironment } = await import('../../src/lib/env');
      await __setTestEnvironment('node');
      
      // Reset the ApiHttp mock to track calls  
      MOCK_API_HTTP_MODULE.ApiHttp.mockClear();
      
      const { Ship } = await import('../../src/index');
      const ship = new Ship({
        apiKey: 'constructor-priority-key',
        apiUrl: 'https://constructor-priority.com'
      });
      
      // Trigger config initialization
      await ship.ping();
      
      // Verify constructor options took precedence
      // First call should have constructor options
      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'constructor-priority-key',
          apiUrl: 'https://constructor-priority.com'
        })
      );
      
      // Clean up
      delete process.env.SHIP_API_KEY;
      delete process.env.SHIP_API_URL;
    });
  });
});
