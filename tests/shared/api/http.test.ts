import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiHttp } from '../../../src/shared/api/http';
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
    getAuthHeaders: () => ({ 'Authorization': 'Bearer test-api-key' })
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
      const api = new ApiHttp({
        apiUrl: 'https://test.com',
        getAuthHeaders: () => ({})
      });
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
        files: 1,
        size: 13
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
        files: 1,
        size: 13
      });
    });

    it('should deploy files array with tags', async () => {
      const mockFiles = [
        { path: 'index.html', content: Buffer.from('<html></html>'), md5: 'abc123', size: 13 }
      ];
      const tags = ['production', 'v1.0.0'];
      (global.fetch as any).mockResolvedValue(createMockResponse({
        deployment: 'test-deployment',
        files: 1,
        size: 13,
        tags: tags
      }));

      const result = await apiHttp.deploy(mockFiles, { tags });

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
        files: 1,
        size: 13,
        tags: tags
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

  describe('checkSPA', () => {
    it('should return false when no index.html file present', async () => {
      const mockFiles = [
        { path: 'main', content: Buffer.from('console.log("hello")'), md5: 'abc123', size: 20 },
        { path: 'style.css', content: Buffer.from('body {}'), md5: 'def456', size: 7 }
      ];

      const result = await apiHttp.checkSPA(mockFiles);
      
      expect(result).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should return false when index.html is too large', async () => {
      const largeContent = Buffer.alloc(150 * 1024, 'x'); // 150KB
      const mockFiles = [
        { path: 'index.html', content: largeContent, md5: 'abc123', size: largeContent.length }
      ];

      const result = await apiHttp.checkSPA(mockFiles);
      
      expect(result).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should return false when index.html content type is unsupported', async () => {
      const mockFiles = [
        { path: 'index.html', content: 123 as any, md5: 'abc123', size: 50 } // Invalid content type
      ];

      const result = await apiHttp.checkSPA(mockFiles);
      
      expect(result).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should make API request with Buffer content', async () => {
      const indexContent = '<html><head><script src="app.js"></script></head></html>';
      const mockFiles = [
        { path: 'index.html', content: Buffer.from(indexContent), md5: 'abc123', size: indexContent.length },
        { path: 'app', content: Buffer.from('app code'), md5: 'def456', size: 8 }
      ];
      (global.fetch as any).mockResolvedValue(createMockResponse({ isSPA: true }));

      const result = await apiHttp.checkSPA(mockFiles);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/spa-check',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({
            files: ['index.html', 'app'],
            index: indexContent
          })
        })
      );
      expect(result).toBe(true);
    });

    it('should return false for unsupported content types (simulating Blob failure)', async () => {
      // Test that when content type is not Buffer and browser objects fail, we return false
      const mockFiles = [
        { path: 'index.html', content: { someObject: true } as any, md5: 'abc123', size: 50 }
      ];

      const result = await apiHttp.checkSPA(mockFiles);
      
      expect(result).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should handle different index.html path formats', async () => {
      const indexContent = '<html></html>';
      const mockFiles = [
        { path: '/index.html', content: Buffer.from(indexContent), md5: 'abc123', size: indexContent.length } // Leading slash
      ];
      (global.fetch as any).mockResolvedValue(createMockResponse({ isSPA: true }));

      const result = await apiHttp.checkSPA(mockFiles);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/spa-check',
        expect.objectContaining({
          body: JSON.stringify({
            files: ['/index.html'],
            index: indexContent
          })
        })
      );
      expect(result).toBe(true);
    });

    it('should handle API errors gracefully', async () => {
      const indexContent = '<html></html>';
      const mockFiles = [
        { path: 'index.html', content: Buffer.from(indexContent), md5: 'abc123', size: indexContent.length }
      ];
      (global.fetch as any).mockResolvedValue(createMockResponse({ error: 'Service unavailable' }, 503));

      await expect(apiHttp.checkSPA(mockFiles)).rejects.toThrow();
    });

    it('should send file paths in correct order', async () => {
      const indexContent = '<html></html>';
      const mockFiles = [
        { path: 'components/App', content: Buffer.from('app'), md5: 'abc', size: 3 },
        { path: 'index.html', content: Buffer.from(indexContent), md5: 'def', size: indexContent.length },
        { path: 'assets/style.css', content: Buffer.from('css'), md5: 'ghi', size: 3 }
      ];
      (global.fetch as any).mockResolvedValue(createMockResponse({ isSPA: true }));

      await apiHttp.checkSPA(mockFiles);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/spa-check',
        expect.objectContaining({
          body: JSON.stringify({
            files: ['components/App', 'index.html', 'assets/style.css'],
            index: indexContent
          })
        })
      );
    });
  });

  describe('domain operations', () => {
    it('should set domain (update - 200 status)', async () => {
      const mockDomain = { domain: 'staging', deployment: 'test-deployment' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDomain, 200));

      const result = await apiHttp.setDomain('staging', 'test-deployment');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains/staging',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({ deployment: 'test-deployment' })
        })
      );
      expect(result).toEqual({ ...mockDomain, isCreate: false });
    });

    it('should set domain (create - 201 status)', async () => {
      const mockDomain = { domain: 'new-domain', deployment: 'test-deployment' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDomain, 201));

      const result = await apiHttp.setDomain('new-domain', 'test-deployment');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains/new-domain',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({ deployment: 'test-deployment' })
        })
      );
      expect(result).toEqual({ ...mockDomain, isCreate: true });
    });

    it('should set domain with tags', async () => {
      const tags = ['production', 'v2.0.0'];
      const mockDomain = { domain: 'prod', deployment: 'test-deployment', tags };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDomain, 201));

      const result = await apiHttp.setDomain('prod', 'test-deployment', tags);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains/prod',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({ deployment: 'test-deployment', tags })
        })
      );
      expect(result).toEqual({ ...mockDomain, isCreate: true });
    });

    it('should get domain', async () => {
      const mockDomain = { domain: 'staging', deployment: 'test-deployment' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDomain));

      const result = await apiHttp.getDomain('staging');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains/staging',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
      expect(result).toEqual(mockDomain);
    });

    it('should list domains', async () => {
      const mockDomains = {
        domains: [
          { domain: 'staging', deployment: 'test-1' },
          { domain: 'production', deployment: 'test-2' }
        ]
      };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDomains));

      const result = await apiHttp.listDomains();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
      expect(result).toEqual(mockDomains);
    });

    it('should remove domain', async () => {
      (global.fetch as any).mockResolvedValue(createMockResponse(undefined, 204));

      const result = await apiHttp.removeDomain('staging');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/domains/staging',
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

  describe('Cookie-based Authentication', () => {
    let apiHttpNoCredentials: ApiHttp;

    beforeEach(() => {
      vi.clearAllMocks();
      // Create ApiHttp instance with callback that returns no auth headers
      apiHttpNoCredentials = new ApiHttp({
        apiUrl: 'https://api.test.com',
        getAuthHeaders: () => ({}) // No auth headers - should use cookies
      });
    });

    it('should include credentials when no Authorization header is returned', async () => {
      (global.fetch as any).mockResolvedValue(createMockResponse({ success: true, message: 'pong' }));

      await apiHttpNoCredentials.ping();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/ping',
        expect.objectContaining({
          method: 'GET',
          credentials: 'include',
          headers: expect.not.objectContaining({
            'Authorization': expect.any(String)
          })
        })
      );
    });

    it('should NOT include credentials when Authorization header is returned', async () => {
      const apiHttpWithKey = new ApiHttp({
        apiUrl: 'https://api.test.com',
        getAuthHeaders: () => ({ 'Authorization': 'Bearer test-key' })
      });
      (global.fetch as any).mockResolvedValue(createMockResponse({ success: true, message: 'pong' }));

      await apiHttpWithKey.ping();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/ping',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-key'
          })
        })
      );

      // Ensure credentials is NOT set when we have an Authorization header
      const fetchCall = (fetch as any).mock.calls[0][1];
      expect(fetchCall.credentials).toBeUndefined();
    });

    it('should support deploy tokens via callback', async () => {
      const apiHttpWithToken = new ApiHttp({
        apiUrl: 'https://api.test.com',
        getAuthHeaders: () => ({ 'Authorization': 'Bearer test-token' })
      });
      (global.fetch as any).mockResolvedValue(createMockResponse({ success: true, message: 'pong' }));

      await apiHttpWithToken.ping();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/ping',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token'
          })
        })
      );

      // Ensure credentials is NOT set when we have a deployToken
      const fetchCall = (fetch as any).mock.calls[0][1];
      expect(fetchCall.credentials).toBeUndefined();
    });

    it('should use cookies for account operations when no credentials provided', async () => {
      const mockAccount = { account: 'user123', name: 'Test User', email: 'test@example.com' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockAccount));

      const result = await apiHttpNoCredentials.getAccount();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/account',
        expect.objectContaining({
          method: 'GET',
          credentials: 'include',
          headers: expect.not.objectContaining({
            'Authorization': expect.any(String)
          })
        })
      );
      expect(result).toEqual(mockAccount);
    });

    it('should use cookies for deployment operations when no credentials provided', async () => {
      const mockDeployment = { deployment: 'dep123', url: 'https://example.com' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDeployment));

      const mockFiles = [
        { path: 'index.html', content: Buffer.from('<html></html>'), md5: 'abc123', size: 13 }
      ];

      const result = await apiHttpNoCredentials.deploy(mockFiles, {});

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/deployments',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: expect.not.objectContaining({
            'Authorization': expect.any(String)
          })
        })
      );
      expect(result).toEqual(mockDeployment);
    });

    it('should prioritize explicit credentials over cookies', async () => {
      // Test that even if we start with no credentials (cookie mode)
      // but then provide explicit credentials for a specific operation,
      // the explicit credentials take precedence
      const mockDeployment = { deployment: 'dep123', url: 'https://example.com' };
      (global.fetch as any).mockResolvedValue(createMockResponse(mockDeployment));

      const mockFiles = [
        { path: 'index.html', content: Buffer.from('<html></html>'), md5: 'abc123', size: 13 }
      ];

      // Pass explicit apiKey in the deploy options
      const result = await apiHttpNoCredentials.deploy(mockFiles, { 
        apiKey: 'explicit-key'
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/deployments',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer explicit-key'
          })
        })
      );
      
      // When explicit credentials are provided, credentials should NOT be 'include'
      const fetchCall = (fetch as any).mock.calls[0][1];
      expect(fetchCall.credentials).toBeUndefined();
      expect(result).toEqual(mockDeployment);
    });
  });
});