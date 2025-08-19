import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDeploymentResource, type DeploymentResource } from '../../../src/shared/resources';
import type { ApiHttp } from '../../../src/shared/api/http';
import type { StaticFile, DeploymentOptions } from '../../../src/shared/types';
import { ShipError, DEPLOYMENT_CONFIG_FILENAME } from '@shipstatic/types';

// Mock the shared SPA detection
vi.mock('../../../src/shared/lib/prepare-input', () => ({
  detectAndConfigureSPA: vi.fn((files, apiClient, options) => {
    // Simple mock that adds SPA config if not present and spaDetect is true
    if (options.spaDetect !== false && !files.some((f: any) => f.path === DEPLOYMENT_CONFIG_FILENAME)) {
      return Promise.resolve([
        ...files,
        {
          path: DEPLOYMENT_CONFIG_FILENAME,
          content: Buffer.from('{"rewrites":[{"source":"/(.*)", "destination":"/index.html"}]}'),
          size: 100,
          md5: 'spa-config-hash'
        }
      ]);
    }
    return Promise.resolve(files);
  })
}));

describe('Deployment Resource (Unified Architecture)', () => {
  let mockApiHttp: ApiHttp;
  let mockProcessInput: vi.Mock;
  let deploymentResource: DeploymentResource;
  let mockEnsureInit: vi.Mock;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock API client
    mockApiHttp = {
      deploy: vi.fn().mockResolvedValue({
        id: 'dep_123',
        url: 'https://dep_123.shipstatic.dev',
        files: []
      }),
      ping: vi.fn().mockResolvedValue(true),
      checkSPA: vi.fn().mockResolvedValue(false)
    } as any;

    // Mock processInput function (environment-specific)
    mockProcessInput = vi.fn().mockResolvedValue([
      { path: 'index.html', content: Buffer.from('<html></html>'), size: 13, md5: 'abc123' },
      { path: 'style.css', content: Buffer.from('body {}'), size: 7, md5: 'def456' }
    ]);

    // Mock initialization
    mockEnsureInit = vi.fn().mockResolvedValue(undefined);

    // Create deployment resource with mocks
    deploymentResource = createDeploymentResource(
      () => mockApiHttp,
      undefined, // no client defaults
      mockEnsureInit,
      mockProcessInput
    );
  });

  describe('create', () => {
    it('should process input and deploy files through unified pipeline', async () => {
      const mockInput = ['./dist'];
      const options: DeploymentOptions = {};

      const result = await deploymentResource.create(mockInput as any, options);

      // Verify the pipeline executed correctly
      expect(mockEnsureInit).toHaveBeenCalled();
      expect(mockProcessInput).toHaveBeenCalledWith(mockInput, options);
      expect(mockApiHttp.deploy).toHaveBeenCalled();
      expect(result).toEqual({
        id: 'dep_123',
        url: 'https://dep_123.shipstatic.dev',
        files: []
      });
    });

    it('should apply SPA detection universally in shared resource', async () => {
      const mockInput = ['./dist'];
      const options: DeploymentOptions = { spaDetect: true };

      await deploymentResource.create(mockInput as any, options);

      // Verify SPA detection was applied (through our mock)
      const deployCallArgs = (mockApiHttp.deploy as any).mock.calls[0];
      const processedFiles = deployCallArgs[0];
      
      // Should include the SPA config file added by detectAndConfigureSPA
      expect(processedFiles).toHaveLength(3); // 2 original + 1 SPA config
      expect(processedFiles.some((f: any) => f.path === DEPLOYMENT_CONFIG_FILENAME)).toBe(true);
    });

    it('should handle processInput function not provided', async () => {
      const brokenResource = createDeploymentResource(
        () => mockApiHttp,
        undefined,
        mockEnsureInit,
        undefined // No processInput function
      );

      await expect(brokenResource.create(['./dist'] as any, {}))
        .rejects.toThrow('processInput function is not provided.');
    });

    it('should merge client defaults with options', async () => {
      const clientDefaults = { timeout: 5000, maxConcurrency: 3 };
      const resourceWithDefaults = createDeploymentResource(
        () => mockApiHttp,
        clientDefaults,
        mockEnsureInit,
        mockProcessInput
      );

      const options = { timeout: 10000 }; // Override timeout
      await resourceWithDefaults.create(['./dist'] as any, options);

      // Verify mergedOptions were passed to processInput
      const processInputCall = mockProcessInput.mock.calls[0];
      const mergedOptions = processInputCall[1];
      expect(mergedOptions.timeout).toBe(10000); // User option takes precedence
      expect(mergedOptions.maxConcurrency).toBe(3); // Default is used
    });
  });

  describe('list', () => {
    it('should call API listDeployments after initialization', async () => {
      const mockList = { deployments: [], count: 0 };
      mockApiHttp.listDeployments = vi.fn().mockResolvedValue(mockList);

      const result = await deploymentResource.list();

      expect(mockEnsureInit).toHaveBeenCalled();
      expect(mockApiHttp.listDeployments).toHaveBeenCalled();
      expect(result).toEqual(mockList);
    });
  });

  describe('get', () => {
    it('should call API getDeployment after initialization', async () => {
      const mockDeployment = { id: 'dep_123', url: 'https://example.com' };
      mockApiHttp.getDeployment = vi.fn().mockResolvedValue(mockDeployment);

      const result = await deploymentResource.get('dep_123');

      expect(mockEnsureInit).toHaveBeenCalled();
      expect(mockApiHttp.getDeployment).toHaveBeenCalledWith('dep_123');
      expect(result).toEqual(mockDeployment);
    });
  });

  describe('remove', () => {
    it('should call API removeDeployment after initialization', async () => {
      mockApiHttp.removeDeployment = vi.fn().mockResolvedValue(undefined);

      await deploymentResource.remove('dep_123');

      expect(mockEnsureInit).toHaveBeenCalled();
      expect(mockApiHttp.removeDeployment).toHaveBeenCalledWith('dep_123');
    });
  });
});