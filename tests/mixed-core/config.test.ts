import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShipError } from '@shipstatic/types';

// Mock dependencies
vi.mock('../../src/shared/lib/env', () => ({
  getENV: vi.fn()
}));

// Mock cosmiconfig
const mockCosmiconfigSync = vi.fn();
vi.mock('cosmiconfig', () => ({
  cosmiconfigSync: mockCosmiconfigSync
}));

describe('config', () => {
  let sharedConfig: typeof import('../../src/shared/core/config');
  let nodeConfig: typeof import('../../src/node/core/config');
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    originalEnv = { ...process.env };

    // Clear env vars
    delete process.env.SHIP_API_URL;
    delete process.env.SHIP_API_KEY;

    // Setup getENV mock to return 'node' by default
    const { getENV } = await import('../../src/shared/lib/env');
    (getENV as any).mockReturnValue('node');

    sharedConfig = await import('../../src/shared/core/config');
    nodeConfig = await import('../../src/node/core/config');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should return empty object in browser environment', async () => {
      const { getENV } = await import('../../src/shared/lib/env');
      (getENV as any).mockReturnValue('browser');

      const result = await nodeConfig.loadConfig();
      expect(result).toEqual({});
    });

    it('should load config from environment variables', async () => {
      // Set environment variables
      process.env.SHIP_API_URL = 'https://api.example.com';
      process.env.SHIP_API_KEY = 'test-key';

      const result = await nodeConfig.loadConfig();

      expect(result).toEqual({
        apiUrl: 'https://api.example.com',
        apiKey: 'test-key'
      });
    });

    it('should load config from file when env vars not set', async () => {
      const mockExplorer = {
        search: vi.fn().mockReturnValue({
          isEmpty: false,
          config: {
            apiUrl: 'https://file.example.com',
            apiKey: 'file-key'
          }
        })
      };
      mockCosmiconfigSync.mockReturnValue(mockExplorer);

      const result = await nodeConfig.loadConfig();

      expect(result).toEqual({
        apiUrl: 'https://file.example.com',
        apiKey: 'file-key'
      });
    });

    it('should prioritize env vars over file config', async () => {
      process.env.SHIP_API_URL = 'https://env.example.com';

      const mockExplorer = {
        search: vi.fn().mockReturnValue({
          isEmpty: false,
          config: {
            apiUrl: 'https://file.example.com',
            apiKey: 'file-key'
          }
        })
      };
      mockCosmiconfigSync.mockReturnValue(mockExplorer);

      const result = await nodeConfig.loadConfig();

      expect(result).toEqual({
        apiUrl: 'https://env.example.com',
        apiKey: 'file-key'
      });
    });

    it('should handle missing config file gracefully', async () => {
      const mockExplorer = {
        search: vi.fn().mockReturnValue(null)
      };
      mockCosmiconfigSync.mockReturnValue(mockExplorer);

      const result = await nodeConfig.loadConfig();

      expect(result).toEqual({
        apiUrl: undefined,
        apiKey: undefined
      });
    });

    it('should handle empty config file', async () => {
      const mockExplorer = {
        search: vi.fn().mockReturnValue({
          isEmpty: true,
          config: null
        })
      };
      mockCosmiconfigSync.mockReturnValue(mockExplorer);

      const result = await nodeConfig.loadConfig();

      expect(result).toEqual({
        apiUrl: undefined,
        apiKey: undefined
      });
    });

    it('should validate config and throw on invalid data', async () => {
      const mockExplorer = {
        search: vi.fn().mockReturnValue({
          isEmpty: false,
          config: {
            apiUrl: 'invalid-url', // Invalid URL
            apiKey: 'valid-key'
          }
        })
      };
      mockCosmiconfigSync.mockReturnValue(mockExplorer);

      await expect(nodeConfig.loadConfig()).rejects.toThrow('Configuration validation failed');
    });
  });

  describe('resolveConfig', () => {
    it('should resolve config with default values', () => {
      const result = sharedConfig.resolveConfig();
      
      expect(result).toEqual({
        apiUrl: 'https://api.shipstatic.com'
      });
    });

    it('should prioritize user options over loaded config', () => {
      const userOptions = {
        apiUrl: 'https://user.example.com',
        apiKey: 'user-key'
      };
      
      const loadedConfig = {
        apiUrl: 'https://loaded.example.com',
        apiKey: 'loaded-key'
      };
      
      const result = sharedConfig.resolveConfig(userOptions, loadedConfig);
      
      expect(result).toEqual({
        apiUrl: 'https://user.example.com',
        apiKey: 'user-key'
      });
    });

    it('should fall back to loaded config when user options not provided', () => {
      const loadedConfig = {
        apiUrl: 'https://loaded.example.com',
        apiKey: 'loaded-key'
      };
      
      const result = sharedConfig.resolveConfig({}, loadedConfig);
      
      expect(result).toEqual({
        apiUrl: 'https://loaded.example.com',
        apiKey: 'loaded-key'
      });
    });

    it('should handle undefined apiKey correctly', () => {
      const userOptions = {
        apiUrl: 'https://user.example.com',
        apiKey: undefined
      };
      
      const loadedConfig = {
        apiUrl: 'https://loaded.example.com',
        apiKey: 'loaded-key'
      };
      
      const result = sharedConfig.resolveConfig(userOptions, loadedConfig);
      
      expect(result).toEqual({
        apiUrl: 'https://user.example.com',
        apiKey: 'loaded-key'
      });
    });

    it('should return config without apiKey when not provided', () => {
      const result = sharedConfig.resolveConfig();
      
      expect(result).toEqual({
        apiUrl: 'https://api.shipstatic.com'
      });
      expect(result.apiKey).toBeUndefined();
    });
  });

  describe('mergeDeployOptions', () => {
    it('should merge deployment options with client defaults', () => {
      const userOptions = {
        timeout: 5000
      };
      
      const clientDefaults = {
        apiUrl: 'https://api.example.com',
        apiKey: 'default-key',
        timeout: 10000,
        maxConcurrency: 3
      };
      
      const result = sharedConfig.mergeDeployOptions(userOptions, clientDefaults);
      
      expect(result).toEqual({
        timeout: 5000,
        maxConcurrency: 3,
        apiKey: 'default-key',
        apiUrl: 'https://api.example.com'
      });
    });

    it('should not override user options with defaults', () => {
      const userOptions = {
        timeout: 5000,
        apiKey: 'user-key'
      };
      
      const clientDefaults = {
        timeout: 10000,
        apiKey: 'default-key'
      };
      
      const result = sharedConfig.mergeDeployOptions(userOptions, clientDefaults);
      
      expect(result).toEqual({
        timeout: 5000,
        apiKey: 'user-key'
      });
    });

    it('should handle empty user options', () => {
      const clientDefaults = {
        apiUrl: 'https://api.example.com',
        apiKey: 'default-key',
        timeout: 10000,
        maxConcurrency: 3
      };
      
      const result = sharedConfig.mergeDeployOptions({}, clientDefaults);
      
      expect(result).toEqual({
        timeout: 10000,
        maxConcurrency: 3,
        apiKey: 'default-key',
        apiUrl: 'https://api.example.com'
      });
    });

    it('should handle undefined client defaults', () => {
      const userOptions = {
        timeout: 5000
      };
      
      const clientDefaults = {
        apiUrl: 'https://api.example.com'
      };
      
      const result = sharedConfig.mergeDeployOptions(userOptions, clientDefaults);
      
      expect(result).toEqual({
        timeout: 5000,
        apiUrl: 'https://api.example.com'
      });
    });

  });
});