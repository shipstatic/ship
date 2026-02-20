/**
 * @vitest-environment jsdom
 */
/**
 * Browser Ship SDK Tests
 * 
 * This file tests the browser-specific Ship SDK functionality including:
 * - File processing from File[], FileList, and HTMLInputElement
 * - Browser environment validation
 * - Configuration handling
 * - Cross-browser compatibility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// For TypeScript type checking
type Constructor<T> = new (...args: any[]) => T;
// Import directly from '../../src/browser/index' to test browser exports
import BrowserIndex, {
    Ship,
    processFilesForBrowser,
    // We also need __setTestEnvironment for the test setup itself.
    __setTestEnvironment
} from '../../src/browser/index';
// Import ShipClient as a type
import type { StaticFile } from '../../src/browser/index';
// Import error class
import { ShipError } from '@shipstatic/types';
import { setConfig } from '../../src/shared/core/platform-config';

// Mock API HTTP client
const mockApiHttpInstance = {
  getConfig: vi.fn().mockResolvedValue({
    maxFileSize: 10 * 1024 * 1024,
    maxFilesCount: 1000,
    maxTotalSize: 100 * 1024 * 1024,
  }),
};

const { MOCK_API_HTTP_MODULE } = vi.hoisted(() => ({
  MOCK_API_HTTP_MODULE: {
    ApiHttp: vi.fn(() => mockApiHttpInstance),
  }
}));

vi.mock('../../src/shared/api/http', () => MOCK_API_HTTP_MODULE);


// Mock for configLoader
const { CONFIG_LOADER_MOCK_IMPLEMENTATION } = vi.hoisted(() => ({
  CONFIG_LOADER_MOCK_IMPLEMENTATION: {
    loadConfig: vi.fn(),
    DEFAULT_API_HOST: 'https://default.browser.loaded.host',
    resolveConfig: vi.fn((userOptions = {}, loadedConfig = {}) => ({
      apiUrl: userOptions.apiUrl || loadedConfig.apiUrl || 'https://api.shipstatic.com',
      apiKey: userOptions.apiKey !== undefined ? userOptions.apiKey : loadedConfig.apiKey
    })),
    mergeDeployOptions: vi.fn((userOptions = {}, clientDefaults = {}) => ({
      ...clientDefaults,
      ...userOptions
    }))
  }
}));
vi.mock('../../src/shared/core/config', () => CONFIG_LOADER_MOCK_IMPLEMENTATION);
const configLoaderMock = CONFIG_LOADER_MOCK_IMPLEMENTATION;


const { MOCK_CALCULATE_MD5_FN } = vi.hoisted(() => ({ MOCK_CALCULATE_MD5_FN: vi.fn() }));
vi.mock('../../src/shared/lib/md5', () => ({ calculateMD5: MOCK_CALCULATE_MD5_FN }));
// __setTestEnvironment is imported from @/browser, so direct mock of ../../src/shared/lib/env.js is not needed here
// if the re-export chain for __setTestEnvironment is correct.


const createMockFile = (name: string, content: string, type = 'text/plain', webkitRelativePath?: string): File => {
  const blob = new Blob([content], { type });
  // Temporarily cast to any to add webkitRelativePath if it doesn't exist on the type
  const file = new File([blob], name, { type, lastModified: Date.now() }) as any;
  if (webkitRelativePath !== undefined) {
    file.webkitRelativePath = webkitRelativePath;
  }
  return file as File;
};

describe('Browser Entry Point (@/browser)', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    MOCK_CALCULATE_MD5_FN.mockResolvedValue({ md5: 'mocked-md5-hash' });
    configLoaderMock.loadConfig.mockResolvedValue({
      apiUrl: 'https://mock.browser.host',
      apiKey: 'mock_browser_key'
    });
    // __setTestEnvironment is now imported from @/browser
    __setTestEnvironment('browser');

    // Initialize platform config (required by processFilesForBrowser)
    setConfig({
      maxFileSize: 10 * 1024 * 1024,
      maxFilesCount: 1000,
      maxTotalSize: 100 * 1024 * 1024,
    });
  });

  afterEach(() => {
    __setTestEnvironment(null);
  });

  describe('Re-exports from ../../src/index', () => {
    it('should re-export Ship class and provide ShipClient type', async () => {
      // Only check Ship is defined since ShipClient is now just a type
      expect(Ship).toBeDefined();
      const client = new Ship(); // Pass empty options
      // Check if client has expected resource methods instead of legacy deploy
      expect(typeof client.deployments.create).toBe('function');
    });

    it('should re-export __setTestEnvironment (used by tests)', () => {
        expect(__setTestEnvironment).toBeDefined();
    });

    it('should have Ship as the default export', () => {
        expect(BrowserIndex).toBeDefined();
        expect(BrowserIndex).toBe(Ship);
    });
  });

  describe('Browser-specific utility re-exports (processFilesForBrowser)', () => {
    it('should process File[] correctly', async () => {
      const files = [
        createMockFile('file1.txt', 'content1', 'text/plain', 'folder/file1.txt'),
        createMockFile('file2.jpg', 'image data', 'image/jpeg', 'folder/file2.jpg'),
      ];
      const staticFiles = await processFilesForBrowser(files);

      expect(staticFiles).toHaveLength(2);
      expect(staticFiles[0].path).toBe('file1.txt'); // Now flattened by default
      expect(MOCK_CALCULATE_MD5_FN).toHaveBeenCalledWith(files[0]);
    });

    it('should throw ShipError.business if called in non-browser env', async () => {
      __setTestEnvironment('node'); // Force non-browser env for this test
      await expect(processFilesForBrowser([])).rejects.toThrow(
        ShipError.business('processFilesForBrowser can only be called in a browser environment.')
      );
    });
  });

});
