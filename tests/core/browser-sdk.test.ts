// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Ship as ShipClass } from '@/index'; // Import type for client

// 1. Use vi.hoisted() for variables used in vi.mock factories
const mockApiHttpInstance = {
  deploy: vi.fn().mockResolvedValue({
    deployment: 'test-deployment-id',
    filesCount: 1,
    totalSize: 1024,
    expiresAt: 1234567890
  }),
  ping: vi.fn(),
  getPingResponse: vi.fn().mockResolvedValue({ success: true, timestamp: 1753379248270 }),
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
      DEFAULT_API_HOST: 'https://mockapi.shipstatic.com'
    }
  };
});

// Specific mocks for browser file utilities
const { BROWSER_FILE_UTILS_MOCK } = vi.hoisted(() => ({
  BROWSER_FILE_UTILS_MOCK: {
    processFilesForBrowser: vi.fn()
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
vi.mock('@/api/http', () => MOCK_API_HTTP_MODULE);
vi.mock('@/lib/browser-files', () => BROWSER_FILE_UTILS_MOCK);
vi.mock('@/core/config', () => CONFIG_LOADER_MOCK_IMPLEMENTATION);

// Helper to create a mock File object for browser tests
function mockF(name: string, content: string = '', path?: string): File {
  // The File constructor is available in jsdom/vitest
  const file = new File([content], name, { type: 'text/plain' });
  if (path) {
    // Optionally add a custom property for relativePath if needed by the code/tests
    (file as any).relativePath = path;
  }
  return file;
}

// Aliases to the mocked implementations
const apiClientMock = mockApiHttpInstance;
const fileUtilsMock = BROWSER_FILE_UTILS_MOCK;
const configLoaderMock = CONFIG_LOADER_MOCK_IMPLEMENTATION.loadConfig;

describe('BrowserShipClient', () => {
  let client: ShipClass; // Typed client
  let mockInput: HTMLInputElement;
  const MOCK_API_HOST = 'https://custom.example.com';
  const MOCK_API_KEY = 'custom_test_key';

  afterEach(async () => {
    const { __setTestEnvironment } = await import('@/lib/env');
    await __setTestEnvironment(null);
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const { __setTestEnvironment } = await import('@/lib/env');
    await __setTestEnvironment('browser');
    
    // Reset and setup browser-specific mocks
    fileUtilsMock.processFilesForBrowser.mockReset();
    fileUtilsMock.processFilesForBrowser.mockResolvedValue([{ path: 'browserfile.txt', content: new Blob(['content']), md5: 'md5-browser', size: 7 }]);
    
    const { Ship } = await import('@/index'); // Ship class for instantiation
    client = new Ship({ apiUrl: MOCK_API_HOST, apiKey: MOCK_API_KEY });
    
    // Create mock HTML input element for tests
    mockInput = document.createElement('input') as HTMLInputElement;
    mockInput.type = 'file';
    const f1 = mockF('f1', 'c1', 'c/f1'), f2 = mockF('f2', 'c2', 'c/f2');
    Object.defineProperty(mockInput, 'files', {
      value: {
        0: f1,
        1: f2,
        length: 2,
        item(i: number) { return i === 0 ? f1 : f2; },
        [Symbol.iterator]: function* () { yield f1; yield f2; }
      } as FileList,
      writable: true
    });
  });

  describe('BrowserShipClient.deployments.create()', () => {
    it('should call processFilesForBrowser for File[] input', async () => {
      await client.deployments.create([mockF('f.txt', 'c')], {});
      expect(fileUtilsMock.processFilesForBrowser).toHaveBeenCalledWith(
        [expect.any(File)],
        expect.objectContaining({
          apiKey: 'custom_test_key',
          apiUrl: 'https://custom.example.com'
        })
      );
    });


    it('should throw ShipError for non-browser input type', async () => {
      const { ShipError } = await import('@shipstatic/types');
      await expect(client.deployments.create(['/path/to/file'] as any, {})).rejects.toThrow(ShipError.business('Invalid input type for browser environment. Expected File[], FileList, or HTMLInputElement.'));
    });

    it('should correctly process HTMLInputElement', async () => {
      await client.deployments.create(mockInput, { stripCommonPrefix: false });
      expect(fileUtilsMock.processFilesForBrowser).toHaveBeenCalledWith(
        Array.from(mockInput.files!), // Ensure FileList is converted to File[]
        expect.objectContaining({
          stripCommonPrefix: false,
          apiKey: 'custom_test_key',
          apiUrl: 'https://custom.example.com'
        })
      );
    });


    it('should pass API and timeout options to deployFiles', async () => {
      const specificDeployOptions = {
        stripCommonPrefix: false,
        timeout: 12345,
        apiKey: 'specific_key_for_deploy',
        apiUrl: 'https://specific.host.for.deploy'
      };
      
      // Create a valid browser input (File array) and mock processFilesForBrowser
      const file1 = mockF('test.txt', 'content');
      const files = [file1];
      fileUtilsMock.processFilesForBrowser.mockResolvedValueOnce([{ path: 'file.txt', content: new Blob(['content']), md5:'m', size:1 }]);
      
      // Call deploy with browser-compatible input
      await client.deployments.create(files, specificDeployOptions);
      
      // Verify we're passing the options through correctly to processFiles
      expect(fileUtilsMock.processFilesForBrowser).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ stripCommonPrefix: false })
      );
      
      // uploadFiles is called internally by client.deploy after processing input
      // It then calls http.upload. We check the options passed to http.upload (via apiClientMock.deploy)
      expect(apiClientMock.deploy).toHaveBeenCalledWith(
        expect.any(Array), // The static files from processFilesForBrowser
        expect.objectContaining({
          timeout: 12345,
          apiKey: 'specific_key_for_deploy',
          apiUrl: 'https://specific.host.for.deploy'
        })
      );
    });
  });
});
