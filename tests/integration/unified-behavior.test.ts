import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __setTestEnvironment } from '../../src/shared/lib/env';
import { detectAndConfigureSPA, createSPAConfig } from '../../src/shared/lib/prepare-input';
import { createDeploymentResource } from '../../src/shared/resources';
import { DEPLOYMENT_CONFIG_FILENAME } from '@shipstatic/types';
import type { StaticFile, DeploymentOptions } from '../../src/shared/types';

// Mock MD5 for consistent testing
vi.mock('../../src/shared/lib/md5', () => ({
  calculateMD5: vi.fn().mockResolvedValue({ md5: 'consistent-hash' })
}));

describe('Cross-Environment Integration - Unified Behavior', () => {
  let mockApiClient: any;
  let mockFiles: StaticFile[];

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockApiClient = {
      checkSPA: vi.fn(),
      deploy: vi.fn().mockResolvedValue({
        id: 'integration_test',
        url: 'https://integration_test.shipstatic.dev'
      })
    };

    mockFiles = [
      {
        path: 'index.html',
        content: Buffer.from('<html><script src="app.js"></script></html>'),
        size: 43,
        md5: 'html-hash'
      },
      {
        path: 'app',
        content: Buffer.from('console.log("SPA app");'),
        size: 22,
        md5: 'js-hash'
      }
    ];
  });

  describe('SPA Detection Unified Pipeline', () => {
    it('should apply SPA detection consistently regardless of environment', async () => {
      mockApiClient.checkSPA.mockResolvedValue(true);

      // Test that SPA detection works the same way for any environment
      const options: DeploymentOptions = { spaDetect: true };
      const result = await detectAndConfigureSPA(mockFiles, mockApiClient, options);

      expect(result).toHaveLength(3); // 2 original + 1 SPA config
      expect(result[2].path).toBe(DEPLOYMENT_CONFIG_FILENAME);
      
      // Verify SPA config content is consistent
      const spaConfigContent = JSON.parse(result[2].content.toString());
      expect(spaConfigContent).toEqual({
        rewrites: [{
          source: "/(.*)",
          destination: "/index.html"
        }]
      });
    });

    it('should create identical SPA config across environments', async () => {
      // Test in Node.js environment
      __setTestEnvironment('node');
      const nodeSpaConfig = await createSPAConfig();

      // Test in browser environment
      __setTestEnvironment('browser');
      const browserSpaConfig = await createSPAConfig();

      // Test in unknown environment
      __setTestEnvironment('unknown');
      const unknownSpaConfig = await createSPAConfig();

      // All should be identical
      expect(nodeSpaConfig.path).toBe(browserSpaConfig.path);
      expect(nodeSpaConfig.path).toBe(unknownSpaConfig.path);
      expect(nodeSpaConfig.content.toString()).toBe(browserSpaConfig.content.toString());
      expect(nodeSpaConfig.content.toString()).toBe(unknownSpaConfig.content.toString());
      expect(nodeSpaConfig.size).toBe(browserSpaConfig.size);
      expect(nodeSpaConfig.size).toBe(unknownSpaConfig.size);
    });

    it('should skip SPA detection consistently when disabled', async () => {
      const options: DeploymentOptions = { spaDetect: false };
      const result = await detectAndConfigureSPA(mockFiles, mockApiClient, options);

      expect(mockApiClient.checkSPA).not.toHaveBeenCalled();
      expect(result).toEqual(mockFiles); // Unchanged
    });

    it('should skip SPA detection when ship.json already exists', async () => {
      const filesWithConfig = [
        ...mockFiles,
        {
          path: DEPLOYMENT_CONFIG_FILENAME,
          content: Buffer.from('{"custom": "config"}'),
          size: 19,
          md5: 'config-hash'
        }
      ];

      const result = await detectAndConfigureSPA(filesWithConfig, mockApiClient, { spaDetect: true });

      expect(mockApiClient.checkSPA).not.toHaveBeenCalled();
      expect(result).toEqual(filesWithConfig); // Unchanged
    });
  });

  describe('Deployment Resource Unified Pipeline', () => {
    it('should apply SPA detection in deployment resource for all environments', async () => {
      // Mock processInput functions for different environments
      const nodeProcessInput = vi.fn().mockResolvedValue(mockFiles);
      const browserProcessInput = vi.fn().mockResolvedValue(mockFiles);

      mockApiClient.checkSPA.mockResolvedValue(true);

      // Test Node.js deployment resource
      const nodeResource = createDeploymentResource(
        () => mockApiClient,
        {},
        vi.fn(),
        nodeProcessInput
      );

      const nodeResult = await nodeResource.create(['./dist'] as any, { spaDetect: true });

      // Test browser deployment resource
      const browserResource = createDeploymentResource(
        () => mockApiClient,
        {},
        vi.fn(),
        browserProcessInput
      );

      const mockFileList = {} as FileList;
      const browserResult = await browserResource.create(mockFileList, { spaDetect: true });

      // Both should have called SPA detection
      expect(mockApiClient.checkSPA).toHaveBeenCalledTimes(2);
      
      // Both should have deployed files with SPA config
      const nodeDeployedFiles = mockApiClient.deploy.mock.calls[0][0];
      const browserDeployedFiles = mockApiClient.deploy.mock.calls[1][0];
      
      expect(nodeDeployedFiles).toHaveLength(3); // 2 + SPA config
      expect(browserDeployedFiles).toHaveLength(3); // 2 + SPA config
      
      expect(nodeDeployedFiles.some((f: any) => f.path === DEPLOYMENT_CONFIG_FILENAME)).toBe(true);
      expect(browserDeployedFiles.some((f: any) => f.path === DEPLOYMENT_CONFIG_FILENAME)).toBe(true);
    });

    it('should handle API errors consistently across environments', async () => {
      mockApiClient.checkSPA.mockRejectedValue(new Error('API Error'));
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const nodeProcessInput = vi.fn().mockResolvedValue(mockFiles);
      const nodeResource = createDeploymentResource(
        () => mockApiClient,
        {},
        vi.fn(),
        nodeProcessInput
      );

      await nodeResource.create(['./dist'] as any, { spaDetect: true });

      expect(consoleSpy).toHaveBeenCalledWith('SPA detection failed, continuing without auto-config');
      
      // Should still deploy original files
      const deployedFiles = mockApiClient.deploy.mock.calls[0][0];
      expect(deployedFiles).toEqual(mockFiles); // Original files, no SPA config added

      consoleSpy.mockRestore();
    });
  });

  describe('Configuration Merging Consistency', () => {
    it('should merge options consistently across environments', async () => {
      const clientDefaults = { timeout: 5000, maxConcurrency: 3 };
      const userOptions = { timeout: 10000, spaDetect: false };

      const mockProcessInput = vi.fn().mockResolvedValue(mockFiles);
      const resource = createDeploymentResource(
        () => mockApiClient,
        clientDefaults,
        vi.fn(),
        mockProcessInput
      );

      await resource.create(['./test'] as any, userOptions);

      // Verify merged options were passed to processInput
      const passedOptions = mockProcessInput.mock.calls[0][1];
      expect(passedOptions.timeout).toBe(10000); // User option wins
      expect(passedOptions.maxConcurrency).toBe(3); // Default used
      expect(passedOptions.spaDetect).toBe(false); // User option wins
    });
  });

  describe('Error Handling Consistency', () => {
    it('should handle missing processInput function consistently', async () => {
      const resource = createDeploymentResource(
        () => mockApiClient,
        {},
        vi.fn(),
        undefined // No processInput function
      );

      await expect(resource.create(['./test'] as any, {}))
        .rejects.toThrow('processInput function is not provided.');
    });
  });

  describe('Resource Interface Consistency', () => {
    it('should provide identical resource interfaces across environments', () => {
      const nodeProcessInput = vi.fn();
      const browserProcessInput = vi.fn();

      const nodeResource = createDeploymentResource(() => mockApiClient, {}, vi.fn(), nodeProcessInput);
      const browserResource = createDeploymentResource(() => mockApiClient, {}, vi.fn(), browserProcessInput);

      // Both should have identical interfaces
      expect(Object.keys(nodeResource)).toEqual(Object.keys(browserResource));
      expect(typeof nodeResource.create).toBe('function');
      expect(typeof nodeResource.list).toBe('function');
      expect(typeof nodeResource.get).toBe('function');
      expect(typeof nodeResource.remove).toBe('function');
      
      expect(typeof browserResource.create).toBe('function');
      expect(typeof browserResource.list).toBe('function');
      expect(typeof browserResource.get).toBe('function');
      expect(typeof browserResource.remove).toBe('function');
    });
  });
});