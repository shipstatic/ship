import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Ship } from '../../src/node/index';
import { __setTestEnvironment } from '../../src/shared/lib/env';
import { ShipError } from '@shipstatic/types';

// Mock the ApiHttp class to prevent real network calls
const mockApiClient = {
  ping: vi.fn().mockResolvedValue(true),
  deploy: vi.fn().mockResolvedValue({ id: 'dep_123', url: 'https://dep_123.shipstatic.dev' }),
  getAccount: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
  getConfig: vi.fn().mockResolvedValue({ maxFileSize: 10485760 }),
  checkSPA: vi.fn().mockResolvedValue(false)
};

vi.mock('../../src/shared/api/http', () => ({
  ApiHttp: vi.fn(() => mockApiClient)
}));

// Mock Node.js file processing
vi.mock('../../src/node/core/node-files', () => ({
  processFilesForNode: vi.fn().mockResolvedValue([
    { path: 'index.html', content: Buffer.from('<html></html>'), size: 13, md5: 'abc123' }
  ])
}));

// Mock platform config
vi.mock('../../src/node/core/platform-config', () => ({
  setConfig: vi.fn(),
  getCurrentConfig: vi.fn().mockReturnValue({})
}));

// Mock config loading
vi.mock('../../src/node/core/config', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    apiKey: 'test-key',
    apiUrl: 'https://test-api.com'
  })
}));

