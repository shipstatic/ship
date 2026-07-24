import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __setTestEnvironment } from '../../src/shared/lib/env';

// Mock environment-specific modules to avoid actual filesystem/network calls.
vi.mock('../../src/node/core/config', () => ({
  readEnvConfig: vi.fn(() => ({ token: 'test-key' })),
}));

vi.mock('../../src/node/core/node-files', () => ({
  processFilesForNode: vi.fn().mockResolvedValue([
    { path: 'test.html', content: Buffer.from('<html></html>'), size: 13, md5: 'node-hash' }
  ])
}));

vi.mock('../../src/browser/core/browser-files', () => ({
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
      const nodeShip = new NodeShip({ token: 'test-key' });

      __setTestEnvironment('browser');
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      const browserShip = new BrowserShip({ token: 'test-token', apiUrl: 'https://test.com' });

      // Both should have identical resource getters
      expect(nodeShip.deployments).toBeDefined();
      expect(nodeShip.domains).toBeDefined();
      expect(nodeShip.account).toBeDefined();

      expect(browserShip.deployments).toBeDefined();
      expect(browserShip.domains).toBeDefined();
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
      const nodeShip = new NodeShip({ token: 'test-key' });

      __setTestEnvironment('browser');
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      const browserShip = new BrowserShip({ token: 'test-token', apiUrl: 'https://test.com' });

      // Deployment resource methods
      expect(typeof nodeShip.deployments.upload).toBe('function');
      expect(typeof nodeShip.deployments.list).toBe('function');
      expect(typeof nodeShip.deployments.get).toBe('function');
      expect(typeof nodeShip.deployments.remove).toBe('function');

      expect(typeof browserShip.deployments.upload).toBe('function');
      expect(typeof browserShip.deployments.list).toBe('function');
      expect(typeof browserShip.deployments.get).toBe('function');
      expect(typeof browserShip.deployments.remove).toBe('function');

      // Domain resource methods
      expect(typeof nodeShip.domains.set).toBe('function');
      expect(typeof nodeShip.domains.get).toBe('function');
      expect(typeof nodeShip.domains.list).toBe('function');
      expect(typeof nodeShip.domains.remove).toBe('function');
      expect(typeof nodeShip.domains.verify).toBe('function');

      expect(typeof browserShip.domains.set).toBe('function');
      expect(typeof browserShip.domains.get).toBe('function');
      expect(typeof browserShip.domains.list).toBe('function');
      expect(typeof browserShip.domains.remove).toBe('function');
      expect(typeof browserShip.domains.verify).toBe('function');
    });
  });

  describe('Deploy Method Consistency', () => {
    it('should handle deploy calls with identical return format', async () => {
      const mockDeployResult = {
        id: 'consistent_deploy',
        url: 'https://consistent_deploy.shipstatic.com'
      };

      // Test Node.js Ship
      __setTestEnvironment('node');
      const { Ship: NodeShip } = await import('../../src/node/index');
      const nodeShip = new NodeShip({ token: 'test-key' });
      
      // Spy on the resource method directly
      vi.spyOn(nodeShip.deployments, 'upload').mockResolvedValue(mockDeployResult);

      const nodeResult = await nodeShip.deploy('./dist');

      // Test Browser Ship
      __setTestEnvironment('browser');
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      const browserShip = new BrowserShip({ token: 'test-token', apiUrl: 'https://test.com' });
      
      // Spy on the resource method directly
      vi.spyOn(browserShip.deployments, 'upload').mockResolvedValue(mockDeployResult);

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
        new NodeShip({ token: 'test-key' });
      }).toThrow('Node.js Ship class can only be used in Node.js environment.');

      __setTestEnvironment('unknown');
      expect(() => {
        new NodeShip({ token: 'test-key' });
      }).toThrow('Node.js Ship class can only be used in Node.js environment.');

      // Browser Ship should work in any environment (more permissive)
      __setTestEnvironment('node');
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      
      expect(() => {
        new BrowserShip({ token: 'test-token', apiUrl: 'https://test.com' });
      }).not.toThrow();

      __setTestEnvironment('unknown');
      expect(() => {
        new BrowserShip({ token: 'test-token', apiUrl: 'https://test.com' });
      }).not.toThrow();
    });
  });

  describe('Configuration Handling Consistency', () => {
    it('should resolve initial configuration consistently', async () => {
      __setTestEnvironment('node');
      const { Ship: NodeShip } = await import('../../src/node/index');
      const nodeShip = new NodeShip({
        apiUrl: 'https://custom-node.com',
        token: 'node-key'
      });

      __setTestEnvironment('browser');
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      const browserShip = new BrowserShip({
        apiUrl: 'https://custom-browser.com',
        token: 'browser-token'
      });

      // Both should have stored their options correctly
      expect((nodeShip as any).clientOptions.apiUrl).toBe('https://custom-node.com');
      expect((nodeShip as any).clientOptions.token).toBe('node-key');

      expect((browserShip as any).clientOptions.apiUrl).toBe('https://custom-browser.com');
      expect((browserShip as any).clientOptions.token).toBe('browser-token');
    });
  });

  describe('Lazy Initialization Consistency', () => {
    it('should handle lazy initialization consistently across environments', async () => {
      __setTestEnvironment('node');
      const { Ship: NodeShip } = await import('../../src/node/index');
      const nodeShip = new NodeShip({ token: 'test-key' });

      __setTestEnvironment('browser');
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      const browserShip = new BrowserShip({ token: 'test-token', apiUrl: 'https://test.com' });

      // Mock HTTP clients
      (nodeShip as any).http = {
        ping: vi.fn().mockResolvedValue(true),
        getLimits: vi.fn().mockResolvedValue({ maxFileSize: 10485760, maxFilesCount: 1000, maxTotalSize: 52428800 })
      };

      (browserShip as any).http = {
        ping: vi.fn().mockResolvedValue(true),
        getLimits: vi.fn().mockResolvedValue({ maxFileSize: 10485760, maxFilesCount: 1000, maxTotalSize: 52428800 })
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