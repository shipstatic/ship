import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDeploymentResource, type DeploymentResource } from '@/resources';
import type { ApiHttp } from '@/api/http';

// Mock the file processing utilities
vi.mock('@/lib/node-files', () => ({
  processFilesForNode: vi.fn().mockResolvedValue([
    { path: 'index.html', content: Buffer.from('<html></html>'), md5: 'abc123' },
    { path: 'style.css', content: Buffer.from('body {}'), md5: 'def456' }
  ]),
  findNodeCommonParentDirectory: vi.fn().mockReturnValue('/dist')
}));

// Mock the platform config module
vi.mock('@/core/platform-config', () => ({
  getCurrentConfig: vi.fn().mockReturnValue({
    maxFileSize: 10 * 1024 * 1024,
    maxFilesCount: 1000,
    maxTotalSize: 100 * 1024 * 1024
  }),
  setConfig: vi.fn(),
  isConfigInitialized: vi.fn().mockReturnValue(true),
  resetConfig: vi.fn()
}));

describe('DeploymentResource', () => {
  let mockApi: ApiHttp;
  let deployments: DeploymentResource;

  beforeEach(() => {
    // Mock the ApiHttp client with the new methods
    mockApi = {
      deploy: vi.fn(),
      listDeployments: vi.fn(),
      getDeployment: vi.fn(),
      removeDeployment: vi.fn(),
      ping: vi.fn()
    } as unknown as ApiHttp;

    deployments = createDeploymentResource(() => mockApi);
  });

  describe('create', () => {
    it('should deploy files and return Deployment object without config', async () => {
      const mockDeployResponse = {
        deployment: 'pink-elephant-abc123',
        filesCount: 2,
        totalSize: 1024,
        status: 'success',
        hasConfig: false,
        url: 'https://pink-elephant-abc123.statichost.com',
        createdAt: 1234567890,
        expiresAt: 1234567890
      };
      (mockApi.deploy as any).mockResolvedValue(mockDeployResponse);
      
      const result = await deployments.create(['index.html', 'style.css']);
      
      expect(mockApi.deploy).toHaveBeenCalled();
      expect(result).toEqual({
        deployment: 'pink-elephant-abc123',
        filesCount: 2,
        totalSize: 1024,
        status: 'success',
        hasConfig: false,
        url: 'https://pink-elephant-abc123.statichost.com',
        createdAt: 1234567890,
        expiresAt: 1234567890
      });
    });

    it('should deploy files with ship.json and return hasConfig true', async () => {
      const mockDeployResponse = {
        deployment: 'bright-dolphin-def456',
        filesCount: 3,
        totalSize: 2048,
        status: 'success',
        hasConfig: true,
        url: 'https://bright-dolphin-def456.statichost.com',
        createdAt: 1234567890,
        expiresAt: 1234567890
      };
      (mockApi.deploy as any).mockResolvedValue(mockDeployResponse);
      
      const result = await deployments.create(['index.html', 'ship.json', 'style.css']);
      
      expect(mockApi.deploy).toHaveBeenCalled();
      expect(result).toEqual({
        deployment: 'bright-dolphin-def456',
        filesCount: 3,
        totalSize: 2048,
        status: 'success',
        hasConfig: true,
        url: 'https://bright-dolphin-def456.statichost.com',
        createdAt: 1234567890,
        expiresAt: 1234567890
      });
    });
  });

  describe('list', () => {
    it('should call api.listDeployments and return result with hasConfig', async () => {
      const mockResponse = {
        deployments: [
          { deployment: 'pink-elephant-abc123', status: 'success', hasConfig: false, url: 'https://pink-elephant-abc123.statichost.com', filesCount: 2, totalSize: 1024, createdAt: 1234567890 },
          { deployment: 'bright-dolphin-def456', status: 'pending', hasConfig: true, url: 'https://bright-dolphin-def456.statichost.com', filesCount: 3, totalSize: 2048, createdAt: 1234567891 }
        ],
        cursor: null,
        total: 2
      };
      (mockApi.listDeployments as any).mockResolvedValue(mockResponse);
      
      const result = await deployments.list();
      
      expect(mockApi.listDeployments).toHaveBeenCalled();
      expect(result).toEqual(mockResponse);
      expect(result.deployments[0].hasConfig).toBe(false);
      expect(result.deployments[0].url).toBe('https://pink-elephant-abc123.statichost.com');
      expect(result.deployments[1].hasConfig).toBe(true);
      expect(result.deployments[1].url).toBe('https://bright-dolphin-def456.statichost.com');
    });
  });

  describe('get', () => {
    it('should call api.getDeployment with correct parameter and return hasConfig', async () => {
      const mockResponse = { 
        deployment: 'pink-elephant-abc123', 
        status: 'success', 
        hasConfig: true,
        url: 'https://pink-elephant-abc123.statichost.com',
        filesCount: 5,
        totalSize: 4096,
        createdAt: 1234567890,
        expiresAt: 1234567890
      };
      (mockApi.getDeployment as any).mockResolvedValue(mockResponse);
      
      const result = await deployments.get('abc123');
      
      expect(mockApi.getDeployment).toHaveBeenCalledWith('abc123');
      expect(result).toEqual(mockResponse);
      expect(result.hasConfig).toBe(true);
    });
  });

  describe('remove', () => {
    it('should call api.removeDeployment with correct parameter and return void', async () => {
      const mockResponse = { message: 'Deployment removed' };
      (mockApi.removeDeployment as any).mockResolvedValue(mockResponse);
      
      const result = await deployments.remove('abc123');
      
      expect(mockApi.removeDeployment).toHaveBeenCalledWith('abc123');
      expect(result).toBeUndefined();
    });

    it('should propagate error when deployment has active aliases', async () => {
      const { ShipError } = await import('@shipstatic/types');
      const aliasError = ShipError.business('Cannot delete deployment with active aliases.', 409);
      (mockApi.removeDeployment as any).mockRejectedValue(aliasError);
      
      await expect(deployments.remove('abc123')).rejects.toThrow('Cannot delete deployment with active aliases.');
      expect(mockApi.removeDeployment).toHaveBeenCalledWith('abc123');
    });
  });

  describe('integration', () => {
    it('should create deployment resource with API client', () => {
      expect(deployments).toBeDefined();
      expect(typeof deployments.create).toBe('function');
      expect(typeof deployments.list).toBe('function');
      expect(typeof deployments.get).toBe('function');
      expect(typeof deployments.remove).toBe('function');
    });

    it('should return promises from all methods', () => {
      (mockApi.deploy as any).mockResolvedValue({});
      (mockApi.listDeployments as any).mockResolvedValue({});
      (mockApi.getDeployment as any).mockResolvedValue({});
      (mockApi.removeDeployment as any).mockResolvedValue({});

      expect(deployments.create(['package.json'])).toBeInstanceOf(Promise);
      expect(deployments.list()).toBeInstanceOf(Promise);
      expect(deployments.get('test')).toBeInstanceOf(Promise);
      expect(deployments.remove('test')).toBeInstanceOf(Promise);
    });
  });
});