describe('Ship - Node.js Implementation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setTestEnvironment('node'); // Ensure we're in Node.js environment for tests
  });

  describe('constructor', () => {
    it('should create Ship instance in Node.js environment', () => {
      const ship = new Ship({ apiKey: 'test-key' });
      expect(ship).toBeInstanceOf(Ship);
    });

    it('should reject creation in non-Node.js environment', () => {
      __setTestEnvironment('browser');
      
      expect(() => {
        new Ship({ apiKey: 'test-key' });
      }).toThrow('Node.js Ship class can only be used in Node.js environment.');
    });

    it('should reject creation in unknown environment', () => {
      __setTestEnvironment('unknown');
      
      expect(() => {
        new Ship({ apiKey: 'test-key' });
      }).toThrow('Node.js Ship class can only be used in Node.js environment.');
    });
  });

  describe('configuration loading', () => {
    it('should load configuration from files and environment', async () => {
      const ship = new Ship({ configFile: '.shiprc' });
      
      // Mock the HTTP client to avoid actual network calls
      (ship as any).http = {
        getConfig: vi.fn().mockResolvedValue({ maxFileSize: 1000000 }),
        ping: vi.fn().mockResolvedValue(true)
      };

      await ship.ping(); // This triggers initialization

      // Verify that the config loading was attempted
      const { loadConfig } = await import('../../src/node/core/config');
      expect(loadConfig).toHaveBeenCalledWith('.shiprc');
    });
  });

  describe('deploy functionality', () => {
    it('should process directory paths correctly', async () => {
      const ship = new Ship({ apiKey: 'test-key' });
      
      // Mock the API client
      (ship as any).http = {
        deploy: vi.fn().mockResolvedValue({
          id: 'dep_123',
          url: 'https://dep_123.shipstatic.dev'
        }),
        getConfig: vi.fn().mockResolvedValue({}),
        checkSPA: vi.fn().mockResolvedValue(false)
      };

      const result = await ship.deploy('./dist');

      expect(result).toEqual({
        id: 'dep_123',
        url: 'https://dep_123.shipstatic.dev'
      });
    });

    it('should handle file arrays', async () => {
      // Update the global mock to return the expected value for this test
      mockApiClient.deploy.mockResolvedValue({
        id: 'dep_456',
        url: 'https://dep_456.shipstatic.dev'
      });

      const ship = new Ship({ apiKey: 'test-key' });
      const result = await ship.deploy(['./index.html', './style.css']);

      expect(result).toEqual({
        id: 'dep_456',
        url: 'https://dep_456.shipstatic.dev'
      });
    });
  });

  describe('exported utilities', () => {
    it('should export Node.js specific utilities', async () => {
      const nodeModule = await import('../../src/node/index');

      expect(nodeModule.loadConfig).toBeDefined();
      expect(nodeModule.setPlatformConfig).toBeDefined();
      expect(nodeModule.getCurrentConfig).toBeDefined();
      expect(nodeModule.processFilesForNode).toBeDefined();
      expect(nodeModule.getENV).toBeDefined();
      expect(nodeModule.__setTestEnvironment).toBeDefined();
    });
  });

  describe('resource functionality', () => {
    it('should provide access to all resources', () => {
      const ship = new Ship({ apiKey: 'test-key' });

      expect(ship.deployments).toBeDefined();
      expect(ship.domains).toBeDefined();
      expect(ship.account).toBeDefined();
    });
  });

  describe('Node.js deployment edge cases (migrated from node-sdk.test.ts)', () => {
    it('should call processInput for string[] input (file paths)', async () => {
      const ship = new Ship({ apiKey: 'test-key' });
      
      // Mock the processInput method
      const mockProcessInput = vi.fn().mockResolvedValue([
        { path: 'file.txt', content: Buffer.from('content'), size: 7, md5: 'hash' }
      ]);
      
      (ship as any).processInput = mockProcessInput;
      (ship as any).http = {
        deploy: vi.fn().mockResolvedValue({
          id: 'dep_paths_123',
          url: 'https://dep_paths_123.shipstatic.dev'
        }),
        getConfig: vi.fn().mockResolvedValue({}),
        checkSPA: vi.fn().mockResolvedValue(false)
      };

      await ship.deploy(['./dist/index.html', './dist/style.css']);

      expect(mockProcessInput).toHaveBeenCalledWith(
        ['./dist/index.html', './dist/style.css'],
        expect.any(Object)
      );
    });

    it('should throw error for File[] input in Node.js (browser-only input)', async () => {
      const ship = new Ship({ apiKey: 'test-key' });

      const mockFiles = [new File(['content'], 'test.txt')] as any;
      
      // This should fail because File[] is not supported in Node.js
      await expect(ship.deploy(mockFiles))
        .rejects.toThrow();
    });

    it('should throw error for FileList input in Node.js (browser-only input)', async () => {
      const ship = new Ship({ apiKey: 'test-key' });

      const mockFileList = {
        0: new File(['content'], 'test.txt'),
        length: 1,
        item: () => null
      } as any;
      
      // This should fail because FileList is not supported in Node.js  
      await expect(ship.deploy(mockFileList))
        .rejects.toThrow();
    });

    it('should throw error for HTMLInputElement in Node.js (browser-only input)', async () => {
      const ship = new Ship({ apiKey: 'test-key' });

      const mockInput = {
        tagName: 'INPUT',
        type: 'file',
        files: null
      } as any;
      
      // This should fail because HTMLInputElement is not supported in Node.js
      await expect(ship.deploy(mockInput))
        .rejects.toThrow();
    });

    it('should prioritize constructor options over environment variables', async () => {
      // Set environment variables
      process.env.SHIP_API_URL = 'https://env.example.com';
      process.env.SHIP_API_KEY = 'env-key';

      const ship = new Ship({ 
        apiUrl: 'https://constructor.example.com',
        apiKey: 'constructor-key'
      });

      // Constructor options should take precedence
      expect((ship as any).clientOptions.apiUrl).toBe('https://constructor.example.com');
      expect((ship as any).clientOptions.apiKey).toBe('constructor-key');

      // Clean up
      delete process.env.SHIP_API_URL;
      delete process.env.SHIP_API_KEY;
    });

    it('should handle directory paths correctly', async () => {
      const ship = new Ship({ apiKey: 'test-key' });
      
      const mockProcessInput = vi.fn().mockResolvedValue([
        { path: 'index.html', content: Buffer.from('<html></html>'), size: 13, md5: 'hash1' },
        { path: 'style.css', content: Buffer.from('body {}'), size: 7, md5: 'hash2' }
      ]);
      
      (ship as any).processInput = mockProcessInput;
      
      // Update the global mock for this test
      mockApiClient.deploy.mockResolvedValue({
        id: 'dep_dir_123',
        url: 'https://dep_dir_123.shipstatic.dev'
      });

      const result = await ship.deploy('./dist');

      expect(mockProcessInput).toHaveBeenCalledWith('./dist', expect.any(Object));
      expect(result).toEqual({
        id: 'dep_dir_123',
        url: 'https://dep_dir_123.shipstatic.dev'
      });
    });

    it('should pass deployment options correctly to processInput', async () => {
      const ship = new Ship({ apiKey: 'test-key' });
      
      const mockProcessInput = vi.fn().mockResolvedValue([]);
      (ship as any).processInput = mockProcessInput;
      (ship as any).http = {
        deploy: vi.fn().mockResolvedValue({
          id: 'dep_opt_123',
          url: 'https://dep_opt_123.shipstatic.dev'
        }),
        getConfig: vi.fn().mockResolvedValue({}),
        checkSPA: vi.fn().mockResolvedValue(false)
      };

      const options = {
        timeout: 30000,
        maxConcurrency: 10,
        pathDetect: false,
        spaDetect: false
      };

      await ship.deploy(['./src/index.html'], options);

      expect(mockProcessInput).toHaveBeenCalledWith(
        ['./src/index.html'],
        expect.objectContaining(options)
      );
    });
  });

  describe('standardized error handling', () => {
    it('should reject File[] input with consistent error message', async () => {
      const ship = new Ship({ apiKey: 'test-key' });

      const mockFiles = [new File(['content'], 'test.txt')] as any;
      
      await expect(ship.deploy(mockFiles))
        .rejects.toThrow('Invalid input type for Node.js environment. Expected string or string[].');
    });

    it('should reject FileList input with consistent error message', async () => {
      const ship = new Ship({ apiKey: 'test-key' });

      const mockFileList = {
        0: new File(['content'], 'test.txt'),
        length: 1,
        item: () => null
      } as any;
      
      await expect(ship.deploy(mockFileList))
        .rejects.toThrow('Invalid input type for Node.js environment. Expected string or string[].');
    });

    it('should reject HTMLInputElement input with consistent error message', async () => {
      const ship = new Ship({ apiKey: 'test-key' });

      const mockInput = {
        tagName: 'INPUT',
        type: 'file',
        files: null
      } as any;
      
      await expect(ship.deploy(mockInput))
        .rejects.toThrow('Invalid input type for Node.js environment. Expected string or string[].');
    });

    it('should reject invalid object types with consistent error message', async () => {
      const ship = new Ship({ apiKey: 'test-key' });

      await expect(ship.deploy({ invalid: 'object' } as any))
        .rejects.toThrow('Invalid input type for Node.js environment. Expected string or string[].');
    });

    it('should handle empty path arrays with consistent error message', async () => {
      const ship = new Ship({ apiKey: 'test-key' });

      await expect(ship.deploy([]))
        .rejects.toThrow('No files to deploy.');
    });

    it('should handle network errors consistently', async () => {
      // Set up the global mock to reject with network error
      mockApiClient.deploy.mockRejectedValue(new Error('Request timeout after 30000ms'));
      
      const ship = new Ship({ apiKey: 'test-key' });

      await expect(ship.deploy(['./test.html']))
        .rejects.toThrow('Request timeout after 30000ms');
    });

    it('should handle API errors consistently', async () => {
      // Set up the global mock to reject with API error
      mockApiClient.deploy.mockRejectedValue(new Error('API key is invalid'));
      
      const ship = new Ship({ apiKey: 'invalid-key' });

      await expect(ship.deploy(['./test.html']))
        .rejects.toThrow('API key is invalid');
    });

    it('should handle configuration errors consistently', async () => {
      // Test with missing API key - constructor should succeed
      const ship = new Ship({} as any);
      expect(ship).toBeDefined(); // Constructor allows empty config, API calls will validate
    });
  });
});