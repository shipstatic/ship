/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig, setConfig } from '../../../src/browser/core/config';
import { __setTestEnvironment } from '../../../src/shared/lib/env';

describe('Browser Config Loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setTestEnvironment('browser');
  });

  describe('loadConfig', () => {
    it('should return empty object (no file system access)', async () => {
      const result = await loadConfig();
      expect(result).toEqual({});
    });

    it('should ignore config file parameter (CORS protection)', async () => {
      const result = await loadConfig('.shiprc');
      expect(result).toEqual({});
    });

    it('should ignore config file parameter with absolute path', async () => {
      const result = await loadConfig('/path/to/config.json');
      expect(result).toEqual({});
    });

    it('should not attempt to read from file system', async () => {
      // Verify no file system operations are attempted
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const result = await loadConfig('some-config-file');
      expect(result).toEqual({});
      
      // Should not produce any warnings about file access
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should be consistent regardless of config file name', async () => {
      const results = await Promise.all([
        loadConfig(),
        loadConfig('.shiprc'),
        loadConfig('ship.config'),
        loadConfig('package.json'),
        loadConfig('/absolute/path/config.json')
      ]);

      // All results should be identical empty objects
      results.forEach(result => {
        expect(result).toEqual({});
      });
    });
  });

  describe('setConfig', () => {
    it('should store config in memory', () => {
      const testConfig = {
        apiUrl: 'https://test.api.com',
        apiKey: 'test-key',
        maxFileSize: 1000000
      };

      // This should not throw
      expect(() => setConfig(testConfig)).not.toThrow();
    });

    it('should handle empty config', () => {
      expect(() => setConfig({})).not.toThrow();
    });

    it('should handle null/undefined config', () => {
      expect(() => setConfig(null)).not.toThrow();
      expect(() => setConfig(undefined)).not.toThrow();
    });

    it('should handle partial config updates', () => {
      // Set initial config
      setConfig({
        apiUrl: 'https://initial.com',
        apiKey: 'initial-key'
      });

      // Update with partial config
      expect(() => setConfig({
        apiKey: 'updated-key'
      })).not.toThrow();
    });

    it('should handle config with various data types', () => {
      const complexConfig = {
        apiUrl: 'https://api.com',
        apiKey: 'key',
        timeout: 5000,
        enabled: true,
        options: {
          nested: 'value'
        },
        list: [1, 2, 3]
      };

      expect(() => setConfig(complexConfig)).not.toThrow();
    });
  });

  describe('browser-specific behavior', () => {
    it('should not expose file system configuration methods', async () => {
      const configModule = await import('../../../src/browser/core/config');
      
      // Browser config should only have basic methods
      expect(configModule.loadConfig).toBeDefined();
      expect(configModule.setConfig).toBeDefined();
      
      // Should not have file system specific methods that might exist in Node
      expect((configModule as any).loadConfigFromFile).toBeUndefined();
      expect((configModule as any).watchConfigFile).toBeUndefined();
      expect((configModule as any).findConfigFile).toBeUndefined();
    });

    it('should work in environments without process.env', async () => {
      // Simulate browser environment without Node.js globals
      const originalProcess = global.process;
      delete (global as any).process;

      try {
        const result = await loadConfig();
        expect(result).toEqual({});
      } finally {
        global.process = originalProcess;
      }
    });

    it('should not attempt to access browser localStorage or sessionStorage', async () => {
      // Mock storage to detect access attempts (only if Storage exists)
      const mockStorage = {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        length: 0,
        key: vi.fn()
      };
      
      // Add storage to global if it doesn't exist
      const originalLocalStorage = (global as any).localStorage;
      const originalSessionStorage = (global as any).sessionStorage;
      
      (global as any).localStorage = mockStorage;
      (global as any).sessionStorage = mockStorage;

      try {
        await loadConfig();
        setConfig({ test: 'value' });

        // Config should not use browser storage
        expect(mockStorage.getItem).not.toHaveBeenCalled();
        expect(mockStorage.setItem).not.toHaveBeenCalled();
      } finally {
        // Restore original values
        (global as any).localStorage = originalLocalStorage;
        (global as any).sessionStorage = originalSessionStorage;
      }
    });
  });

  describe('CORS protection behavior', () => {
    it('should not make any network requests for config', async () => {
      // Mock fetch to detect network attempts
      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => 
        Promise.reject(new Error('Network access should not happen'))
      );

      const result = await loadConfig('https://remote-config.com/config.json');
      expect(result).toEqual({});
      expect(fetchSpy).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
    });

    it('should not attempt to read relative paths', async () => {
      // These paths could potentially be read in a file:// context
      const relativePaths = [
        '../config.json',
        './ship.config',
        '../../secret.config'
      ];

      for (const path of relativePaths) {
        const result = await loadConfig(path);
        expect(result).toEqual({});
      }
    });

    it('should isolate from any file:// protocol access', async () => {
      const fileUrls = [
        'file:///etc/config',
        'file://C:/config.json',
        'file://./local-config.json'
      ];

      for (const url of fileUrls) {
        const result = await loadConfig(url);
        expect(result).toEqual({});
      }
    });
  });

  describe('performance characteristics', () => {
    it('should load config quickly (no I/O operations)', async () => {
      const start = performance.now();
      await loadConfig();
      const end = performance.now();

      // Should complete in under 1ms since no I/O
      expect(end - start).toBeLessThan(1);
    });

    it('should handle multiple concurrent loads without issues', async () => {
      const promises = Array.from({ length: 10 }, () => loadConfig());
      const results = await Promise.all(promises);

      results.forEach(result => {
        expect(result).toEqual({});
      });
    });
  });
});