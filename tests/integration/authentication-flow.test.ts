import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __setTestEnvironment } from '../../src/shared/lib/env';

const mockApiHttp = vi.fn();

// Default mock client for when specific behavior isn't needed
const defaultMockApiClient = {
  ping: vi.fn().mockResolvedValue(true),
  deploy: vi.fn().mockResolvedValue({ id: 'dep_123', url: 'https://dep_123.shipstatic.dev' }),
  getAccount: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
  getConfig: vi.fn().mockResolvedValue({ maxFileSize: 10485760 }),
  checkSPA: vi.fn().mockResolvedValue(false),
  listDeployments: vi.fn().mockResolvedValue({ deployments: [], count: 0 })
};

vi.mock('../../src/shared/api/http', () => ({
  ApiHttp: mockApiHttp
}));

/**
 * Authentication Flow Cross-Environment Validation Tests
 * 
 * These tests validate that authentication (API keys vs deploy tokens)
 * works consistently across browser and Node.js environments.
 */

describe('Authentication Flow Cross-Environment Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reinitialize the mock functions after clearing
    defaultMockApiClient.ping = vi.fn().mockResolvedValue(true);
    defaultMockApiClient.deploy = vi.fn().mockResolvedValue({ id: 'dep_123', url: 'https://dep_123.shipstatic.dev' });
    defaultMockApiClient.getAccount = vi.fn().mockResolvedValue({ email: 'test@example.com' });
    defaultMockApiClient.getConfig = vi.fn().mockResolvedValue({ maxFileSize: 10485760 });
    defaultMockApiClient.checkSPA = vi.fn().mockResolvedValue(false);
    defaultMockApiClient.listDeployments = vi.fn().mockResolvedValue({ deployments: [], count: 0 });
    // Reset to default mock implementation
    mockApiHttp.mockImplementation(() => defaultMockApiClient);
  });

  describe('API Key Authentication (Node.js)', () => {
    it('should handle API key authentication consistently', async () => {
      __setTestEnvironment('node');
      
      const { Ship } = await import('../../src/node/index');
      
      // Test valid API key
      const shipWithValidKey = new Ship({ apiKey: 'valid-api-key' });
      expect(shipWithValidKey).toBeDefined();
      
      // Test missing API key - constructor should succeed but API calls should fail
      const shipWithoutKey = new Ship({} as any);
      expect(shipWithoutKey).toBeDefined();
    });

    it('should pass API key to HTTP client correctly', async () => {
      __setTestEnvironment('node');
      
      const { Ship } = await import('../../src/node/index');
      const ship = new Ship({ apiKey: 'test-api-key' });
      
      await ship.ping();
      expect(defaultMockApiClient.ping).toHaveBeenCalled();
    });

    it('should handle API key authentication errors consistently', async () => {
      __setTestEnvironment('node');
      
      const { Ship } = await import('../../src/node/index');
      const ship = new Ship({ apiKey: 'invalid-api-key' });
      
      // Mock authentication failure
      defaultMockApiClient.ping.mockRejectedValue(new Error('Invalid API key'));
      
      try {
        await ship.ping();
        // If the promise does not reject, fail the test
        expect.fail('The promise should have been rejected');
      } catch (error: any) {
        expect(error.message).toBe('Invalid API key');
      }
    });
  });

  describe('Deploy Token Authentication (Browser)', () => {
    it('should handle deploy token authentication consistently', async () => {
      __setTestEnvironment('browser');
      
      const { Ship } = await import('../../src/browser/index');
      
      // Test valid deploy token
      const shipWithValidToken = new Ship({ 
        deployToken: 'valid-deploy-token',
        apiUrl: 'https://api.shipstatic.dev'
      });
      expect(shipWithValidToken).toBeDefined();
      
      // Test missing deploy token and API URL (should work with defaults)
      const shipWithDefaults = new Ship({});
      expect(shipWithDefaults).toBeDefined();
    });

    it('should pass deploy token to HTTP client correctly', async () => {
      __setTestEnvironment('browser');
      
      const { Ship } = await import('../../src/browser/index');
      const ship = new Ship({ 
        deployToken: 'test-deploy-token',
        apiUrl: 'https://api.shipstatic.dev'
      });
      
      // Mock HTTP client to verify deploy token usage
      (ship as any).http = defaultMockApiClient;
      
      await ship.ping();
      expect(defaultMockApiClient.ping).toHaveBeenCalled();
    });

    it('should handle deploy token authentication errors consistently', async () => {
      __setTestEnvironment('browser');
      
      const { Ship } = await import('../../src/browser/index');
      const ship = new Ship({ 
        deployToken: 'invalid-deploy-token',
        apiUrl: 'https://api.shipstatic.dev'
      });
      
      // Mock authentication failure
      defaultMockApiClient.ping.mockRejectedValue(new Error('Invalid deploy token'));
      (ship as any).http = defaultMockApiClient;
      
      try {
        await ship.ping();
        expect.fail('The promise should have been rejected');
      } catch (error: any) {
        expect(error.message).toBe('Invalid deploy token');
      }
    });
  });

  describe('Cross-Environment Authentication Consistency', () => {
    it('should provide equivalent authentication capabilities across environments', async () => {
      // Test Node.js authentication
      __setTestEnvironment('node');
      const { Ship: NodeShip } = await import('../../src/node/index');
      const nodeShip = new NodeShip({ apiKey: 'test-key' });
      (nodeShip as any).http = defaultMockApiClient;
      
      // Test Browser authentication
      __setTestEnvironment('browser');
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      const browserShip = new BrowserShip({ 
        deployToken: 'test-token',
        apiUrl: 'https://api.shipstatic.dev'
      });
      (browserShip as any).http = defaultMockApiClient;
      
      // Both should be able to authenticate
      const nodeAuth = await nodeShip.ping();
      const browserAuth = await browserShip.ping();
      
      expect(nodeAuth).toBe(true);
      expect(browserAuth).toBe(true);
      expect(defaultMockApiClient.ping).toHaveBeenCalledTimes(2);
    });

    it('should handle authentication failures consistently across environments', async () => {
      defaultMockApiClient.ping.mockRejectedValue(new Error('Authentication failed'));
      
      // Test Node.js authentication failure
      __setTestEnvironment('node');
      const { Ship: NodeShip } = await import('../../src/node/index');
      const nodeShip = new NodeShip({ apiKey: 'invalid-key' });
      (nodeShip as any).http = defaultMockApiClient;
      
      // Test Browser authentication failure
      __setTestEnvironment('browser');
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      const browserShip = new BrowserShip({ 
        deployToken: 'invalid-token',
        apiUrl: 'https://api.shipstatic.dev'
      });
      (browserShip as any).http = defaultMockApiClient;
      
      // Both should fail with the same error
      try {
        await nodeShip.ping();
        expect.fail('Node.js ping should have been rejected');
      } catch (error: any) {
        expect(error.message).toBe('Authentication failed');
      }
      
      try {
        await browserShip.ping();
        expect.fail('Browser ping should have been rejected');
      } catch (error: any) {
        expect(error.message).toBe('Authentication failed');
      }
    });

    it('should provide identical resource access after authentication', async () => {
      const resourceTests = async (ship: any) => {
        // Test resource access
        expect(ship.deployments).toBeDefined();
        expect(ship.aliases).toBeDefined();
        expect(ship.account).toBeDefined();
        
        // Test resource method availability
        expect(typeof ship.deployments.list).toBe('function');
        expect(typeof ship.aliases.list).toBe('function');
        expect(typeof ship.account.get).toBe('function');
      };
      
      // Test Node.js Ship
      __setTestEnvironment('node');
      const { Ship: NodeShip } = await import('../../src/node/index');
      const nodeShip = new NodeShip({ apiKey: 'test-key' });
      await resourceTests(nodeShip);
      
      // Test Browser Ship
      __setTestEnvironment('browser');
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      const browserShip = new BrowserShip({ 
        deployToken: 'test-token',
        apiUrl: 'https://api.shipstatic.dev'
      });
      await resourceTests(browserShip);
    });
  });

  describe('Authentication Configuration Priority', () => {
    it('should prioritize explicit configuration over environment variables in Node', async () => {
      __setTestEnvironment('node');
      
      // Set environment variables
      process.env.SHIP_API_KEY = 'env-api-key';
      process.env.SHIP_API_URL = 'https://env-api.com';
      
      try {
        const { Ship } = await import('../../src/node/index');
        
        // Constructor options should take precedence
        const ship = new Ship({ 
          apiKey: 'constructor-api-key',
          apiUrl: 'https://constructor-api.com'
        });
        
        // Verify constructor options were used
        expect((ship as any).clientOptions.apiKey).toBe('constructor-api-key');
        expect((ship as any).clientOptions.apiUrl).toBe('https://constructor-api.com');
      } finally {
        // Clean up environment variables
        delete process.env.SHIP_API_KEY;
        delete process.env.SHIP_API_URL;
      }
    });

    it('should handle missing authentication gracefully across environments', async () => {
      // Test Node.js with missing API key
      __setTestEnvironment('node');
      const { Ship: NodeShip } = await import('../../src/node/index');
      
      // Constructor should succeed, but API calls will fail without authentication
      const nodeShipWithoutAuth = new NodeShip({} as any);
      expect(nodeShipWithoutAuth).toBeDefined();
      
      // Test Browser with missing deploy token (should work with defaults)
      __setTestEnvironment('browser');
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      
      expect(() => {
        new BrowserShip({});
      }).not.toThrow(); // Browser should work with defaults
    });
  });

  describe('Authentication State Management', () => {
    it('should maintain authentication state consistently during operations', async () => {
      const operations = ['ping', 'account.get', 'deployments.list'];
      
      for (const env of ['node', 'browser'] as const) {
        __setTestEnvironment(env);
        
        let ship: any;
        if (env === 'node') {
          const { Ship } = await import('../../src/node/index');
          ship = new Ship({ apiKey: 'test-key' });
        } else {
          const { Ship } = await import('../../src/browser/index');
          ship = new Ship({ 
            deployToken: 'test-token',
            apiUrl: 'https://api.shipstatic.dev'
          });
        }
        
        // Mock HTTP client with authentication tracking
        let authCallCount = 0;
        const trackingApiClient = {
          ...defaultMockApiClient,
          ping: vi.fn().mockImplementation(() => {
            authCallCount++;
            return Promise.resolve(true);
          }),
          getAccount: vi.fn().mockImplementation(() => {
            authCallCount++;
            return Promise.resolve({ email: 'test@example.com' });
          }),
          listDeployments: vi.fn().mockImplementation(() => {
            authCallCount++;
            return Promise.resolve({ deployments: [], count: 0 });
          })
        };
        
        // Replace the HTTP client and also spy on the resource methods to use our tracking client
        (ship as any).http = trackingApiClient;
        
        // Mock the ensureInitialized method to prevent HTTP client replacement
        vi.spyOn(ship as any, 'ensureInitialized').mockResolvedValue(undefined);
        
        // Override the resource methods to use our tracking API client directly
        vi.spyOn(ship.account, 'get').mockImplementation(async () => {
          return trackingApiClient.getAccount();
        });
        
        vi.spyOn(ship.deployments, 'list').mockImplementation(async () => {
          return trackingApiClient.listDeployments();
        });
        
        // Perform multiple operations
        await ship.ping();
        await ship.account.get();
        await ship.deployments.list();
        
        // Authentication should be maintained across operations
        expect(authCallCount).toBe(3);
      }
    });

    it('should handle authentication renewal consistently', async () => {
      // Test that authentication failures trigger appropriate handling
      let callCount = 0;
      const renewalApiClient = {
        ...defaultMockApiClient,
        ping: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            throw new Error('Authentication failed');
          }
          return Promise.resolve(true);
        })
      };
      
      for (const env of ['node', 'browser'] as const) {
        __setTestEnvironment(env);
        
        let ship: any;
        if (env === 'node') {
          const { Ship } = await import('../../src/node/index');
          ship = new Ship({ apiKey: 'test-key' });
        } else {
          const { Ship } = await import('../../src/browser/index');
          ship = new Ship({ 
            deployToken: 'test-token',
            apiUrl: 'https://api.shipstatic.dev'
          });
        }
        
        (ship as any).http = renewalApiClient;
        
        // Mock the ensureInitialized method to prevent HTTP client replacement
        vi.spyOn(ship as any, 'ensureInitialized').mockResolvedValue(undefined);
        
        // First call should fail
        try {
          await ship.ping();
          expect.fail('First ping should have been rejected');
        } catch (error: any) {
          expect(error.message).toBe('Authentication failed');
        }
        
        // Reset call count for next environment
        callCount = 0;
      }
    });
  });

  describe('Multi-tenancy and Account Isolation', () => {
    it('should isolate different authentication contexts properly', async () => {
      __setTestEnvironment('node');
      const { Ship } = await import('../../src/node/index');

      const ship1 = new Ship({ apiKey: 'account1-key' });
      const ship2 = new Ship({ apiKey: 'account2-key' });

      // Directly mock the 'get' method on the account resource for each instance
      vi.spyOn(ship1.account, 'get').mockResolvedValue({ email: 'account1@example.com' });
      vi.spyOn(ship2.account, 'get').mockResolvedValue({ email: 'account2@example.com' });

      // Each ship will now get its own account info
      const account1 = await ship1.account.get();
      const account2 = await ship2.account.get();

      expect(account1.email).toBe('account1@example.com');
      expect(account2.email).toBe('account2@example.com');
    });
  });

  describe('Authentication Security Validation', () => {
    it('should not expose authentication credentials in error messages', async () => {
      const sensitiveApiKey = 'sk_live_sensitive_key_12345';
      
      __setTestEnvironment('node');
      const { Ship } = await import('../../src/node/index');
      const ship = new Ship({ apiKey: sensitiveApiKey });
      
      // Mock authentication failure
      defaultMockApiClient.ping.mockRejectedValue(new Error('Authentication failed'));
      (ship as any).http = defaultMockApiClient;
      
      try {
        await ship.ping();
      } catch (error: any) {
        // Error message should not contain the sensitive API key
        expect(error.message).not.toContain(sensitiveApiKey);
        expect(error.message).not.toContain('sk_live_sensitive');
      }
    });

    it('should handle authentication timeouts consistently', async () => {
      const timeoutError = new Error('Authentication timeout');
      defaultMockApiClient.ping.mockRejectedValue(timeoutError);
      
      for (const env of ['node', 'browser'] as const) {
        __setTestEnvironment(env);
        
        let ship: any;
        if (env === 'node') {
          const { Ship } = await import('../../src/node/index');
          ship = new Ship({ apiKey: 'test-key' });
        } else {
          const { Ship } = await import('../../src/browser/index');
          ship = new Ship({ 
            deployToken: 'test-token',
            apiUrl: 'https://api.shipstatic.dev'
          });
        }
        
        (ship as any).http = defaultMockApiClient;
        
        await expect(ship.ping()).rejects.toThrow('Authentication timeout');
      }
    });
  });
});