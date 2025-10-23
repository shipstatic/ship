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
    return Promise.resolve();
  }

  protected async processInput(input: DeployInput, options: DeploymentOptions): Promise<StaticFile[]> {
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

describe('Authentication Lifecycle', () => {
  let mockApiDeploy: vi.Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockApiDeploy = vi.fn().mockResolvedValue({
      id: 'dep_123',
      url: 'https://dep_123.shipstatic.dev'
    });
  });

  describe('setDeployToken()', () => {
    it('should allow setting deploy token after initialization', async () => {
      const ship = new TestShip({ apiUrl: 'https://test-api.com' });

      // Override http with mock
      (ship as any).http = {
        deploy: mockApiDeploy,
        ping: vi.fn().mockResolvedValue(true),
        getConfig: vi.fn().mockResolvedValue({})
      };

      // Initially no auth - deployment should fail
      await expect(ship.deploy(['./test'] as any)).rejects.toThrow(
        'Authentication credentials are required for deployment'
      );

      // Set deploy token
      ship.setDeployToken('token-1234567890abcdef');

      // Now deployment should succeed
      const result = await ship.deploy(['./test'] as any);
      expect(result).toEqual({
        id: 'dep_123',
        url: 'https://dep_123.shipstatic.dev'
      });
      expect(mockApiDeploy).toHaveBeenCalled();
    });

    it('should validate deploy token input', () => {
      const ship = new TestShip({ apiUrl: 'https://test-api.com' });

      expect(() => ship.setDeployToken('')).toThrow('Invalid deploy token');
      expect(() => ship.setDeployToken(null as any)).toThrow('Invalid deploy token');
      expect(() => ship.setDeployToken(undefined as any)).toThrow('Invalid deploy token');
    });

    it('should override existing apiKey', async () => {
      const ship = new TestShip({
        apiUrl: 'https://test-api.com',
        apiKey: 'ship-oldkey123'
      });

      // Override http with mock
      (ship as any).http = {
        deploy: mockApiDeploy,
        ping: vi.fn().mockResolvedValue(true),
        getConfig: vi.fn().mockResolvedValue({})
      };

      // Set deploy token - should override apiKey
      ship.setDeployToken('token-newtoken456');

      await ship.deploy(['./test'] as any);
      expect(mockApiDeploy).toHaveBeenCalled();
    });
  });

  describe('setApiKey()', () => {
    it('should allow setting API key after initialization', async () => {
      const ship = new TestShip({ apiUrl: 'https://test-api.com' });

      // Override http with mock
      (ship as any).http = {
        deploy: mockApiDeploy,
        ping: vi.fn().mockResolvedValue(true),
        getConfig: vi.fn().mockResolvedValue({})
      };

      // Initially no auth - deployment should fail
      await expect(ship.deploy(['./test'] as any)).rejects.toThrow(
        'Authentication credentials are required for deployment'
      );

      // Set API key
      ship.setApiKey('ship-apikey789');

      // Now deployment should succeed
      const result = await ship.deploy(['./test'] as any);
      expect(result).toEqual({
        id: 'dep_123',
        url: 'https://dep_123.shipstatic.dev'
      });
      expect(mockApiDeploy).toHaveBeenCalled();
    });

    it('should validate API key input', () => {
      const ship = new TestShip({ apiUrl: 'https://test-api.com' });

      expect(() => ship.setApiKey('')).toThrow('Invalid API key');
      expect(() => ship.setApiKey(null as any)).toThrow('Invalid API key');
      expect(() => ship.setApiKey(undefined as any)).toThrow('Invalid API key');
    });

    it('should override existing deployToken', async () => {
      const ship = new TestShip({
        apiUrl: 'https://test-api.com',
        deployToken: 'token-oldtoken123'
      });

      // Override http with mock
      (ship as any).http = {
        deploy: mockApiDeploy,
        ping: vi.fn().mockResolvedValue(true),
        getConfig: vi.fn().mockResolvedValue({})
      };

      // Set API key - should override deployToken
      ship.setApiKey('ship-newapikey456');

      await ship.deploy(['./test'] as any);
      expect(mockApiDeploy).toHaveBeenCalled();
    });
  });

  describe('per-deployment auth override', () => {
    it('should allow deployment with per-deploy token even without instance auth', async () => {
      const ship = new TestShip({ apiUrl: 'https://test-api.com' });

      // Override http with mock
      (ship as any).http = {
        deploy: mockApiDeploy,
        ping: vi.fn().mockResolvedValue(true),
        getConfig: vi.fn().mockResolvedValue({})
      };

      // Deployment with per-deploy token should succeed
      const result = await ship.deploy(['./test'] as any, {
        deployToken: 'token-perdeploy123'
      });

      expect(result).toEqual({
        id: 'dep_123',
        url: 'https://dep_123.shipstatic.dev'
      });
      expect(mockApiDeploy).toHaveBeenCalled();
    });

    it('should allow deployment with per-deploy apiKey even without instance auth', async () => {
      const ship = new TestShip({ apiUrl: 'https://test-api.com' });

      // Override http with mock
      (ship as any).http = {
        deploy: mockApiDeploy,
        ping: vi.fn().mockResolvedValue(true),
        getConfig: vi.fn().mockResolvedValue({})
      };

      // Deployment with per-deploy apiKey should succeed
      const result = await ship.deploy(['./test'] as any, {
        apiKey: 'ship-perdeploykey123'
      });

      expect(result).toEqual({
        id: 'dep_123',
        url: 'https://dep_123.shipstatic.dev'
      });
      expect(mockApiDeploy).toHaveBeenCalled();
    });
  });

  describe('constructor auth initialization', () => {
    it('should initialize with deployToken from constructor', async () => {
      const ship = new TestShip({
        apiUrl: 'https://test-api.com',
        deployToken: 'token-constructor123'
      });

      // Override http with mock
      (ship as any).http = {
        deploy: mockApiDeploy,
        ping: vi.fn().mockResolvedValue(true),
        getConfig: vi.fn().mockResolvedValue({})
      };

      // Should succeed with constructor auth
      await ship.deploy(['./test'] as any);
      expect(mockApiDeploy).toHaveBeenCalled();
    });

    it('should initialize with apiKey from constructor', async () => {
      const ship = new TestShip({
        apiUrl: 'https://test-api.com',
        apiKey: 'ship-constructor123'
      });

      // Override http with mock
      (ship as any).http = {
        deploy: mockApiDeploy,
        ping: vi.fn().mockResolvedValue(true),
        getConfig: vi.fn().mockResolvedValue({})
      };

      // Should succeed with constructor auth
      await ship.deploy(['./test'] as any);
      expect(mockApiDeploy).toHaveBeenCalled();
    });

    it('should prioritize deployToken over apiKey in constructor', async () => {
      const ship = new TestShip({
        apiUrl: 'https://test-api.com',
        deployToken: 'token-priority123',
        apiKey: 'ship-secondary123'
      });

      // Override http with mock
      (ship as any).http = {
        deploy: mockApiDeploy,
        ping: vi.fn().mockResolvedValue(true),
        getConfig: vi.fn().mockResolvedValue({})
      };

      // Should succeed with deployToken (higher priority)
      await ship.deploy(['./test'] as any);
      expect(mockApiDeploy).toHaveBeenCalled();
    });
  });

  describe('getAuthHeaders branch coverage', () => {
    it('should return empty object when auth is null', () => {
      const ship = new TestShip({ apiUrl: 'https://test-api.com' });

      // Access the private method through the callback
      const headers = (ship as any).authHeadersCallback();

      expect(headers).toEqual({});
    });

    it('should return Bearer token for deployToken', () => {
      const ship = new TestShip({
        apiUrl: 'https://test-api.com',
        deployToken: 'token-test123'
      });

      const headers = (ship as any).authHeadersCallback();

      expect(headers).toEqual({
        'Authorization': 'Bearer token-test123'
      });
    });

    it('should return Bearer token for apiKey', () => {
      const ship = new TestShip({
        apiUrl: 'https://test-api.com',
        apiKey: 'ship-test123'
      });

      const headers = (ship as any).authHeadersCallback();

      expect(headers).toEqual({
        'Authorization': 'Bearer ship-test123'
      });
    });

    it('should update headers after setDeployToken', () => {
      const ship = new TestShip({ apiUrl: 'https://test-api.com' });

      // Initially empty
      expect((ship as any).authHeadersCallback()).toEqual({});

      // Set token
      ship.setDeployToken('token-new123');

      // Now has auth header
      expect((ship as any).authHeadersCallback()).toEqual({
        'Authorization': 'Bearer token-new123'
      });
    });

    it('should update headers after setApiKey', () => {
      const ship = new TestShip({ apiUrl: 'https://test-api.com' });

      // Initially empty
      expect((ship as any).authHeadersCallback()).toEqual({});

      // Set api key
      ship.setApiKey('ship-new123');

      // Now has auth header
      expect((ship as any).authHeadersCallback()).toEqual({
        'Authorization': 'Bearer ship-new123'
      });
    });

    it('should override apiKey with deployToken', () => {
      const ship = new TestShip({
        apiUrl: 'https://test-api.com',
        apiKey: 'ship-initial123'
      });

      // Initially has apiKey
      expect((ship as any).authHeadersCallback()).toEqual({
        'Authorization': 'Bearer ship-initial123'
      });

      // Override with deployToken
      ship.setDeployToken('token-override123');

      // Now has deployToken
      expect((ship as any).authHeadersCallback()).toEqual({
        'Authorization': 'Bearer token-override123'
      });
    });

    it('should override deployToken with apiKey', () => {
      const ship = new TestShip({
        apiUrl: 'https://test-api.com',
        deployToken: 'token-initial123'
      });

      // Initially has deployToken
      expect((ship as any).authHeadersCallback()).toEqual({
        'Authorization': 'Bearer token-initial123'
      });

      // Override with apiKey
      ship.setApiKey('ship-override123');

      // Now has apiKey
      expect((ship as any).authHeadersCallback()).toEqual({
        'Authorization': 'Bearer ship-override123'
      });
    });
  });
});
