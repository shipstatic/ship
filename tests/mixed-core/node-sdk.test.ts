// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import type { Ship as ShipClass } from '../../src/index'; // Import type for client

// 1. Use vi.hoisted() for variables used in vi.mock factories
const mockApiHttpInstance = {
  ping: vi.fn(),
  getPingResponse: vi.fn().mockResolvedValue({ success: true, timestamp: 1753379248270 }),
  deploy: vi.fn().mockResolvedValue({
    deployment: 'test-deployment-id',
    files: 1,
    size: 1024,
    expires: 1234567890
  }),
  getConfig: vi.fn().mockResolvedValue({
    maxFileSize: 10 * 1024 * 1024,
    maxFilesCount: 1000,
    maxTotalSize: 100 * 1024 * 1024,
  }),
  createToken: vi.fn(),
  listTokens: vi.fn(),
  removeToken: vi.fn(),
};

const { MOCK_API_HTTP_MODULE } = vi.hoisted(() => {
  return {
    MOCK_API_HTTP_MODULE: {
      ApiHttp: vi.fn(() => mockApiHttpInstance),
      DEFAULT_API_HOST: 'https://mockapi.shipstatic.com'
    }
  };
});

// Specific mocks for file utilities
const { NODE_FILE_UTILS_MOCK } = vi.hoisted(() => ({
  NODE_FILE_UTILS_MOCK: { 
    processFilesForNode: vi.fn(),
    findNodeCommonParentDirectory: vi.fn()
  }
}));

// Mock for path helpers
const { PATH_HELPERS_MOCK } = vi.hoisted(() => ({
  PATH_HELPERS_MOCK: {
    findCommonParent: vi.fn()
  }
}));

