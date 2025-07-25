/**
 * @file CLI Configuration Integration Tests
 * 
 * These tests ensure the configuration system remains robust and handles
 * all the edge cases that caused issues during the transition to new Ship().
 * 
 * Critical Integration Points Tested:
 * 1. CLI options → createClient() → new Ship() → ensureInitialized()
 * 2. Configuration precedence: CLI args > env vars > config files > defaults
 * 3. Initialization failure scenarios and recovery
 * 4. Real-world CLI usage patterns
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Ship } from '@/index';
import type { ShipClientOptions } from '@/types';

// Mock all external dependencies
const mockApiHttpInstance = {
  ping: vi.fn().mockResolvedValue(true),
  getConfig: vi.fn().mockResolvedValue({
    maxFileSize: 10 * 1024 * 1024,
    maxFilesCount: 1000,
    maxTotalSize: 100 * 1024 * 1024,
  }),
  deploy: vi.fn(),
  listDeployments: vi.fn(),
  getDeployment: vi.fn(),
  removeDeployment: vi.fn(),
  getAccount: vi.fn().mockResolvedValue({ id: 'test-account' }),
};

const { MOCK_API_HTTP_MODULE } = vi.hoisted(() => ({
  MOCK_API_HTTP_MODULE: {
    ApiHttp: vi.fn(() => mockApiHttpInstance),
  }
}));

const { CONFIG_LOADER_MOCK } = vi.hoisted(() => ({
  CONFIG_LOADER_MOCK: {
    loadConfig: vi.fn(),
    resolveConfig: vi.fn((userOptions: Record<string, any> = {}, loadedConfig: Record<string, any> = {}) => ({
      apiUrl: userOptions.apiUrl || loadedConfig.apiUrl || 'https://api.shipstatic.com',
      apiKey: userOptions.apiKey !== undefined ? userOptions.apiKey : loadedConfig.apiKey
    })),
    mergeDeployOptions: vi.fn((userOptions: Record<string, any> = {}, clientDefaults: Record<string, any> = {}) => ({
      ...clientDefaults,
      ...userOptions
    }))
  }
}));

vi.mock('@/api/http', () => MOCK_API_HTTP_MODULE);
vi.mock('@/core/config', () => CONFIG_LOADER_MOCK);

// Helper to simulate CLI createClient() function behavior
function simulateCreateClient(cliOptions: Record<string, any> = {}): Ship {
  const shipOptions: ShipClientOptions = {};
  
  // Replicate exact CLI logic
  if (cliOptions.config !== undefined) {
    shipOptions.configFile = cliOptions.config;
  }
  if (cliOptions.apiUrl !== undefined) {
    shipOptions.apiUrl = cliOptions.apiUrl;
  }
  if (cliOptions.apiKey !== undefined) {
    shipOptions.apiKey = cliOptions.apiKey;
  }
  
  return new Ship(shipOptions);
}

describe('CLI Configuration Integration Tests', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    
    // Clear all Ship-related env vars
    delete process.env.SHIP_API_KEY;
    delete process.env.SHIP_API_URL;
    delete process.env.SHIPSTATIC_API_KEY;
    delete process.env.SHIPSTATIC_API_URL;
    
    // Set up default mocks
    CONFIG_LOADER_MOCK.loadConfig.mockResolvedValue({});
    
    // Set environment to node for proper testing
    const { __setTestEnvironment } = await import('@/lib/env');
    await __setTestEnvironment('node');
  });

  afterEach(async () => {
    process.env = originalEnv;
    const { __setTestEnvironment } = await import('@/lib/env');
    await __setTestEnvironment(null);
  });

  describe('Config File Parameter Tests', () => {
    it('should pass CLI config option correctly to Ship constructor', async () => {
      const cliOptions = {
        config: '/path/to/custom/config.json'
      };
      
      const client = simulateCreateClient(cliOptions);
      await client.ping(); // Trigger initialization
      
      // Should call loadConfig with the custom config file path
      expect(CONFIG_LOADER_MOCK.loadConfig).toHaveBeenCalledWith('/path/to/custom/config.json');
    });

    it('should handle config file with other CLI options', async () => {
      const cliOptions = {
        config: '/path/to/custom/config.json',
        apiKey: 'cli-override-key'
      };
      
      CONFIG_LOADER_MOCK.loadConfig.mockResolvedValue({
        apiKey: 'config-file-key',
        apiUrl: 'https://config-file.api.com'
      });
      
      const client = simulateCreateClient(cliOptions);
      await client.ping(); // Trigger initialization
      
      // Should load from custom config file
      expect(CONFIG_LOADER_MOCK.loadConfig).toHaveBeenCalledWith('/path/to/custom/config.json');
      
      // CLI options should still override config file values
      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'cli-override-key',
          apiUrl: 'https://config-file.api.com'
        })
      );
    });

    it('should not pass undefined config to loadConfig', async () => {
      const cliOptions = {
        config: undefined,
        apiKey: 'test-key'
      };
      
      const client = simulateCreateClient(cliOptions);
      await client.ping(); // Trigger initialization
      
      // Should call loadConfig without config file parameter
      expect(CONFIG_LOADER_MOCK.loadConfig).toHaveBeenCalledWith(undefined);
    });

    it('should handle config file loading errors gracefully', async () => {
      const cliOptions = {
        config: '/path/to/nonexistent/config.json'
      };
      
      CONFIG_LOADER_MOCK.loadConfig.mockRejectedValue(new Error('Config file not found'));
      
      const client = simulateCreateClient(cliOptions);
      
      // Should propagate config loading error
      await expect(client.ping()).rejects.toThrow('Config file not found');
      expect(CONFIG_LOADER_MOCK.loadConfig).toHaveBeenCalledWith('/path/to/nonexistent/config.json');
    });

    it('should handle relative config file paths', async () => {
      const cliOptions = {
        config: './ship.config.json'
      };
      
      CONFIG_LOADER_MOCK.loadConfig.mockResolvedValue({
        apiKey: 'relative-config-key'
      });
      
      const client = simulateCreateClient(cliOptions);
      await client.ping(); // Trigger initialization
      
      expect(CONFIG_LOADER_MOCK.loadConfig).toHaveBeenCalledWith('./ship.config.json');
    });

    it('should handle config files with different extensions', async () => {
      const testCases = [
        '/path/to/config.json',
        '/path/to/config.yaml',
        '/path/to/config.yml',
        '/path/to/config.js',
        '/path/to/.shiprc'
      ];

      for (const configPath of testCases) {
        CONFIG_LOADER_MOCK.loadConfig.mockResolvedValue({
          apiKey: 'extension-test-key'
        });

        const cliOptions = { config: configPath };
        const client = simulateCreateClient(cliOptions);
        await client.ping(); // Trigger initialization

        expect(CONFIG_LOADER_MOCK.loadConfig).toHaveBeenCalledWith(configPath);
        
        // Reset mocks for next iteration
        vi.clearAllMocks();
        CONFIG_LOADER_MOCK.loadConfig.mockResolvedValue({});
      }
    });
  });

  describe('CLI Options → Ship Constructor Integration', () => {
    it('should pass CLI apiUrl option correctly to Ship constructor', async () => {
      const cliOptions = {
        apiUrl: 'https://cli-provided.api.com'
      };
      
      const client = simulateCreateClient(cliOptions);
      await client.ping(); // Trigger initialization
      
      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          apiUrl: 'https://cli-provided.api.com'
        })
      );
    });

    it('should pass CLI apiKey option correctly to Ship constructor', async () => {
      const cliOptions = {
        apiKey: 'cli-provided-key'
      };
      
      const client = simulateCreateClient(cliOptions);
      await client.ping(); // Trigger initialization
      
      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'cli-provided-key'
        })
      );
    });

    it('should pass both CLI options correctly to Ship constructor', async () => {
      const cliOptions = {
        apiUrl: 'https://cli-both.api.com',
        apiKey: 'cli-both-key'
      };
      
      const client = simulateCreateClient(cliOptions);
      await client.ping(); // Trigger initialization
      
      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          apiUrl: 'https://cli-both.api.com',
          apiKey: 'cli-both-key'
        })
      );
    });

    it('should not pass undefined options to Ship constructor', async () => {
      const cliOptions = {
        apiUrl: undefined,
        apiKey: undefined,
        someOtherOption: 'value'
      };
      
      const client = simulateCreateClient(cliOptions);
      await client.ping(); // Trigger initialization
      
      // Constructor should not have received undefined values
      // The apiUrl from resolveConfig default is expected
      const callArgs = MOCK_API_HTTP_MODULE.ApiHttp.mock.calls[0][0];
      expect(callArgs.apiUrl).toBe('https://api.shipstatic.com'); // Default from resolveConfig
      expect(callArgs.apiKey).toBeUndefined();
    });
  });

  describe('Configuration Precedence Integration', () => {
    it('should prioritize CLI args over environment variables', async () => {
      // Set up environment variables
      process.env.SHIP_API_KEY = 'env-key';
      process.env.SHIP_API_URL = 'https://env.api.com';
      
      CONFIG_LOADER_MOCK.loadConfig.mockResolvedValue({
        apiKey: 'env-key',
        apiUrl: 'https://env.api.com'
      });
      
      // CLI args should override
      const cliOptions = {
        apiKey: 'cli-override-key',
        apiUrl: 'https://cli-override.api.com'
      };
      
      const client = simulateCreateClient(cliOptions);
      await client.ping(); // Trigger initialization
      
      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'cli-override-key',
          apiUrl: 'https://cli-override.api.com'
        })
      );
    });

    it('should fall back to loaded config when CLI args not provided', async () => {
      CONFIG_LOADER_MOCK.loadConfig.mockResolvedValue({
        apiKey: 'loaded-key',
        apiUrl: 'https://loaded.api.com'
      });
      
      // No CLI options provided
      const client = simulateCreateClient({});
      await client.ping(); // Trigger initialization
      
      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'loaded-key',
          apiUrl: 'https://loaded.api.com'
        })
      );
    });

    it('should handle partial CLI override scenarios', async () => {
      CONFIG_LOADER_MOCK.loadConfig.mockResolvedValue({
        apiKey: 'loaded-key',
        apiUrl: 'https://loaded.api.com'
      });
      
      // Only override apiKey via CLI
      const cliOptions = {
        apiKey: 'cli-partial-key'
        // apiUrl not provided, should fall back to loaded config
      };
      
      const client = simulateCreateClient(cliOptions);
      await client.ping(); // Trigger initialization
      
      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'cli-partial-key',
          apiUrl: 'https://loaded.api.com'
        })
      );
    });
  });

  describe('Initialization Error Scenarios', () => {
    it('should handle loadConfig failures gracefully', async () => {
      CONFIG_LOADER_MOCK.loadConfig.mockRejectedValue(new Error('Config file corrupted'));
      
      const client = simulateCreateClient({
        apiKey: 'cli-fallback-key'
      });
      
      // Should still be able to use CLI-provided options
      await expect(client.ping()).rejects.toThrow('Config file corrupted');
    });

    it('should handle getConfig API failures gracefully', async () => {
      CONFIG_LOADER_MOCK.loadConfig.mockResolvedValue({
        apiKey: 'valid-key',
        apiUrl: 'https://valid.api.com'
      });
      
      mockApiHttpInstance.getConfig.mockRejectedValue(new Error('API unreachable'));
      
      const client = simulateCreateClient({});
      
      await expect(client.ping()).rejects.toThrow('API unreachable');
    });

    it('should allow retry after initialization failure', async () => {
      CONFIG_LOADER_MOCK.loadConfig.mockResolvedValue({
        apiKey: 'retry-key',
        apiUrl: 'https://retry.api.com'
      });
      
      // First call fails
      mockApiHttpInstance.getConfig
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValue({
          maxFileSize: 10 * 1024 * 1024,
          maxFilesCount: 1000,
          maxTotalSize: 100 * 1024 * 1024,
        });
      
      const client = simulateCreateClient({});
      
      // First attempt should fail
      await expect(client.ping()).rejects.toThrow('Temporary failure');
      
      // Second attempt should succeed (retry mechanism)
      await expect(client.ping()).resolves.toBe(true);
    });
  });

  describe('Real-world CLI Usage Patterns', () => {
    it('should handle ship ping command pattern', async () => {
      CONFIG_LOADER_MOCK.loadConfig.mockResolvedValue({
        apiKey: 'ping-test-key'
      });
      
      const client = simulateCreateClient({});
      const result = await client.ping();
      
      expect(result).toBe(true);
      expect(mockApiHttpInstance.ping).toHaveBeenCalled();
    });

    it('should handle ship whoami command pattern', async () => {
      CONFIG_LOADER_MOCK.loadConfig.mockResolvedValue({
        apiKey: 'whoami-test-key'
      });
      
      mockApiHttpInstance.getConfig.mockResolvedValue({
        account: { id: 'test-account' }
      });
      
      const client = simulateCreateClient({});
      
      // whoami internally calls account.get() which should trigger initialization
      await client.whoami();
      
      // Verify initialization was triggered
      expect(mockApiHttpInstance.getConfig).toHaveBeenCalled();
    });

    it('should handle rapid successive CLI commands', async () => {
      CONFIG_LOADER_MOCK.loadConfig.mockResolvedValue({
        apiKey: 'rapid-test-key'
      });
      
      const client = simulateCreateClient({});
      
      // Simulate rapid CLI commands (common in scripts)
      const promises = [
        client.ping(),
        client.ping(),
        client.ping()
      ];
      
      await Promise.all(promises);
      
      // Initialization should only happen once despite multiple calls
      expect(mockApiHttpInstance.getConfig).toHaveBeenCalledTimes(1);
    });

    it('should handle CLI options with special characters', async () => {
      const cliOptions = {
        apiKey: 'key-with-special-chars-!@#$%',
        apiUrl: 'https://api-with-dash.example.com'
      };
      
      const client = simulateCreateClient(cliOptions);
      await client.ping();
      
      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'key-with-special-chars-!@#$%',
          apiUrl: 'https://api-with-dash.example.com'
        })
      );
    });

    it('should handle ship commands with custom config files', async () => {
      const cliOptions = {
        config: '/home/user/.ship/production.json'
      };
      
      CONFIG_LOADER_MOCK.loadConfig.mockResolvedValue({
        apiKey: 'production-key',
        apiUrl: 'https://production.api.com'
      });
      
      const client = simulateCreateClient(cliOptions);
      
      // Test different command patterns with custom config
      await client.ping();
      expect(CONFIG_LOADER_MOCK.loadConfig).toHaveBeenCalledWith('/home/user/.ship/production.json');
      
      await client.whoami();
      expect(MOCK_API_HTTP_MODULE.ApiHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'production-key',
          apiUrl: 'https://production.api.com'
        })
      );
    });
  });

  describe('Memory and Performance Characteristics', () => {
    it('should not leak initialization promises', async () => {
      CONFIG_LOADER_MOCK.loadConfig.mockResolvedValue({
        apiKey: 'memory-test-key'
      });
      
      const client = simulateCreateClient({});
      
      // Multiple operations should reuse the same initialization promise
      await client.ping();
      await client.whoami();
      
      // Should only initialize once
      expect(mockApiHttpInstance.getConfig).toHaveBeenCalledTimes(1);
    });

    it('should handle concurrent initialization correctly', async () => {
      CONFIG_LOADER_MOCK.loadConfig.mockResolvedValue({
        apiKey: 'concurrent-test-key'
      });
      
      // Simulate a slow getConfig call
      mockApiHttpInstance.getConfig.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({
          maxFileSize: 10 * 1024 * 1024,
          maxFilesCount: 1000,
          maxTotalSize: 100 * 1024 * 1024,
        }), 10))
      );
      
      const client = simulateCreateClient({});
      
      // Start multiple operations concurrently
      const operations = [
        client.ping(),
        client.whoami(),
        client.ping()
      ];
      
      await Promise.all(operations);
      
      // Should still only initialize once despite concurrent calls
      expect(mockApiHttpInstance.getConfig).toHaveBeenCalledTimes(1);
    });
  });
});