import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __setTestEnvironment } from '../../src/shared/lib/env';

/**
 * Cross-Environment Resource API Consistency Tests
 * 
 * These tests validate that all resource APIs (deployments, aliases, account)
 * behave identically across browser and Node.js environments.
 */

// Shared mock API client
const createMockApiClient = () => ({
  deploy: vi.fn().mockResolvedValue({
    id: 'dep_123',
    url: 'https://dep_123.shipstatic.dev',
    files: []
  }),
  listDeployments: vi.fn().mockResolvedValue({
    deployments: [
      { id: 'dep_1', url: 'https://dep_1.shipstatic.dev', created: '2024-01-01T00:00:00Z' },
      { id: 'dep_2', url: 'https://dep_2.shipstatic.dev', created: '2024-01-02T00:00:00Z' }
    ],
    count: 2
  }),
  getDeployment: vi.fn().mockResolvedValue({
    id: 'dep_123',
    url: 'https://dep_123.shipstatic.dev',
    created: '2024-01-01T00:00:00Z',
    files: []
  }),
  removeDeployment: vi.fn().mockResolvedValue(undefined),
  listAliases: vi.fn().mockResolvedValue({
    aliases: [
      { domain: 'example.com', deployment: 'dep_123', verified: true },
      { domain: 'test.com', deployment: 'dep_456', verified: false }
    ],
    count: 2
  }),
  createAlias: vi.fn().mockResolvedValue({
    domain: 'new.example.com',
    deployment: 'dep_123',
    verified: false
  }),
  getAccount: vi.fn().mockResolvedValue({
    email: 'test@example.com',
    plan: 'free',
    usage: {
      deployments: 5,
      storage: 1024000
    }
  }),
  ping: vi.fn().mockResolvedValue(true),
  checkSPA: vi.fn().mockResolvedValue(false)
});

