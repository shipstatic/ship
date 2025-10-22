/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Ship } from '../../src/browser/index';
import { __setTestEnvironment } from '../../src/shared/lib/env';

// Mock browser file processing
vi.mock('../../src/browser/lib/browser-files', () => ({
  processFilesForBrowser: vi.fn().mockResolvedValue([
    { path: 'index.html', content: new ArrayBuffer(13), size: 13, md5: 'abc123' }
  ])
}));

// Mock browser config (browser only has loadConfig, no setConfig)
vi.mock('../../src/browser/core/config', () => ({
  loadConfig: vi.fn().mockResolvedValue({})
}));

describe('Ship - Browser Implementation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setTestEnvironment('browser'); // Ensure we're in browser environment for tests
  });

  describe('constructor', () => {
    it('should create Ship instance with explicit configuration', () => {
      const ship = new Ship({ 
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev' 
      });
      expect(ship).toBeInstanceOf(Ship);
    });

    it('should work without API key (using deploy tokens)', () => {
      const ship = new Ship({ 
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev' 
      });
      expect(ship).toBeInstanceOf(Ship);
    });
  });

  describe('configuration handling', () => {
    it('should use constructor options directly (no client config storage)', async () => {
      const ship = new Ship({
        deployToken: 'token-xxxx',
        apiUrl: 'https://custom-api.com'
      });

      // Mock the HTTP client to avoid actual network calls
      const getConfigSpy = vi.fn().mockResolvedValue({ maxFileSize: 10485760, maxFilesCount: 1000, maxTotalSize: 52428800 });
      (ship as any).http = {
        ping: vi.fn().mockResolvedValue(true),
        getConfig: getConfigSpy
      };

      await ship.ping(); // This triggers initialization

      // Verify that platform config was fetched from API
      expect(getConfigSpy).toHaveBeenCalled();

      // Browser doesn't store client config - loadConfig just returns empty
      // All config comes through constructor options
    });
  });

  describe('deploy functionality', () => {
    it('should process File[] correctly', async () => {
      const ship = new Ship({ 
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev' 
      });
      
      // Mock the API client
      (ship as any).http = {
        deploy: vi.fn().mockResolvedValue({
          id: 'dep_browser_123',
          url: 'https://dep_browser_123.shipstatic.dev'
        }),
        checkSPA: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockResolvedValue({ maxFileSize: 10485760, maxFilesCount: 1000, maxTotalSize: 52428800 })
      };

      // Create mock File objects
      const mockFiles = [
        new File(['<html></html>'], 'index.html', { type: 'text/html' }),
        new File(['body {}'], 'style.css', { type: 'text/css' })
      ];

      const result = await ship.deploy(mockFiles);

      expect(result).toEqual({
        id: 'dep_browser_123',
        url: 'https://dep_browser_123.shipstatic.dev'
      });
    });

  });

  describe('SPA detection in browser', () => {
    it('should apply SPA detection for browser files (unified pipeline)', async () => {
      const ship = new Ship({ 
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev' 
      });
      
      // Mock the API client with SPA detection
      (ship as any).http = {
        deploy: vi.fn().mockResolvedValue({
          id: 'dep_spa_123',
          url: 'https://dep_spa_123.shipstatic.dev'
        }),
        checkSPA: vi.fn().mockResolvedValue(true), // SPA detected
        getConfig: vi.fn().mockResolvedValue({ maxFileSize: 10485760, maxFilesCount: 1000, maxTotalSize: 52428800 })
      };

      const mockFiles = [
        new File(['<html><script src="app.js"></script></html>'], 'index.html', { type: 'text/html' })
      ];

      await ship.deploy(mockFiles, { spaDetect: true });

      // The unified pipeline should have called checkSPA
      expect((ship as any).http.checkSPA).toHaveBeenCalled();
    });
  });

  describe('exported utilities', () => {
    it('should export browser-specific utilities', async () => {
      const browserModule = await import('../../src/browser/index');

      expect(browserModule.loadConfig).toBeDefined();
      expect(browserModule.setPlatformConfig).toBeDefined(); // Platform config, not client config
      expect(browserModule.processFilesForBrowser).toBeDefined();

      // Should NOT export client config setConfig (dead code removed)
      expect((browserModule as any).setConfig).toBeUndefined();
    });

    it('should re-export shared utilities', async () => {
      const browserModule = await import('../../src/browser/index');
      
      // These come from shared exports
      expect(browserModule.ShipError).toBeDefined();
      expect(browserModule.getENV).toBeDefined();
      expect(browserModule.__setTestEnvironment).toBeDefined();
    });
  });

  describe('resource functionality', () => {
    it('should provide access to all resources (same as Node.js)', () => {
      const ship = new Ship({
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev'
      });

      expect(ship.deployments).toBeDefined();
      expect(ship.domains).toBeDefined();
      expect(ship.account).toBeDefined();
    });
  });

  describe('browser-specific behavior', () => {
    it('should receive all config via constructor (no file loading)', async () => {
      const ship = new Ship({
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev'
      });

      // Mock the HTTP client
      const getConfigSpy = vi.fn().mockResolvedValue({ maxFileSize: 10485760, maxFilesCount: 1000, maxTotalSize: 52428800 });
      (ship as any).http = {
        ping: vi.fn().mockResolvedValue(true),
        getConfig: getConfigSpy
      };

      await ship.ping(); // This triggers initialization

      // Browser loadFullConfig should only fetch platform config, not load client config files
      expect(getConfigSpy).toHaveBeenCalled();

      // loadConfig is available but not called during initialization (browser gets config from constructor)
      const configModule = await import('../../src/browser/core/config');
      expect(configModule.loadConfig).toBeDefined();
    });
  });

  describe('deployment edge cases (migrated from browser-sdk.test.ts)', () => {
    it('should throw error for invalid input type in browser', async () => {
      const ship = new Ship({ 
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev' 
      });

      // Should reject string paths (Node.js only input)
      await expect(ship.deploy('/path/to/file' as any))
        .rejects.toThrow();
    });


    it('should pass deployment options correctly', async () => {
      const ship = new Ship({ 
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev' 
      });
      
      // Mock the API and processInput to verify options are passed
      const mockProcessInput = vi.fn().mockResolvedValue([
        { path: 'test.txt', content: new ArrayBuffer(4), size: 4, md5: 'test-hash' }
      ]);
      
      (ship as any).processInput = mockProcessInput;
      (ship as any).http = {
        deploy: vi.fn().mockResolvedValue({
          id: 'dep_options_123',
          url: 'https://dep_options_123.shipstatic.dev'
        }),
        checkSPA: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockResolvedValue({ maxFileSize: 10485760, maxFilesCount: 1000, maxTotalSize: 52428800 })
      };

      const mockFiles = [new File(['test'], 'test.txt')];
      const options = {
        timeout: 12345,
        maxConcurrency: 5,
        spaDetect: false
      };

      await ship.deploy(mockFiles, options);

      // Verify options were passed to processInput
      expect(mockProcessInput).toHaveBeenCalledWith(
        mockFiles,
        expect.objectContaining(options)
      );
    });

    it('should handle empty File[]', async () => {
      const ship = new Ship({
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev'
      });

      (ship as any).http = {
        deploy: vi.fn().mockResolvedValue({
          id: 'dep_empty_123',
          url: 'https://dep_empty_123.shipstatic.dev'
        }),
        checkSPA: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockResolvedValue({ maxFileSize: 10485760, maxFilesCount: 1000, maxTotalSize: 52428800 })
      };

      const emptyFiles: File[] = [];

      const result = await ship.deploy(emptyFiles);

      expect(result).toEqual({
        id: 'dep_empty_123',
        url: 'https://dep_empty_123.shipstatic.dev'
      });
    });

    it('should handle File objects with different MIME types', async () => {
      const ship = new Ship({ 
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev' 
      });
      
      (ship as any).http = {
        deploy: vi.fn().mockResolvedValue({
          id: 'dep_mime_123',
          url: 'https://dep_mime_123.shipstatic.dev'
        }),
        checkSPA: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockResolvedValue({ maxFileSize: 10485760, maxFilesCount: 1000, maxTotalSize: 52428800 })
      };

      const mockFiles = [
        new File(['<html></html>'], 'index.html', { type: 'text/html' }),
        new File(['body {}'], 'style.css', { type: 'text/css' }),
        new File(['console.log("hi")'], 'app', { type: 'application/javascript' }),
        new File([new ArrayBuffer(100)], 'image.png', { type: 'image/png' }),
        new File(['{"test": true}'], 'data.json', { type: 'application/json' })
      ];

      const result = await ship.deploy(mockFiles);

      expect(result).toEqual({
        id: 'dep_mime_123',
        url: 'https://dep_mime_123.shipstatic.dev'
      });
    });
  });

  describe('standardized error handling', () => {
    it('should reject string paths with consistent error message', async () => {
      const ship = new Ship({
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev'
      });

      (ship as any).http = {
        getConfig: vi.fn().mockResolvedValue({ maxFileSize: 10485760, maxFilesCount: 1000, maxTotalSize: 52428800 })
      };

      await expect(ship.deploy('/path/to/file' as any))
        .rejects.toThrow('Invalid input type for browser environment. Expected File[].');
    });

    it('should reject Node.js-style string arrays with consistent error message', async () => {
      const ship = new Ship({
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev'
      });

      (ship as any).http = {
        getConfig: vi.fn().mockResolvedValue({ maxFileSize: 10485760, maxFilesCount: 1000, maxTotalSize: 52428800 })
      };

      await expect(ship.deploy(['./file1.html', './file2.css'] as any))
        .rejects.toThrow('Invalid input type for browser environment. Expected File[].');
    });

    it('should reject invalid object types with consistent error message', async () => {
      const ship = new Ship({
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev'
      });

      (ship as any).http = {
        getConfig: vi.fn().mockResolvedValue({ maxFileSize: 10485760, maxFilesCount: 1000, maxTotalSize: 52428800 })
      };

      await expect(ship.deploy({ invalid: 'object' } as any))
        .rejects.toThrow('Invalid input type for browser environment. Expected File[].');
    });

    it('should handle network errors consistently', async () => {
      const ship = new Ship({ 
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev' 
      });

      // Mock network timeout
      (ship as any).http = {
        deploy: vi.fn().mockRejectedValue(new Error('Request timeout after 30000ms')),
        checkSPA: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockResolvedValue({ maxFileSize: 10485760, maxFilesCount: 1000, maxTotalSize: 52428800 })
      };

      const mockFiles = [new File(['test'], 'test.html')];

      await expect(ship.deploy(mockFiles))
        .rejects.toThrow('Request timeout after 30000ms');
    });

    it('should handle API errors consistently', async () => {
      const ship = new Ship({ 
        deployToken: 'invalid-token',
        apiUrl: 'https://api.shipstatic.dev' 
      });

      // Mock API error
      (ship as any).http = {
        deploy: vi.fn().mockRejectedValue(new Error('API key is invalid')),
        checkSPA: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockResolvedValue({ maxFileSize: 10485760, maxFilesCount: 1000, maxTotalSize: 52428800 })
      };

      const mockFiles = [new File(['test'], 'test.html')];

      await expect(ship.deploy(mockFiles))
        .rejects.toThrow('API key is invalid');
    });
  });
});