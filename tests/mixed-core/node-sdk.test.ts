// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TEST_PLATFORM_LIMITS } from '../fixtures/platform-limits';
import * as path from 'path';
import type { Ship as ShipClass } from '../../src/index'; // Import type for client
import type { DeploymentOptions } from '../../src/shared/types';

// 1. Use vi.hoisted() for variables used in vi.mock factories
const mockApiHttpInstance = {
  ping: vi.fn(),
  deploy: vi.fn().mockResolvedValue({
    deployment: 'test-deployment-id',
    files: 1,
    size: 1024,
    expires: 1234567890
  }),
  getLimits: vi.fn().mockResolvedValue({
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

// Mock modules using the predefined implementations
vi.mock('../../src/shared/api/http', () => MOCK_API_HTTP_MODULE);
vi.mock('../../src/node/core/node-files', () => NODE_FILE_UTILS_MOCK);
vi.mock('../../src/shared/lib/path', () => PATH_HELPERS_MOCK);

// Aliases to the mocked implementations
const apiClientMock = mockApiHttpInstance;
const fileUtilsMock = NODE_FILE_UTILS_MOCK;

// Constants for testing file size validation
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_TOTAL_SIZE = 25 * 1024 * 1024; // 25MB
const MAX_FILES_COUNT = 100; // Maximum number of files

describe('NodeShipClient', () => {
  let client: ShipClass; // Typed client
  const MOCK_API_HOST = 'https://custom.example.com';
  const MOCK_TOKEN = 'custom_test_key';
  const ENV_TOKEN = 'ship-' + 'a'.repeat(64);
  const DIRECT_TOKEN = 'ship-' + 'b'.repeat(64);
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
    delete process.env.SHIP_TOKEN;
    delete process.env.SHIP_API_URL;

    const { __setTestEnvironment } = await import('../../src/shared/lib/env');
    await __setTestEnvironment('node');
    fileUtilsMock.processFilesForNode.mockReset();
    const { Ship } = await import('../../src/index'); // Ship class for instantiation
    client = new Ship({ apiUrl: MOCK_API_HOST, token: MOCK_TOKEN });
  });
  
  it('prioritizes direct options over environment variables', async () => {
    // Env vars are the SDK's "process boundary" credential source. Constructor
    // args always win — explicit beats ambient.
    process.env.SHIP_TOKEN = ENV_TOKEN;
    process.env.SHIP_API_URL = 'https://env.api.host';

    vi.resetModules();
    const { Ship } = await import('../../src/index');

    new Ship({
      apiUrl: 'https://direct.option.host',
      token: DIRECT_TOKEN,
    });

    expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apiUrl: 'https://direct.option.host',
        token: DIRECT_TOKEN,
      })
    );
  });

  it('falls back to env vars for credentials not provided in constructor', async () => {
    // The SDK fills in missing fields from SHIP_* env vars. This is the
    // "process boundary" — how containers, CI, and embedded consumers
    // (MCP, n8n, Action) deliver credentials without code changes.
    process.env.SHIP_TOKEN = ENV_TOKEN;
    process.env.SHIP_API_URL = 'https://env.api.host';

    vi.resetModules();
    const { Ship } = await import('../../src/index');

    // Constructor sets apiUrl explicitly but leaves the token to env.
    new Ship({ apiUrl: 'https://direct.option.host' });

    expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apiUrl: 'https://direct.option.host', // direct wins
        token: ENV_TOKEN,                      // env fills the gap
      })
    );
  });

  describe('NodeShipClient.deployments.upload()', () => {
    it('should call processFilesForNode for string[] input', async () => {
      // Mock scanNodePaths to return some files
      fileUtilsMock.processFilesForNode.mockResolvedValueOnce([{ path: 'file.txt', content: Buffer.from("content"), md5:'m', size:1 }]);
      await client.deployments.upload(['/path/to/file'], {});
      expect(fileUtilsMock.processFilesForNode).toHaveBeenCalledWith(
        ['/path/to/file'],
        expect.any(Object),
        // Platform limits — hydrated from the mocked /config fetch.
        expect.objectContaining({ maxFileSize: expect.any(Number) }),
      );
    });



    it('should never use basePath for prefixing uploaded paths', async () => {
      // Simulate deeply nested files and a basePath
      PATH_HELPERS_MOCK.findCommonParent.mockReturnValue('/base/folder');
      fileUtilsMock.processFilesForNode.mockResolvedValueOnce([
        { path: 'file1.txt', content: Buffer.from('a'), md5: 'm', size: 1 },
        { path: 'nested/file2.txt', content: Buffer.from('b'), md5: 'm', size: 1 }
      ]);
      await client.deployments.upload(['/base/folder/file1.txt', '/base/folder/nested/file2.txt'], { pathDetect: true } as DeploymentOptions);
      // The returned paths should be root-relative, not prefixed with basePath
      expect((apiClientMock.deploy.mock.calls[0][0] as any[]).map(f => f.path)).toEqual(['file1.txt', 'nested/file2.txt']);
    });

    it('should throw or behave as expected if deploy is called in a non-node environment', async () => {
      const { __setTestEnvironment } = await import('../../src/shared/lib/env');
      await __setTestEnvironment('browser');
      
      // Create a new client in browser environment using browser Ship
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      const browserClient = new BrowserShip({ token: 'test-token', apiUrl: MOCK_API_HOST });
      
      // In browser environment, string[] input should throw validation error
      try {
        await browserClient.deployments.upload(['/path/to/file'], {});
        expect.fail('Should have thrown an error for string[] input in browser environment');
      } catch (error: any) {
        expect(error.message).toContain('Invalid input type');
      }
      
      // Reset environment
      await __setTestEnvironment('node');
    });

    it('should pass timeout option to uploadFiles', async () => {
      fileUtilsMock.processFilesForNode.mockResolvedValueOnce([{ path: 'file.txt', content: Buffer.from("content"), md5:'m', size:1 }]);

      const options: DeploymentOptions = {
        pathDetect: false,
        timeout: 12345
      };

      await client.deployments.upload(['/path/to/file'], options);

      expect(apiClientMock.deploy).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          timeout: 12345
        })
      );
    });

    it('should throw ShipError for File[] input', async () => {
      const { ShipError } = await import('@shipstatic/types');
      // Simulate a browser File object (minimal mock)
      const fakeFile = { name: 'f.txt', size: 1, type: 'text/plain' };
      await expect(client.deployments.upload([fakeFile] as any, {})).rejects.toThrow(ShipError.business('Invalid input type for Node.js environment. Expected string or string[].'));
    });

    it('should throw ShipError for FileList input', async () => {
      const { ShipError } = await import('@shipstatic/types');
      // Simulate a FileList (array-like)
      const fakeFileList = { 0: { name: 'f.txt', size: 1, type: 'text/plain' }, length: 1, item: () => null };
      await expect(client.deployments.upload(fakeFileList as any, {})).rejects.toThrow(ShipError.business('Invalid input type for Node.js environment. Expected string or string[].'));
    });

    it('should throw ShipError for HTMLInputElement input', async () => {
      const { ShipError } = await import('@shipstatic/types');
      // Simulate an input element
      const fakeInput = { tagName: 'INPUT', type: 'file', files: [] };
      await expect(client.deployments.upload(fakeInput as any, {})).rejects.toThrow(ShipError.business('Invalid input type for Node.js environment. Expected string or string[].'));
    });

    it('should throw ShipError for Buffer input', async () => {
      const { ShipError } = await import('@shipstatic/types');
      const fakeBuffer = Buffer.from('abc');
      await expect(client.deployments.upload(fakeBuffer as any, {})).rejects.toThrow(ShipError.business('Invalid input type for Node.js environment. Expected string or string[].'));
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
      await client.deployments.upload(['/common/path/file.txt', '/common/path/empty.txt'], {});
      
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
      await expect(client.deployments.upload(['/path/to/large.txt'], {})).rejects.toThrow(
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
      await expect(client.deployments.upload([
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

      await client.deployments.upload(filePaths, { labels });

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
        token: 'a1b2c3d',
        secret: 'deploy-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        expires: null,
        labels: []
      });

      const result = await client.tokens.create();

      expect(apiClientMock.createToken).toHaveBeenCalledWith(undefined, undefined);
      expect(result.token).toBe('a1b2c3d');
    });

    it('should create token with ttl', async () => {
      apiClientMock.createToken = vi.fn().mockResolvedValue({
        token: 'd3f4567',
        secret: 'deploy-d3f4567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        expires: 1234567890,
        labels: []
      });

      const result = await client.tokens.create({ ttl: 3600 });

      expect(apiClientMock.createToken).toHaveBeenCalledWith(3600, undefined);
      expect(result.expires).toBe(1234567890);
    });

    it('should create token with labels', async () => {
      const labels = ['production', 'api', 'automated'];
      apiClientMock.createToken = vi.fn().mockResolvedValue({
        token: 'g7h8i9j',
        secret: 'deploy-g7h8i9j0123456789abcdef0123456789abcdef0123456789abcdef01234567',
        expires: null,
        labels: ['production', 'api', 'automated']
      });

      const result = await client.tokens.create({ labels });

      expect(apiClientMock.createToken).toHaveBeenCalledWith(undefined, ['production', 'api', 'automated']);
      expect(result.token).toBe('g7h8i9j');
    });

    it('should list tokens', async () => {
      apiClientMock.listTokens = vi.fn().mockResolvedValue({
        tokens: [
          { token: 't0kn001', account: 'acc1', created: 1234567890, labels: ['production'] },
          { token: 't0kn002', account: 'acc1', created: 1234567891, labels: ['staging'] }
        ],
        total: 2
      });

      const result = await client.tokens.list();

      expect(apiClientMock.listTokens).toHaveBeenCalled();
      expect(result.tokens).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should remove token', async () => {
      apiClientMock.removeToken = vi.fn().mockResolvedValue(undefined);

      await client.tokens.remove('a1b2c3d');

      expect(apiClientMock.removeToken).toHaveBeenCalledWith('a1b2c3d');
    });
  });
});