describe('Resource API Cross-Environment Consistency', () => {
  let mockApiClient: ReturnType<typeof createMockApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient = createMockApiClient();
  });

  describe('Deployment Resource Consistency', () => {
    it('should provide identical deployment resource interface across environments', async () => {
      // Test Node.js environment
      __setTestEnvironment('node');
      const { createDeploymentResource: createNodeDeploymentResource } = await import('../../src/shared/resources');
      const nodeDeploymentResource = createNodeDeploymentResource(
        () => mockApiClient,
        {},
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue([
          { path: 'test.html', content: Buffer.from('<html></html>'), size: 13, md5: 'hash' }
        ])
      );

      // Test Browser environment
      __setTestEnvironment('browser');
      const { createDeploymentResource: createBrowserDeploymentResource } = await import('../../src/shared/resources');
      const browserDeploymentResource = createBrowserDeploymentResource(
        () => mockApiClient,
        {},
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue([
          { path: 'test.html', content: new ArrayBuffer(13), size: 13, md5: 'hash' }
        ])
      );

      // Validate identical method signatures
      expect(typeof nodeDeploymentResource.create).toBe('function');
      expect(typeof nodeDeploymentResource.list).toBe('function');
      expect(typeof nodeDeploymentResource.get).toBe('function');
      expect(typeof nodeDeploymentResource.remove).toBe('function');

      expect(typeof browserDeploymentResource.create).toBe('function');
      expect(typeof browserDeploymentResource.list).toBe('function');
      expect(typeof browserDeploymentResource.get).toBe('function');
      expect(typeof browserDeploymentResource.remove).toBe('function');

      // Test method behavior consistency
      const nodeResult = await nodeDeploymentResource.list();
      const browserResult = await browserDeploymentResource.list();

      expect(nodeResult).toEqual(browserResult);
      expect(mockApiClient.listDeployments).toHaveBeenCalledTimes(2);
    });

    it('should return identical deployment create responses across environments', async () => {
      // Node.js deployment
      __setTestEnvironment('node');
      const { createDeploymentResource: createNodeResource } = await import('../../src/shared/resources');
      const nodeResource = createNodeResource(
        () => mockApiClient,
        {},
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue([{ path: 'test.html', content: Buffer.from('test'), size: 4, md5: 'hash' }])
      );

      // Browser deployment
      __setTestEnvironment('browser');
      const { createDeploymentResource: createBrowserResource } = await import('../../src/shared/resources');
      const browserResource = createBrowserResource(
        () => mockApiClient,
        {},
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue([{ path: 'test.html', content: new ArrayBuffer(4), size: 4, md5: 'hash' }])
      );

      const nodeResult = await nodeResource.create(['./test.html'] as any, {});
      const browserResult = await browserResource.create([new File(['test'], 'test.html')] as any, {});

      // Results should be identical
      expect(nodeResult).toEqual(browserResult);
      expect(nodeResult).toEqual({
        id: 'dep_123',
        url: 'https://dep_123.shipstatic.dev',
        files: []
      });
    });

    it('should handle deployment errors consistently across environments', async () => {
      // Configure API to return error
      mockApiClient.deploy.mockRejectedValue(new Error('API key is invalid'));

      // Test Node.js environment
      __setTestEnvironment('node');
      const { createDeploymentResource: createNodeResource } = await import('../../src/shared/resources');
      const nodeResource = createNodeResource(
        () => mockApiClient,
        {},
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue([{ path: 'test.html', content: Buffer.from('test'), size: 4, md5: 'hash' }])
      );

      // Test Browser environment
      __setTestEnvironment('browser');
      const { createDeploymentResource: createBrowserResource } = await import('../../src/shared/resources');
      const browserResource = createBrowserResource(
        () => mockApiClient,
        {},
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue([{ path: 'test.html', content: new ArrayBuffer(4), size: 4, md5: 'hash' }])
      );

      // Both should throw identical errors
      await expect(nodeResource.create(['./test.html'] as any, {}))
        .rejects.toThrow('API key is invalid');
      
      await expect(browserResource.create([new File(['test'], 'test.html')] as any, {}))
        .rejects.toThrow('API key is invalid');
    });
  });

  describe('Alias Resource Consistency', () => {
    it('should provide identical alias resource interface across environments', async () => {
      // Test in both environments
      const environments = ['node', 'browser'] as const;
      const results: any[] = [];

      for (const env of environments) {
        __setTestEnvironment(env);
        const { createAliasResource } = await import('../../src/shared/resources');
        const aliasResource = createAliasResource(() => mockApiClient);

        // Validate interface
        expect(typeof aliasResource.list).toBe('function');
        expect(typeof aliasResource.set).toBe('function');
        expect(typeof aliasResource.get).toBe('function');
        expect(typeof aliasResource.remove).toBe('function');
        expect(typeof aliasResource.check).toBe('function');

        // Test method behavior
        const result = await aliasResource.list();
        results.push(result);
      }

      // Results should be identical
      expect(results[0]).toEqual(results[1]);
      expect(results[0]).toEqual({
        aliases: [
          { domain: 'example.com', deployment: 'dep_123', verified: true },
          { domain: 'test.com', deployment: 'dep_456', verified: false }
        ],
        count: 2
      });
    });

    it('should set aliases consistently across environments', async () => {
      const aliasName = 'example.com';
      const deployment = 'dep_123';
      const results: any[] = [];

      // Mock the setAlias API method
      mockApiClient.setAlias = vi.fn().mockResolvedValue({
        domain: aliasName,
        deployment: deployment,
        verified: false
      });

      for (const env of ['node', 'browser'] as const) {
        __setTestEnvironment(env);
        const { createAliasResource } = await import('../../src/shared/resources');
        const aliasResource = createAliasResource(() => mockApiClient);

        const result = await aliasResource.set(aliasName, deployment);
        results.push(result);
      }

      // Results should be identical
      expect(results[0]).toEqual(results[1]);
      expect(mockApiClient.setAlias).toHaveBeenCalledTimes(2);
      expect(mockApiClient.setAlias).toHaveBeenCalledWith(aliasName, deployment);
    });
  });

  describe('Account Resource Consistency', () => {
    it('should provide identical account resource interface across environments', async () => {
      const results: any[] = [];

      for (const env of ['node', 'browser'] as const) {
        __setTestEnvironment(env);
        const { createAccountResource } = await import('../../src/shared/resources');
        const accountResource = createAccountResource(() => mockApiClient);

        // Validate interface
        expect(typeof accountResource.get).toBe('function');

        // Test method behavior
        const result = await accountResource.get();
        results.push(result);
      }

      // Results should be identical
      expect(results[0]).toEqual(results[1]);
      expect(results[0]).toEqual({
        email: 'test@example.com',
        plan: 'free',
        usage: {
          deployments: 5,
          storage: 1024000
        }
      });
    });
  });

  describe('Resource Error Handling Consistency', () => {
    it('should handle network errors consistently across all resources', async () => {
      const networkError = new Error('Network timeout');
      mockApiClient.listDeployments.mockRejectedValue(networkError);
      mockApiClient.listAliases.mockRejectedValue(networkError);
      mockApiClient.getAccount.mockRejectedValue(networkError);

      for (const env of ['node', 'browser'] as const) {
        __setTestEnvironment(env);
        
        const { createDeploymentResource, createAliasResource, createAccountResource } = await import('../../src/shared/resources');
        
        const deploymentResource = createDeploymentResource(
          () => mockApiClient,
          {},
          vi.fn().mockResolvedValue(undefined),
          vi.fn()
        );
        const aliasResource = createAliasResource(() => mockApiClient);
        const accountResource = createAccountResource(() => mockApiClient);

        // All should throw the same error
        await expect(deploymentResource.list()).rejects.toThrow('Network timeout');
        await expect(aliasResource.list()).rejects.toThrow('Network timeout');
        await expect(accountResource.get()).rejects.toThrow('Network timeout');
      }
    });

    it('should handle API authentication errors consistently', async () => {
      const authError = new Error('Invalid API key');
      mockApiClient.listDeployments.mockRejectedValue(authError);
      mockApiClient.listAliases.mockRejectedValue(authError);
      mockApiClient.getAccount.mockRejectedValue(authError);

      for (const env of ['node', 'browser'] as const) {
        __setTestEnvironment(env);
        
        const { createDeploymentResource, createAliasResource, createAccountResource } = await import('../../src/shared/resources');
        
        const deploymentResource = createDeploymentResource(
          () => mockApiClient,
          {},
          vi.fn().mockResolvedValue(undefined),
          vi.fn()
        );
        const aliasResource = createAliasResource(() => mockApiClient);
        const accountResource = createAccountResource(() => mockApiClient);

        // All should throw the same error
        await expect(deploymentResource.list()).rejects.toThrow('Invalid API key');
        await expect(aliasResource.list()).rejects.toThrow('Invalid API key');
        await expect(accountResource.get()).rejects.toThrow('Invalid API key');
      }
    });
  });

  describe('Resource Method Signature Consistency', () => {
    it('should maintain consistent method signatures across environments', async () => {
      const methodSignatures: Record<string, any[]> = {};

      for (const env of ['node', 'browser'] as const) {
        __setTestEnvironment(env);
        
        const { createDeploymentResource, createAliasResource, createAccountResource } = await import('../../src/shared/resources');
        
        const deploymentResource = createDeploymentResource(
          () => mockApiClient,
          {},
          vi.fn().mockResolvedValue(undefined),
          vi.fn()
        );
        const aliasResource = createAliasResource(() => mockApiClient);
        const accountResource = createAccountResource(() => mockApiClient);

        methodSignatures[env] = [
          // Deployment methods
          Object.getOwnPropertyNames(deploymentResource).sort(),
          // Alias methods  
          Object.getOwnPropertyNames(aliasResource).sort(),
          // Account methods
          Object.getOwnPropertyNames(accountResource).sort()
        ];
      }

      // Method signatures should be identical
      expect(methodSignatures.node).toEqual(methodSignatures.browser);
    });
  });
});