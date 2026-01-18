import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDomainResource, type DomainResource } from '../../../src/shared/resources';
import type { ApiHttp } from '../../../src/shared/api/http';

describe('DomainResource', () => {
  let mockApi: ApiHttp;
  let domains: DomainResource;

  beforeEach(() => {
    // Mock the ApiHttp client
    mockApi = {
      setDomain: vi.fn(),
      getDomain: vi.fn(),
      listDomains: vi.fn(),
      removeDomain: vi.fn(),
      verifyDomain: vi.fn(),
      deploy: vi.fn(),
      ping: vi.fn()
    } as unknown as ApiHttp;

    domains = createDomainResource({ getApi: () => mockApi, ensureInit: async () => {} });
  });

  describe('set', () => {
    it('should call api.setDomain and return the domain directly (no double API call)', async () => {
      const mockSetResponse = { domain: 'staging', deployment: 'abc123', url: 'https://staging.statichost.dev', isCreate: true };
      (mockApi.setDomain as any).mockResolvedValue(mockSetResponse);

      const result = await domains.set('staging', 'abc123');

      expect(mockApi.setDomain).toHaveBeenCalledWith('staging', 'abc123', undefined);
      expect(mockApi.getDomain).not.toHaveBeenCalled(); // Should NOT make a second API call
      expect(result).toEqual(mockSetResponse);
    });

    it('should handle different deployment and domain combinations', async () => {
      const mockSetResponse = { domain: 'production', deployment: 'def456', url: 'https://production.statichost.dev', isCreate: false };
      (mockApi.setDomain as any).mockResolvedValue(mockSetResponse);

      const result = await domains.set('production', 'def456');

      expect(mockApi.setDomain).toHaveBeenCalledWith('production', 'def456', undefined);
      expect(mockApi.getDomain).not.toHaveBeenCalled(); // Should NOT make a second API call
      expect(result).toEqual(mockSetResponse);
    });

    it('should pass tags to api.setDomain when provided', async () => {
      const tags = ['production', 'v1.0.0'];
      const mockSetResponse = { domain: 'prod', deployment: 'xyz789', url: 'https://prod.statichost.dev', tags, isCreate: true };
      (mockApi.setDomain as any).mockResolvedValue(mockSetResponse);

      const result = await domains.set('prod', 'xyz789', tags);

      expect(mockApi.setDomain).toHaveBeenCalledWith('prod', 'xyz789', tags);
      expect(result).toEqual(mockSetResponse);
    });
  });

  describe('list', () => {
    it('should call api.listDomains and return result', async () => {
      const mockResponse = {
        domains: [
          { domain: 'staging', deployment: 'abc123', url: 'https://staging.statichost.dev' },
          { domain: 'production', deployment: 'def456', url: 'https://production.statichost.dev' }
        ]
      };
      (mockApi.listDomains as any).mockResolvedValue(mockResponse);

      const result = await domains.list();

      expect(mockApi.listDomains).toHaveBeenCalled();
      expect(result).toEqual(mockResponse);
    });
  });

  describe('remove', () => {
    it('should call api.removeDomain with correct parameter and return void', async () => {
      const mockResponse = { message: 'Domain removed' };
      (mockApi.removeDomain as any).mockResolvedValue(mockResponse);

      const result = await domains.remove('staging');

      expect(mockApi.removeDomain).toHaveBeenCalledWith('staging');
      expect(result).toBeUndefined();
    });

    it('should handle different domain names', async () => {
      const mockResponse = { message: 'Domain removed' };
      (mockApi.removeDomain as any).mockResolvedValue(mockResponse);

      const result = await domains.remove('production');

      expect(mockApi.removeDomain).toHaveBeenCalledWith('production');
      expect(result).toBeUndefined();
    });
  });

  describe('get', () => {
    it('should call api.getDomain with correct parameter', async () => {
      const mockResponse = { domain: 'staging', deployment: 'abc123', url: 'https://staging.statichost.dev' };
      (mockApi.getDomain as any).mockResolvedValue(mockResponse);

      const result = await domains.get('staging');

      expect(mockApi.getDomain).toHaveBeenCalledWith('staging');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('verify', () => {
    it('should call api.verifyDomain with correct parameter', async () => {
      const mockResponse = { message: 'DNS verification queued successfully' };
      (mockApi.verifyDomain as any).mockResolvedValue(mockResponse);

      const result = await domains.verify('example.com');

      expect(mockApi.verifyDomain).toHaveBeenCalledWith('example.com');
      expect(result).toEqual(mockResponse);
    });

    it('should handle different domain names for DNS verification', async () => {
      const mockResponse = { message: 'DNS verification queued successfully' };
      (mockApi.verifyDomain as any).mockResolvedValue(mockResponse);

      const result = await domains.verify('api.mysite.com');

      expect(mockApi.verifyDomain).toHaveBeenCalledWith('api.mysite.com');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('integration', () => {
    it('should create domain resource with API client', () => {
      expect(domains).toBeDefined();
      expect(typeof domains.set).toBe('function');
      expect(typeof domains.get).toBe('function');
      expect(typeof domains.list).toBe('function');
      expect(typeof domains.remove).toBe('function');
      expect(typeof domains.verify).toBe('function');
    });

    it('should return promises from all methods', () => {
      (mockApi.setDomain as any).mockResolvedValue({});
      (mockApi.getDomain as any).mockResolvedValue({});
      (mockApi.listDomains as any).mockResolvedValue({});
      (mockApi.removeDomain as any).mockResolvedValue({});
      (mockApi.verifyDomain as any).mockResolvedValue({});

      expect(domains.set('test', 'abc123')).toBeInstanceOf(Promise);
      expect(domains.set('test', 'abc123', ['tag1'])).toBeInstanceOf(Promise);
      expect(domains.get('test')).toBeInstanceOf(Promise);
      expect(domains.list()).toBeInstanceOf(Promise);
      expect(domains.remove('test')).toBeInstanceOf(Promise);
      expect(domains.verify('test')).toBeInstanceOf(Promise);
    });
  });
});
