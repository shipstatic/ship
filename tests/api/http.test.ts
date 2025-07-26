import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiHttp } from '@/api/http';
import { ShipError } from '@shipstatic/types';

// Mock fetch globally
global.fetch = vi.fn();

// Helper function to create standardized mock responses
function createMockResponse(data: any, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: {
      get: vi.fn().mockImplementation((header: string) => {
        if (header === 'Content-Length') {
          return status === 204 || data === undefined ? '0' : '15';
        }
        return '15';
      })
    },
    json: async () => data
  };
}

describe('ApiHttp', () => {
  let apiHttp: ApiHttp;
  const mockOptions = {
    apiUrl: 'https://api.test.com',
    apiKey: 'test-api-key',
    timeout: 5000
  };

  beforeEach(() => {
    vi.clearAllMocks();
    apiHttp = new ApiHttp(mockOptions);
  });

  describe('constructor', () => {
    it('should initialize with provided options', () => {
      const api = new ApiHttp(mockOptions);
      expect(api).toBeDefined();
    });

    it('should work with minimal options', () => {
      const api = new ApiHttp({ apiUrl: 'https://test.com' });
      expect(api).toBeDefined();
    });
  });

  describe('ping', () => {
    it('should make GET request to /ping endpoint', async () => {
      (global.fetch as any).mockResolvedValue(createMockResponse({ success: true, message: 'pong' }));

      const result = await apiHttp.ping();
      
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/ping',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
      expect(result).toBe(true);
    });

    it('should handle network errors', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      await expect(apiHttp.ping()).rejects.toThrow('Network error');
    });

    it('should handle API errors', async () => {
      (global.fetch as any).mockResolvedValue(createMockResponse({ error: 'Internal server error' }, 500));

      await expect(apiHttp.ping()).rejects.toThrow();
    });
  });

  describe('getPingResponse', () => {
    it('should return full PingResponse object', async () => {
      const mockResponse = { success: true, timestamp: 1753379248270 };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockResponse));

      const result = await apiHttp.getPingResponse();
      
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/ping',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should handle network errors', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      await expect(apiHttp.getPingResponse()).rejects.toThrow('Network error');
    });
  });

  describe('getConfig', () => {
    it('should fetch platform configuration', async () => {
      const mockConfig = {
        maxFileSize: 10 * 1024 * 1024,
        maxFilesCount: 1000,
        maxTotalSize: 100 * 1024 * 1024
      };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockConfig));

      const result = await apiHttp.getConfig();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/config',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
      expect(result).toEqual(mockConfig);
    });
  });

  describe('deploy', () => {
    it('should deploy files array', async () => {
      const mockFiles = [
        { path: 'index.html', content: Buffer.from('<html></html>'), md5: 'abc123', size: 13 }
      ];
      (global.fetch as any).mockResolvedValue(createMockResponse({ 
        deployment: 'test-deployment',
        filesCount: 1,
        totalSize: 13
      }));

      const result = await apiHttp.deploy(mockFiles);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/deployments',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
      expect(result).toEqual({
        deployment: 'test-deployment',
        filesCount: 1,
        totalSize: 13
      });
    });

    it('should handle empty files array', async () => {
      await expect(apiHttp.deploy([])).rejects.toThrow('No files to deploy');
    });
  });

  describe('listDeployments', () => {
    it('should list deployments', async () => {
      const mockDeployments = {
        deployments: [
          { deployment: 'test-1', status: 'success' },
          { deployment: 'test-2', status: 'pending' }
        ]
      };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDeployments));

      const result = await apiHttp.listDeployments();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/deployments',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
      expect(result).toEqual(mockDeployments);
    });
  });

  describe('getDeployment', () => {
    it('should get specific deployment', async () => {
      const mockDeployment = { deployment: 'test-deployment', status: 'success' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDeployment));

      const result = await apiHttp.getDeployment('test-deployment');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/deployments/test-deployment',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
      expect(result).toEqual(mockDeployment);
    });
  });

  describe('removeDeployment', () => {
    it('should remove deployment', async () => {
      (global.fetch as any).mockResolvedValue(createMockResponse(undefined, 204));

      const result = await apiHttp.removeDeployment('test-deployment');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/deployments/test-deployment',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
      expect(result).toBeUndefined();
    });
  });

  describe('getAccount', () => {
    it('should get account information', async () => {
      const mockAccount = { account: 'test-account', email: 'test@example.com' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockAccount));

      const result = await apiHttp.getAccount();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/account',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
      expect(result).toEqual(mockAccount);
    });
  });

  describe('createApiKey', () => {
    it('should create new API key', async () => {
      const mockApiKey = { apiKey: 'ship-new-key-123' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockApiKey));

      const result = await apiHttp.createApiKey();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/key',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
      expect(result).toEqual(mockApiKey);
    });
  });

  describe('alias operations', () => {
    it('should set alias (update - 200 status)', async () => {
      const mockAlias = { alias: 'staging', deployment: 'test-deployment' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockAlias, 200));

      const result = await apiHttp.setAlias('staging', 'test-deployment');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/aliases/staging',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({ deploymentId: 'test-deployment' })
        })
      );
      expect(result).toEqual({ ...mockAlias, isCreate: false });
    });

    it('should set alias (create - 201 status)', async () => {
      const mockAlias = { alias: 'new-alias', deployment: 'test-deployment' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockAlias, 201));

      const result = await apiHttp.setAlias('new-alias', 'test-deployment');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/aliases/new-alias',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({ deploymentId: 'test-deployment' })
        })
      );
      expect(result).toEqual({ ...mockAlias, isCreate: true });
    });

    it('should get alias', async () => {
      const mockAlias = { alias: 'staging', deployment: 'test-deployment' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockAlias));

      const result = await apiHttp.getAlias('staging');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/aliases/staging',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
      expect(result).toEqual(mockAlias);
    });

    it('should list aliases', async () => {
      const mockAliases = {
        aliases: [
          { alias: 'staging', deployment: 'test-1' },
          { alias: 'production', deployment: 'test-2' }
        ]
      };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockAliases));

      const result = await apiHttp.listAliases();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/aliases',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
      expect(result).toEqual(mockAliases);
    });

    it('should remove alias', async () => {
      (global.fetch as any).mockResolvedValue(createMockResponse(undefined, 204));

      const result = await apiHttp.removeAlias('staging');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/aliases/staging',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
      expect(result).toBeUndefined();
    });
  });
});