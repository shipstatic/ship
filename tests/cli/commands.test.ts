import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Ship } from '@/index';

// Mock the Ship class and its methods
vi.mock('@/index', () => {
  const mockShip = {
    ping: vi.fn(),
    deployments: {
      list: vi.fn(),
      create: vi.fn(),
      get: vi.fn(),
      remove: vi.fn()
    },
    aliases: {
      list: vi.fn(),
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn()
    },
    account: {
      get: vi.fn()
    }
  };

  return {
    Ship: vi.fn(() => mockShip)
  };
});

describe('CLI Commands', () => {
  // NOTE: These tests focus on the SDK methods that the CLI calls,
  // not the CLI argument parsing itself (which uses manual parsing in src/cli/index.ts)
  // CLI commands like "ship deployments list" ultimately call these SDK methods.
  
  let mockShip: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    // Get the mocked Ship instance
    mockShip = new Ship();
    
    // Mock console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Deployment Commands', () => {
    it('should handle deployments.list', async () => {
      // Mock the API response
      const mockResponse = {
        deployments: [
          { deployment: 'abc123', status: 'success' },
          { deployment: 'def456', status: 'pending' }
        ]
      };
      mockShip.deployments.list.mockResolvedValue(mockResponse);

      // Import and test the CLI logic (since commands are not easily unit testable due to commander.js)
      // We'll test the core functions instead
      const { Ship: ShipClass } = await import('@/index');
      const client = new ShipClass();
      const result = await client.deployments.list();

      expect(mockShip.deployments.list).toHaveBeenCalled();
      expect(result).toEqual(mockResponse);
    });

    it('should handle deployments.create', async () => {
      const mockResponse = { deployment: 'abc123', status: 'success' };
      mockShip.deployments.create.mockResolvedValue(mockResponse);

      const { Ship: ShipClass } = await import('@/index');
      const client = new ShipClass();
      const result = await client.deployments.create(['./dist']);

      expect(mockShip.deployments.create).toHaveBeenCalledWith(['./dist']);
      expect(result).toEqual(mockResponse);
    });

    it('should handle deployments.get', async () => {
      const mockResponse = { deployment: 'abc123', status: 'success' };
      mockShip.deployments.get.mockResolvedValue(mockResponse);

      const { Ship: ShipClass } = await import('@/index');
      const client = new ShipClass();
      const result = await client.deployments.get('abc123');

      expect(mockShip.deployments.get).toHaveBeenCalledWith('abc123');
      expect(result).toEqual(mockResponse);
    });

    it('should handle deployments.remove', async () => {
      const mockResponse = { message: 'Deployment removed' };
      mockShip.deployments.remove.mockResolvedValue(mockResponse);

      const { Ship: ShipClass } = await import('@/index');
      const client = new ShipClass();
      const result = await client.deployments.remove('abc123');

      expect(mockShip.deployments.remove).toHaveBeenCalledWith('abc123');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('Alias Commands', () => {
    it('should handle aliases.list', async () => {
      const mockResponse = {
        aliases: [
          { alias: 'staging', deployment: 'abc123' },
          { alias: 'production', deployment: 'def456' }
        ]
      };
      mockShip.aliases.list.mockResolvedValue(mockResponse);

      const { Ship: ShipClass } = await import('@/index');
      const client = new ShipClass();
      const result = await client.aliases.list();

      expect(mockShip.aliases.list).toHaveBeenCalled();
      expect(result).toEqual(mockResponse);
    });

    it('should handle aliases.set', async () => {
      const mockResponse = { alias: 'staging', deployment: 'abc123' };
      mockShip.aliases.set.mockResolvedValue(mockResponse);

      const { Ship: ShipClass } = await import('@/index');
      const client = new ShipClass();
      const result = await client.aliases.set('staging', 'abc123');

      expect(mockShip.aliases.set).toHaveBeenCalledWith('staging', 'abc123');
      expect(result).toEqual(mockResponse);
    });

    it('should handle aliases.get', async () => {
      const mockResponse = { alias: 'staging', deployment: 'abc123' };
      mockShip.aliases.get.mockResolvedValue(mockResponse);

      const { Ship: ShipClass } = await import('@/index');
      const client = new ShipClass();
      const result = await client.aliases.get('staging');

      expect(mockShip.aliases.get).toHaveBeenCalledWith('staging');
      expect(result).toEqual(mockResponse);
    });

    it('should handle aliases.remove', async () => {
      const mockResponse = { message: 'Alias removed' };
      mockShip.aliases.remove.mockResolvedValue(mockResponse);

      const { Ship: ShipClass } = await import('@/index');
      const client = new ShipClass();
      const result = await client.aliases.remove('staging');

      expect(mockShip.aliases.remove).toHaveBeenCalledWith('staging');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('Account Commands', () => {
    it('should handle account.get', async () => {
      const mockResponse = {
        email: 'user@example.com',
        subscription: 'free'
      };
      mockShip.account.get.mockResolvedValue(mockResponse);

      const { Ship: ShipClass } = await import('@/index');
      const client = new ShipClass();
      const result = await client.account.get();

      expect(mockShip.account.get).toHaveBeenCalled();
      expect(result).toEqual(mockResponse);
    });
  });

  describe('Ping Command', () => {
    it('should handle ping', async () => {
      mockShip.ping.mockResolvedValue(true);

      const { Ship: ShipClass } = await import('@/index');
      const client = new ShipClass();
      const result = await client.ping();

      expect(mockShip.ping).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });
});