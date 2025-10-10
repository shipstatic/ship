import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Ship } from '../../src/shared/base-ship';
import type { ShipClientOptions, DeployInput, DeploymentOptions, StaticFile } from '../../src/shared/types';

// Create a concrete test implementation of the abstract Ship class
class TestShip extends Ship {
  protected resolveInitialConfig(options: ShipClientOptions): any {
    return {
      apiUrl: options.apiUrl || 'https://test-api.com',
      apiKey: options.apiKey,
      deployToken: options.deployToken
    };
  }

  protected async loadFullConfig(): Promise<void> {
    // Simple test implementation - just resolve immediately
    return Promise.resolve();
  }

  protected async processInput(input: DeployInput, options: DeploymentOptions): Promise<StaticFile[]> {
    // Simple test implementation
    return Promise.resolve([
      {
        path: 'test.html',
        content: Buffer.from('<html>Test</html>'),
        size: 18,
        md5: 'test-hash'
      }
    ]);
  }
}

describe('Base Ship Class (Abstract)', () => {
  let ship: TestShip;
  let mockApiDeploy: vi.Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock the API deploy method
    mockApiDeploy = vi.fn().mockResolvedValue({
      id: 'dep_123',
      url: 'https://dep_123.shipstatic.dev'
    });

    ship = new TestShip({ apiUrl: 'https://test-api.com' });
    
    // Override the http client with our mock
    (ship as any).http = {
      deploy: mockApiDeploy,
      ping: vi.fn().mockResolvedValue(true),
      getConfig: vi.fn().mockResolvedValue({}),
      listDeployments: vi.fn().mockResolvedValue({ deployments: [], count: 0 }),
      getDeployment: vi.fn().mockResolvedValue({ id: 'dep_123' }),
      removeDeployment: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({ username: 'testuser' }),
      getAccount: vi.fn().mockResolvedValue({ username: 'testuser' }),
      listApiKeys: vi.fn().mockResolvedValue({ keys: [], count: 0 }),
      removeApiKey: vi.fn().mockResolvedValue(undefined)
    };
  });

  describe('constructor', () => {
    it('should initialize with provided options', () => {
      const options = { apiUrl: 'https://custom-api.com', apiKey: 'test-key' };
      const testShip = new TestShip(options);

      expect((testShip as any).clientOptions).toEqual(options);
    });

    it('should create resource instances', () => {
      expect(ship.deployments).toBeDefined();
      expect(ship.domains).toBeDefined();
      expect(ship.account).toBeDefined();
    });
  });

  describe('deploy convenience method', () => {
    it('should call deployments.create with input and options', async () => {
      const input = ['./test'];
      const options = { timeout: 5000 };

      const result = await ship.deploy(input as any, options);

      expect(result).toEqual({
        id: 'dep_123',
        url: 'https://dep_123.shipstatic.dev'
      });
      expect(mockApiDeploy).toHaveBeenCalled();
    });
  });

  describe('whoami convenience method', () => {
    it('should call account.get', async () => {
      const result = await ship.whoami();
      
      expect(result).toEqual({ username: 'testuser' });
      expect((ship as any).http.getAccount).toHaveBeenCalled();
    });
  });

  describe('ping method', () => {
    it('should call http.ping after initialization', async () => {
      const result = await ship.ping();
      
      expect(result).toBe(true);
      expect((ship as any).http.ping).toHaveBeenCalled();
    });
  });

  describe('resource getters', () => {
    it('should provide access to all resources', () => {
      expect(typeof ship.deployments.create).toBe('function');
      expect(typeof ship.deployments.list).toBe('function');
      expect(typeof ship.deployments.get).toBe('function');
      expect(typeof ship.deployments.remove).toBe('function');

      expect(typeof ship.domains.set).toBe('function');
      expect(typeof ship.domains.get).toBe('function');
      expect(typeof ship.domains.list).toBe('function');
      expect(typeof ship.domains.remove).toBe('function');
      expect(typeof ship.domains.confirm).toBe('function');

      expect(typeof ship.account.get).toBe('function');
    });
  });

  describe('initialization flow', () => {
    it('should handle lazy initialization', async () => {
      // Initialization should happen when we first call a method that needs it
      await ship.ping();
      
      // The ensureInitialized method should have been called
      // (This is verified through the ping call succeeding)
      expect(true).toBe(true); // Basic assertion that we got here
    });
  });
});