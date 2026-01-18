import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSPAConfig, detectAndConfigureSPA } from '../../../src/shared/lib/spa';
import { ShipError, DEPLOYMENT_CONFIG_FILENAME } from '@shipstatic/types';
import type { StaticFile, DeploymentOptions } from '../../../src/shared/types';

// Mock the MD5 calculation
vi.mock('../../../src/shared/lib/md5', () => ({
  calculateMD5: vi.fn().mockResolvedValue({ md5: 'mock-md5-hash' })
}));

describe('SPA Detection (spa.ts)', () => {
  describe('createSPAConfig', () => {
    it('should create a valid SPA configuration file', async () => {
      const spaConfig = await createSPAConfig();

      expect(spaConfig.path).toBe(DEPLOYMENT_CONFIG_FILENAME);
      expect(spaConfig.md5).toBe('mock-md5-hash');
      expect(spaConfig.size).toBeGreaterThan(0);

      // Parse the content to verify it's valid JSON with the right structure
      const content = JSON.parse(spaConfig.content.toString());
      expect(content).toEqual({
        rewrites: [{
          source: "/(.*)",
          destination: "/index.html"
        }]
      });
    });
  });

  describe('detectAndConfigureSPA', () => {
    let mockApiClient: any;
    let mockFiles: StaticFile[];
    let options: DeploymentOptions;

    beforeEach(() => {
      mockApiClient = {
        checkSPA: vi.fn()
      };

      mockFiles = [
        {
          path: 'index.html',
          content: Buffer.from('<html><body>Test</body></html>'),
          size: 100,
          md5: 'test-hash'
        }
      ];

      options = { spaDetect: true };

      // Reset mocks
      vi.clearAllMocks();
    });

    it('should skip SPA detection when disabled', async () => {
      options.spaDetect = false;

      const result = await detectAndConfigureSPA(mockFiles, mockApiClient, options);

      expect(mockApiClient.checkSPA).not.toHaveBeenCalled();
      expect(result).toEqual(mockFiles);
    });

    it('should skip SPA detection when ship.json already exists', async () => {
      const filesWithConfig = [
        ...mockFiles,
        {
          path: DEPLOYMENT_CONFIG_FILENAME,
          content: Buffer.from('{}'),
          size: 2,
          md5: 'config-hash'
        }
      ];

      const result = await detectAndConfigureSPA(filesWithConfig, mockApiClient, options);

      expect(mockApiClient.checkSPA).not.toHaveBeenCalled();
      expect(result).toEqual(filesWithConfig);
    });

    it('should add SPA config when SPA is detected', async () => {
      mockApiClient.checkSPA.mockResolvedValue(true);

      const result = await detectAndConfigureSPA(mockFiles, mockApiClient, options);

      expect(mockApiClient.checkSPA).toHaveBeenCalledWith(mockFiles);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(mockFiles[0]);
      expect(result[1].path).toBe(DEPLOYMENT_CONFIG_FILENAME);
    });

    it('should not add SPA config when SPA is not detected', async () => {
      mockApiClient.checkSPA.mockResolvedValue(false);

      const result = await detectAndConfigureSPA(mockFiles, mockApiClient, options);

      expect(mockApiClient.checkSPA).toHaveBeenCalledWith(mockFiles);
      expect(result).toEqual(mockFiles);
    });

    it('should handle SPA detection API errors gracefully', async () => {
      mockApiClient.checkSPA.mockRejectedValue(new Error('API Error'));

      const result = await detectAndConfigureSPA(mockFiles, mockApiClient, options);

      expect(result).toEqual(mockFiles);
    });
  });
});