const { CONFIG_LOADER_MOCK_IMPLEMENTATION } = vi.hoisted(() => {
  return {
    CONFIG_LOADER_MOCK_IMPLEMENTATION: {
      loadConfig: vi.fn(),
      DEFAULT_API_HOST: 'https://loaded.config.host',
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
vi.mock('../../src/shared/api/http', () => MOCK_API_HTTP_MODULE);
vi.mock('../../src/node/core/node-files', () => NODE_FILE_UTILS_MOCK);
vi.mock('../../src/shared/lib/path', () => PATH_HELPERS_MOCK);
vi.mock('../../src/shared/core/config', () => CONFIG_LOADER_MOCK_IMPLEMENTATION);

// Aliases to the mocked implementations
const apiClientMock = mockApiHttpInstance;
const fileUtilsMock = NODE_FILE_UTILS_MOCK;
const configLoaderMock = CONFIG_LOADER_MOCK_IMPLEMENTATION.loadConfig;

// Constants for testing file size validation
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_TOTAL_SIZE = 25 * 1024 * 1024; // 25MB
const MAX_FILES_COUNT = 100; // Maximum number of files

describe('NodeShipClient', () => {
  let client: ShipClass; // Typed client
  const MOCK_API_HOST = 'https://custom.example.com';
  const MOCK_API_KEY = 'custom_test_key';
  let originalEnv: NodeJS.ProcessEnv;

  afterEach(async () => {
    const { __setTestEnvironment } = await import('../../src/shared/lib/env');
    await __setTestEnvironment(null);
    vi.clearAllMocks();
    process.env = originalEnv; // Restore environment variables
  });

  beforeEach(async () => {
    originalEnv = { ...process.env }; // Save original environment
    // Clear relevant env vars before each test
    delete process.env.SHIP_API_KEY;
    delete process.env.SHIP_API_URL;
    delete process.env.SHIP_TIMEOUT;

    const { __setTestEnvironment } = await import('../../src/shared/lib/env');
    await __setTestEnvironment('node');
    fileUtilsMock.processFilesForNode.mockReset();
    const { Ship } = await import('../../src/index'); // Ship class for instantiation
    client = new Ship({ apiUrl: MOCK_API_HOST, apiKey: MOCK_API_KEY });
  });
  
  it('should prioritize direct options over environment variables', async () => {
    // Setup environment variables
    process.env.SHIP_API_KEY = 'env_api_key';
    process.env.SHIP_API_URL = 'https://env.api.host';
    
    // Mock loadConfig to return environment values to ensure we're testing correctly
    configLoaderMock.mockResolvedValueOnce({
      apiKey: 'env_api_key',
      apiUrl: 'https://env.api.host'
    });
    
    // Import the SDK with a fresh module
    vi.resetModules(); // Reset to ensure mocks and env vars are correctly applied for this test
    const { Ship } = await import('../../src/index'); // Re-import after reset
    
    // Create client with direct options that should override env vars
    const directClient = new Ship({
      apiUrl: 'https://direct.option.host',
      apiKey: 'direct_option_key'
    });
    await directClient.ping(); // This will trigger config loading and client initialization
    
    // Verify the client was initialized with direct options, not env vars
    expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apiUrl: 'https://direct.option.host',
        apiKey: 'direct_option_key',
      })
    );
  });
  
  it('should correctly combine multiple configuration sources with proper precedence', async () => {
    // 1. Setup file config (lowest priority) - simulated by initial loadConfig mock
    const fileConfigValues = {
      apiKey: 'file_api_key',
      apiUrl: 'https://file.api.host',
      timeout: 60000
    };
    
    // 2. Setup environment variables (medium priority)
    process.env.SHIPSTATIC_API_KEY = 'env_api_key'; // Overrides file apiKey
    process.env.SHIPSTATIC_API_URL = 'https://env.api.host'; // Overrides file apiUrl
    // No SHIPSTATIC_TIMEOUT in env, so file timeout should persist through env
    
    // 3. Setup direct options (highest priority)
    const directDeployOptions = {
      apiKey: 'direct_api_key', // Overrides env apiKey
      // No apiUrl in direct options, so env apiUrl should be used
      timeout: 10000 // Overrides file/env timeout
    };
    
    // Mock loadConfig to simulate the combined result of file config overridden by environment variables
    configLoaderMock.mockReturnValueOnce({
      apiKey: process.env.SHIPSTATIC_API_KEY, // Value from env
      apiUrl: process.env.SHIPSTATIC_API_URL, // Value from env
      timeout: fileConfigValues.timeout    // Value from file (as no env override)
    });
    
    // Import the SDK with a fresh module
    vi.resetModules(); // Ensure clean state for module imports and config loading
    const { Ship } = await import('../../src/index'); // Re-import after reset
    
    // Create client with direct options using constructor
    const combinedClient = new Ship(directDeployOptions); // Renamed to avoid conflict with outer scope client
    
    // Clear the mock history to ignore the first call
    MOCK_API_HTTP_MODULE.ApiHttp.mockClear();
    
    // NOW, trigger the async initialization that makes the SECOND, correct call
    await combinedClient.ping();
    
    // Assert against the most recent call, which has the working config
    expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'direct_api_key',        // Direct option takes precedence
        apiUrl: 'https://api.shipstatic.dev', // Working API URL
        timeout: 10000                   // Direct option takes precedence
      })
    );
  });

  describe('NodeShipClient.deployments.create()', () => {
    it('should call processFilesForNode for string[] input', async () => {
      // Mock scanNodePaths to return some files
      fileUtilsMock.processFilesForNode.mockResolvedValueOnce([{ path: 'file.txt', content: Buffer.from("content"), md5:'m', size:1 }]);
      await client.deployments.create(['/path/to/file'], {});
      expect(fileUtilsMock.processFilesForNode).toHaveBeenCalledWith(['/path/to/file'], expect.objectContaining({
        apiKey: 'custom_test_key',
        apiUrl: 'https://custom.example.com'
      }));
    });



    it('should never use basePath for prefixing uploaded paths', async () => {
      // Simulate deeply nested files and a basePath
      PATH_HELPERS_MOCK.findCommonParent.mockReturnValue('/base/folder');
      fileUtilsMock.processFilesForNode.mockResolvedValueOnce([
        { path: 'file1.txt', content: Buffer.from('a'), md5: 'm', size: 1 },
        { path: 'nested/file2.txt', content: Buffer.from('b'), md5: 'm', size: 1 }
      ]);
      await client.deployments.create(['/base/folder/file1.txt', '/base/folder/nested/file2.txt'], { stripCommonPrefix: true });
      // The returned paths should be root-relative, not prefixed with basePath
      expect((apiClientMock.deploy.mock.calls[0][0] as any[]).map(f => f.path)).toEqual(['file1.txt', 'nested/file2.txt']);
    });

    it('should throw or behave as expected if deploy is called in a non-node environment', async () => {
      const { __setTestEnvironment } = await import('../../src/shared/lib/env');
      await __setTestEnvironment('browser');
      
      // Create a new client in browser environment using browser Ship
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      const browserClient = new BrowserShip({ deployToken: 'test-token', apiUrl: MOCK_API_HOST });
      
      // In browser environment, string[] input should throw validation error
      try {
        await browserClient.deployments.create(['/path/to/file'], {});
        expect.fail('Should have thrown an error for string[] input in browser environment');
      } catch (error: any) {
        expect(error.message).toContain('Invalid input type');
      }
      
      // Reset environment
      await __setTestEnvironment('node');
    });

    it('should pass apiKey, apiUrl, and timeout options to uploadFiles', async () => {
      fileUtilsMock.processFilesForNode.mockResolvedValueOnce([{ path: 'file.txt', content: Buffer.from("content"), md5:'m', size:1 }]);
      
      const options = {
        stripCommonPrefix: false,
        timeout: 12345,
        apiKey: 'specific_key_for_upload',
        apiUrl: 'https://specific.host.for.upload'
      };
      
      await client.deployments.create(['/path/to/file'], options);
      
      expect(apiClientMock.deploy).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          timeout: 12345,
          apiKey: 'specific_key_for_upload',
          apiUrl: 'https://specific.host.for.upload'
        })
      );
    });

    it('should throw ShipError for File[] input', async () => {
      const { ShipError } = await import('@shipstatic/types');
      // Simulate a browser File object (minimal mock)
      const fakeFile = { name: 'f.txt', size: 1, type: 'text/plain' };
      await expect(client.deployments.create([fakeFile] as any, {})).rejects.toThrow(ShipError.business('Invalid input type for Node.js environment. Expected string or string[].'));
    });

    it('should throw ShipError for FileList input', async () => {
      const { ShipError } = await import('@shipstatic/types');
      // Simulate a FileList (array-like)
      const fakeFileList = { 0: { name: 'f.txt', size: 1, type: 'text/plain' }, length: 1, item: () => null };
      await expect(client.deployments.create(fakeFileList as any, {})).rejects.toThrow(ShipError.business('Invalid input type for Node.js environment. Expected string or string[].'));
    });

    it('should throw ShipError for HTMLInputElement input', async () => {
      const { ShipError } = await import('@shipstatic/types');
      // Simulate an input element
      const fakeInput = { tagName: 'INPUT', type: 'file', files: [] };
      await expect(client.deployments.create(fakeInput as any, {})).rejects.toThrow(ShipError.business('Invalid input type for Node.js environment. Expected string or string[].'));
    });

    it('should throw ShipError for Buffer input', async () => {
      const { ShipError } = await import('@shipstatic/types');
      const fakeBuffer = Buffer.from('abc');
      await expect(client.deployments.create(fakeBuffer as any, {})).rejects.toThrow(ShipError.business('Invalid input type for Node.js environment. Expected string or string[].'));
    });
    
    // New tests for file validation
    
    // Test for empty file handling - since this happens during processFilesForNode
    it('should exclude empty files during processing', async () => {
      const { ShipError } = await import('@shipstatic/types');
      
      // Setup mock for processFilesForNode to simulate filtering empty files
      fileUtilsMock.processFilesForNode.mockImplementationOnce((paths, options) => {
        // Simulate that one file was empty and got filtered out
        return Promise.resolve([
          { path: 'file.txt', content: Buffer.from('content'), md5: 'md5', size: 7 }
          // 'empty.txt' was filtered out
        ]);
      });
      
      // Mock findCommonParent to return a valid path
      PATH_HELPERS_MOCK.findCommonParent.mockReturnValue('/common/path');
      
      // Call upload with two file paths (one will be "empty" after processing)
      await client.deployments.create(['/common/path/file.txt', '/common/path/empty.txt'], {});
      
      // Verify only one file was uploaded
      expect(apiClientMock.deploy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ path: 'file.txt' })
        ]),
        expect.anything()
      );
      expect((apiClientMock.deploy.mock.calls[0][0] as any[]).length).toBe(1);
    });
    
    it('should validate individual file size during processing', async () => {
      const { ShipError } = await import('@shipstatic/types');
      
      // Setup the mock to throw an error for an oversized file
      fileUtilsMock.processFilesForNode.mockImplementationOnce(() => {
        throw ShipError.business(`File large.txt is too large. Maximum allowed size is 5MB.`);
      });
      
      // Call upload with a file path that will be rejected for size
      await expect(client.deployments.create(['/path/to/large.txt'], {})).rejects.toThrow(
        ShipError.business(`File large.txt is too large. Maximum allowed size is 5MB.`)
      );
    });
    
    it('should validate total upload size during processing', async () => {
      const { ShipError } = await import('@shipstatic/types');

      // Setup the mock to throw an error for total size
      fileUtilsMock.processFilesForNode.mockImplementationOnce(() => {
        throw ShipError.business(`Total upload size is too large. Maximum allowed is 25MB.`);
      });

      // Call upload with multiple files that collectively exceed the size limit
      await expect(client.deployments.create([
        '/path/to/file1.txt',
        '/path/to/file2.txt',
        '/path/to/file3.txt',
        '/path/to/file4.txt',
        '/path/to/file5.txt'
      ], {})).rejects.toThrow(
        ShipError.business(`Total upload size is too large. Maximum allowed is 25MB.`)
      );
    });

    it('should pass labels option to deploy in Node.js environment', async () => {
      const labels = ['production', 'v2.1.0', 'staging'];
      const filePaths = ['/path/to/app.js', '/path/to/index.html'];

      fileUtilsMock.processFilesForNode.mockResolvedValueOnce([
        { path: 'app.js', content: Buffer.from('console.log("hello")'), md5: 'abc123', size: 20 },
        { path: 'index.html', content: Buffer.from('<html></html>'), md5: 'def456', size: 13 }
      ]);

      await client.deployments.create(filePaths, { labels });

      // Verify labels are passed through to the HTTP layer
      expect(apiClientMock.deploy).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          labels: ['production', 'v2.1.0', 'staging']
        })
      );
    });

  });

  describe('NodeShipClient.tokens', () => {
    it('should create token without parameters', async () => {
      apiClientMock.createToken = vi.fn().mockResolvedValue({
        token: 'token-abc123',
        expires: null,
        message: 'Token created successfully'
      });

      const result = await client.tokens.create();

      expect(apiClientMock.createToken).toHaveBeenCalledWith(undefined, undefined);
      expect(result.token).toBe('token-abc123');
    });

    it('should create token with ttl', async () => {
      apiClientMock.createToken = vi.fn().mockResolvedValue({
        token: 'token-def456',
        expires: 1234567890,
        message: 'Token created successfully'
      });

      const result = await client.tokens.create({ ttl: 3600 });

      expect(apiClientMock.createToken).toHaveBeenCalledWith(3600, undefined);
      expect(result.expires).toBe(1234567890);
    });

    it('should create token with labels', async () => {
      const labels = ['production', 'api', 'automated'];
      apiClientMock.createToken = vi.fn().mockResolvedValue({
        token: 'token-ghi789',
        expires: null,
        message: 'Token created successfully'
      });

      const result = await client.tokens.create({ labels });

      expect(apiClientMock.createToken).toHaveBeenCalledWith(undefined, ['production', 'api', 'automated']);
      expect(result.token).toBe('token-ghi789');
    });

    it('should list tokens', async () => {
      apiClientMock.listTokens = vi.fn().mockResolvedValue({
        tokens: [
          { token: 'hash1', account: 'acc1', created: 1234567890, labels: ['production'] },
          { token: 'hash2', account: 'acc1', created: 1234567891, labels: ['staging'] }
        ],
        count: 2
      });

      const result = await client.tokens.list();

      expect(apiClientMock.listTokens).toHaveBeenCalled();
      expect(result.tokens).toHaveLength(2);
      expect(result.count).toBe(2);
    });

    it('should remove token', async () => {
      apiClientMock.removeToken = vi.fn().mockResolvedValue(undefined);

      await client.tokens.remove('token-abc123');

      expect(apiClientMock.removeToken).toHaveBeenCalledWith('token-abc123');
    });
  });
});
