import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __setTestEnvironment } from '../../src/shared/lib/env';

// Mock environment-specific modules to avoid actual file system/network calls
vi.mock('../../src/node/core/config', () => ({
  loadConfig: vi.fn().mockResolvedValue({ apiKey: 'test-key' })
}));

vi.mock('../../src/node/core/platform-config', () => ({
  setConfig: vi.fn(),
  getCurrentConfig: vi.fn().mockReturnValue({})
}));

vi.mock('../../src/node/core/prepare-input', () => ({
  convertDeployInput: vi.fn().mockResolvedValue([
    { path: 'test.html', content: Buffer.from('<html></html>'), size: 13, md5: 'node-hash' }
  ])
}));

vi.mock('../../src/browser/core/config', () => ({
  setConfig: vi.fn(),
  loadConfig: vi.fn().mockResolvedValue({})
}));

vi.mock('../../src/browser/lib/browser-files', () => ({
  processFilesForBrowser: vi.fn().mockResolvedValue([
    { path: 'test.html', content: new ArrayBuffer(13), size: 13, md5: 'browser-hash' }
  ])
}));

describe('Ship Implementation Integration - Cross-Environment Consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Ship Class Interface Consistency', () => {
    it('should provide identical public APIs across environments', async () => {
      __setTestEnvironment('node');
      const { Ship: NodeShip } = await import('../../src/node/index');
      const nodeShip = new NodeShip({ apiKey: 'test-key' });

      __setTestEnvironment('browser');
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      const browserShip = new BrowserShip({ deployToken: 'test-token', apiUrl: 'https://test.com' });

      // Both should have identical resource getters
      expect(nodeShip.deployments).toBeDefined();
      expect(nodeShip.aliases).toBeDefined();
      expect(nodeShip.account).toBeDefined();

      expect(browserShip.deployments).toBeDefined();
      expect(browserShip.aliases).toBeDefined();
      expect(browserShip.account).toBeDefined();

      // Both should have identical convenience methods
      expect(typeof nodeShip.deploy).toBe('function');
      expect(typeof nodeShip.whoami).toBe('function');
      expect(typeof nodeShip.ping).toBe('function');

      expect(typeof browserShip.deploy).toBe('function');
      expect(typeof browserShip.whoami).toBe('function');
      expect(typeof browserShip.ping).toBe('function');
    });

    it('should provide identical resource method signatures', async () => {
      __setTestEnvironment('node');
      const { Ship: NodeShip } = await import('../../src/node/index');
      const nodeShip = new NodeShip({ apiKey: 'test-key' });

      __setTestEnvironment('browser');
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      const browserShip = new BrowserShip({ deployToken: 'test-token', apiUrl: 'https://test.com' });

      // Deployment resource methods
      expect(typeof nodeShip.deployments.create).toBe('function');
      expect(typeof nodeShip.deployments.list).toBe('function');
      expect(typeof nodeShip.deployments.get).toBe('function');
      expect(typeof nodeShip.deployments.remove).toBe('function');

      expect(typeof browserShip.deployments.create).toBe('function');
      expect(typeof browserShip.deployments.list).toBe('function');
      expect(typeof browserShip.deployments.get).toBe('function');
      expect(typeof browserShip.deployments.remove).toBe('function');

      // Alias resource methods
      expect(typeof nodeShip.aliases.set).toBe('function');
      expect(typeof nodeShip.aliases.get).toBe('function');
      expect(typeof nodeShip.aliases.list).toBe('function');
      expect(typeof nodeShip.aliases.remove).toBe('function');
      expect(typeof nodeShip.aliases.check).toBe('function');

      expect(typeof browserShip.aliases.set).toBe('function');
      expect(typeof browserShip.aliases.get).toBe('function');
      expect(typeof browserShip.aliases.list).toBe('function');
      expect(typeof browserShip.aliases.remove).toBe('function');
      expect(typeof browserShip.aliases.check).toBe('function');
    });
  });

  describe('Deploy Method Consistency', () => {
    it('should handle deploy calls with identical return format', async () => {
      const mockDeployResult = {
        id: 'consistent_deploy',
        url: 'https://consistent_deploy.shipstatic.dev'
      };

      // Test Node.js Ship
      __setTestEnvironment('node');
      const { Ship: NodeShip } = await import('../../src/node/index');
      const nodeShip = new NodeShip({ apiKey: 'test-key' });
      
      // Spy on the resource method directly
      vi.spyOn(nodeShip.deployments, 'create').mockResolvedValue(mockDeployResult);

      const nodeResult = await nodeShip.deploy('./dist');

      // Test Browser Ship
      __setTestEnvironment('browser');
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      const browserShip = new BrowserShip({ deployToken: 'test-token', apiUrl: 'https://test.com' });
      
      // Spy on the resource method directly
      vi.spyOn(browserShip.deployments, 'create').mockResolvedValue(mockDeployResult);

      const mockFiles = [new File(['<html></html>'], 'index.html')];
      const browserResult = await browserShip.deploy(mockFiles);

      // Both should return identical format
      expect(nodeResult).toEqual(mockDeployResult);
      expect(browserResult).toEqual(mockDeployResult);
    });
  });

  describe('Error Handling Consistency', () => {
    it('should handle environment validation consistently', async () => {
      // Node.js Ship should reject non-Node environments
      __setTestEnvironment('browser');
      const { Ship: NodeShip } = await import('../../src/node/index');
      
      expect(() => {
        new NodeShip({ apiKey: 'test-key' });
      }).toThrow('Node.js Ship class can only be used in Node.js environment.');

      __setTestEnvironment('unknown');
      expect(() => {
        new NodeShip({ apiKey: 'test-key' });
      }).toThrow('Node.js Ship class can only be used in Node.js environment.');

      // Browser Ship should work in any environment (more permissive)
      __setTestEnvironment('node');
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      
      expect(() => {
        new BrowserShip({ deployToken: 'test-token', apiUrl: 'https://test.com' });
      }).not.toThrow();

      __setTestEnvironment('unknown');
      expect(() => {
        new BrowserShip({ deployToken: 'test-token', apiUrl: 'https://test.com' });
      }).not.toThrow();
    });
  });

  describe('Configuration Handling Consistency', () => {
    it('should resolve initial configuration consistently', async () => {
      __setTestEnvironment('node');
      const { Ship: NodeShip } = await import('../../src/node/index');
      const nodeShip = new NodeShip({ 
        apiUrl: 'https://custom-node.com',
        apiKey: 'node-key'
      });

      __setTestEnvironment('browser');
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      const browserShip = new BrowserShip({ 
        apiUrl: 'https://custom-browser.com',
        deployToken: 'browser-token'
      });

      // Both should have stored their options correctly
      expect((nodeShip as any).clientOptions.apiUrl).toBe('https://custom-node.com');
      expect((nodeShip as any).clientOptions.apiKey).toBe('node-key');

      expect((browserShip as any).clientOptions.apiUrl).toBe('https://custom-browser.com');
      expect((browserShip as any).clientOptions.deployToken).toBe('browser-token');
    });
  });

  describe('Lazy Initialization Consistency', () => {
    it('should handle lazy initialization consistently across environments', async () => {
      __setTestEnvironment('node');
      const { Ship: NodeShip } = await import('../../src/node/index');
      const nodeShip = new NodeShip({ apiKey: 'test-key' });

      __setTestEnvironment('browser');
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      const browserShip = new BrowserShip({ deployToken: 'test-token', apiUrl: 'https://test.com' });

      // Mock HTTP clients
      (nodeShip as any).http = {
        ping: vi.fn().mockResolvedValue(true),
        getConfig: vi.fn().mockResolvedValue({})
      };

      (browserShip as any).http = {
        ping: vi.fn().mockResolvedValue(true)
      };

      // Both should handle ping (which triggers initialization) successfully
      const nodePingResult = await nodeShip.ping();
      const browserPingResult = await browserShip.ping();

      expect(nodePingResult).toBe(true);
      expect(browserPingResult).toBe(true);
    });
  });

  describe('Shared Functionality Access', () => {
    it('should provide access to shared utilities from both environments', async () => {
      // Test Node.js exports
      __setTestEnvironment('node');
      const nodeModule = await import('../../src/node/index');
      
      expect(nodeModule.getENV).toBeDefined();
      expect(nodeModule.__setTestEnvironment).toBeDefined();
      expect(nodeModule.ShipError).toBeDefined();

      // Test Browser exports  
      __setTestEnvironment('browser');
      const browserModule = await import('../../src/browser/index');
      
      expect(browserModule.getENV).toBeDefined();
      expect(browserModule.__setTestEnvironment).toBeDefined();
      expect(browserModule.ShipError).toBeDefined();
    });
  });
});