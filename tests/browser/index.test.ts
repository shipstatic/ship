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

// Mock browser config
vi.mock('../../src/browser/core/config', () => ({
  setConfig: vi.fn(),
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
    it('should use constructor options directly (no file loading)', async () => {
      const ship = new Ship({ 
        deployToken: 'token-xxxx',
        apiUrl: 'https://custom-api.com' 
      });
      
      // Mock the HTTP client to avoid actual network calls
      (ship as any).http = {
        ping: vi.fn().mockResolvedValue(true)
      };

      await ship.ping(); // This triggers initialization

      // Verify that browser config was set with constructor options
      const { setConfig } = await import('../../src/browser/core/config');
      expect(setConfig).toHaveBeenCalledWith({
        apiUrl: 'https://custom-api.com',
        deployToken: 'token-xxxx',
        apiKey: undefined
      });
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
        checkSPA: vi.fn().mockResolvedValue(false)
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

    it('should process FileList correctly', async () => {
      const ship = new Ship({ 
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev' 
      });
      
      // Mock the API client
      (ship as any).http = {
        deploy: vi.fn().mockResolvedValue({
          id: 'dep_filelist_123',
          url: 'https://dep_filelist_123.shipstatic.dev'
        }),
        checkSPA: vi.fn().mockResolvedValue(false)
      };

      // Create mock FileList
      const mockFileList = {
        0: new File(['<html></html>'], 'index.html', { type: 'text/html' }),
        1: new File(['body {}'], 'style.css', { type: 'text/css' }),
        length: 2,
        item: (index: number) => index < 2 ? mockFileList[index as keyof typeof mockFileList] : null
      } as FileList;

      const result = await ship.deploy(mockFileList);

      expect(result).toEqual({
        id: 'dep_filelist_123',
        url: 'https://dep_filelist_123.shipstatic.dev'
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
        checkSPA: vi.fn().mockResolvedValue(true) // SPA detected
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
      expect(browserModule.setConfig).toBeDefined();
      expect(browserModule.processFilesForBrowser).toBeDefined();
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
      expect(ship.aliases).toBeDefined();
      expect(ship.account).toBeDefined();
      expect(ship.keys).toBeDefined();
    });
  });

  describe('browser-specific behavior', () => {
    it('should not attempt to load config files (CORS protection)', async () => {
      const ship = new Ship({ 
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev' 
      });
      
      // Mock the HTTP client
      (ship as any).http = {
        ping: vi.fn().mockResolvedValue(true)
      };

      await ship.ping(); // This triggers initialization

      // Verify that loadConfig was called but returned empty (no file access)
      const { loadConfig } = await import('../../src/browser/core/config');
      expect(loadConfig).toHaveBeenCalled();
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

    it('should process HTMLInputElement correctly', async () => {
      const ship = new Ship({ 
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev' 
      });
      
      // Mock the API client
      (ship as any).http = {
        deploy: vi.fn().mockResolvedValue({
          id: 'dep_input_123',
          url: 'https://dep_input_123.shipstatic.dev'
        }),
        checkSPA: vi.fn().mockResolvedValue(false)
      };

      // Create mock HTMLInputElement with files
      const mockInput = document.createElement('input') as HTMLInputElement;
      mockInput.type = 'file';
      const file1 = new File(['content1'], 'file1.txt');
      const file2 = new File(['content2'], 'file2.txt');
      
      Object.defineProperty(mockInput, 'files', {
        value: {
          0: file1,
          1: file2,
          length: 2,
          item: (index: number) => index === 0 ? file1 : index === 1 ? file2 : null
        } as FileList
      });

      const result = await ship.deploy(mockInput);

      expect(result).toEqual({
        id: 'dep_input_123',
        url: 'https://dep_input_123.shipstatic.dev'
      });
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
        checkSPA: vi.fn().mockResolvedValue(false)
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

    it('should handle empty FileList', async () => {
      const ship = new Ship({ 
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev' 
      });
      
      (ship as any).http = {
        deploy: vi.fn().mockResolvedValue({
          id: 'dep_empty_123',
          url: 'https://dep_empty_123.shipstatic.dev'
        }),
        checkSPA: vi.fn().mockResolvedValue(false)
      };

      const emptyFileList = {
        length: 0,
        item: () => null
      } as FileList;

      const result = await ship.deploy(emptyFileList);

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
        checkSPA: vi.fn().mockResolvedValue(false)
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

      await expect(ship.deploy('/path/to/file' as any))
        .rejects.toThrow('Invalid input type for browser environment. Expected File[], FileList, or HTMLInputElement.');
    });

    it('should reject Node.js-style string arrays with consistent error message', async () => {
      const ship = new Ship({ 
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev' 
      });

      await expect(ship.deploy(['./file1.html', './file2.css'] as any))
        .rejects.toThrow('Invalid input type for browser environment. Expected File[], FileList, or HTMLInputElement.');
    });

    it('should reject invalid object types with consistent error message', async () => {
      const ship = new Ship({ 
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev' 
      });

      await expect(ship.deploy({ invalid: 'object' } as any))
        .rejects.toThrow('Invalid input type for browser environment. Expected File[], FileList, or HTMLInputElement.');
    });

    it('should handle network errors consistently', async () => {
      const ship = new Ship({ 
        deployToken: 'token-xxxx',
        apiUrl: 'https://api.shipstatic.dev' 
      });

      // Mock network timeout
      (ship as any).http = {
        deploy: vi.fn().mockRejectedValue(new Error('Request timeout after 30000ms')),
        checkSPA: vi.fn().mockResolvedValue(false)
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
        checkSPA: vi.fn().mockResolvedValue(false)
      };

      const mockFiles = [new File(['test'], 'test.html')];

      await expect(ship.deploy(mockFiles))
        .rejects.toThrow('API key is invalid');
    });
  });
});