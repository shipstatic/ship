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
      updateDomainLabels: vi.fn(),
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
      const mockSetResponse = { domain: 'staging', deployment: 'abc123', url: 'https://staging.shipstatic.dev', isCreate: true };
      (mockApi.setDomain as any).mockResolvedValue(mockSetResponse);

      const result = await domains.set('staging', { deployment: 'abc123' });

      expect(mockApi.setDomain).toHaveBeenCalledWith('staging', 'abc123', undefined);
      expect(mockApi.getDomain).not.toHaveBeenCalled(); // Should NOT make a second API call
      expect(result).toEqual(mockSetResponse);
    });

    it('should handle different deployment and domain combinations', async () => {
      const mockSetResponse = { domain: 'production', deployment: 'def456', url: 'https://production.shipstatic.dev', isCreate: false };
      (mockApi.setDomain as any).mockResolvedValue(mockSetResponse);

      const result = await domains.set('production', { deployment: 'def456' });

      expect(mockApi.setDomain).toHaveBeenCalledWith('production', 'def456', undefined);
      expect(mockApi.getDomain).not.toHaveBeenCalled(); // Should NOT make a second API call
      expect(result).toEqual(mockSetResponse);
    });

    it('should pass labels to api.setDomain when provided', async () => {
      const labels = ['production', 'v1.0.0'];
      const mockSetResponse = { domain: 'prod', deployment: 'xyz789', url: 'https://prod.shipstatic.dev', labels, isCreate: true };
      (mockApi.setDomain as any).mockResolvedValue(mockSetResponse);

      const result = await domains.set('prod', { deployment: 'xyz789', labels });

      expect(mockApi.setDomain).toHaveBeenCalledWith('prod', 'xyz789', labels);
      expect(result).toEqual(mockSetResponse);
    });

    it('should PUT (reserve) when called with no options', async () => {
      const mockSetResponse = { domain: 'reserved', deployment: null, url: 'https://reserved.shipstatic.dev', isCreate: true };
      (mockApi.setDomain as any).mockResolvedValue(mockSetResponse);

      const result = await domains.set('reserved');

      expect(mockApi.setDomain).toHaveBeenCalledWith('reserved', undefined, undefined);
      expect(mockApi.updateDomainLabels).not.toHaveBeenCalled();
      expect(result).toEqual(mockSetResponse);
    });

    it('should PUT (reserve) when called with empty options', async () => {
      const mockSetResponse = { domain: 'reserved', deployment: null, url: 'https://reserved.shipstatic.dev', isCreate: true };
      (mockApi.setDomain as any).mockResolvedValue(mockSetResponse);

      const result = await domains.set('reserved', {});

      expect(mockApi.setDomain).toHaveBeenCalledWith('reserved', undefined, undefined);
      expect(mockApi.updateDomainLabels).not.toHaveBeenCalled();
      expect(result).toEqual(mockSetResponse);
    });
  });

  describe('set with labels only (smart routing)', () => {
    it('should call api.updateDomainLabels when only labels provided', async () => {
      const labels = ['production', 'v2.0.0'];
      const mockUpdateResponse = { domain: 'staging', deployment: 'abc123', url: 'https://staging.shipstatic.dev', labels };
      (mockApi.updateDomainLabels as any).mockResolvedValue(mockUpdateResponse);

      const result = await domains.set('staging', { labels });

      expect(mockApi.updateDomainLabels).toHaveBeenCalledWith('staging', labels);
      expect(mockApi.setDomain).not.toHaveBeenCalled();
      expect(result).toEqual(mockUpdateResponse);
    });

    it('should PUT (reserve) when empty labels array and no deployment', async () => {
      const mockSetResponse = { domain: 'staging', deployment: null, url: 'https://staging.shipstatic.dev', labels: [] };
      (mockApi.setDomain as any).mockResolvedValue(mockSetResponse);

      const result = await domains.set('staging', { labels: [] });

      expect(mockApi.setDomain).toHaveBeenCalledWith('staging', undefined, []);
      expect(mockApi.updateDomainLabels).not.toHaveBeenCalled();
      expect(result).toEqual(mockSetResponse);
    });

    it('should allow clearing labels when deployment is provided', async () => {
      const mockSetResponse = { domain: 'staging', deployment: 'abc123', url: 'https://staging.shipstatic.dev', labels: [] };
      (mockApi.setDomain as any).mockResolvedValue(mockSetResponse);

      const result = await domains.set('staging', { deployment: 'abc123', labels: [] });

      expect(mockApi.setDomain).toHaveBeenCalledWith('staging', 'abc123', []);
      expect(result).toEqual(mockSetResponse);
    });

    it('should handle external domain label updates', async () => {
      const labels = ['live', 'primary'];
      const mockUpdateResponse = { domain: 'example.com', deployment: 'xyz789', url: 'https://example.com', labels, status: 'pending' };
      (mockApi.updateDomainLabels as any).mockResolvedValue(mockUpdateResponse);

      const result = await domains.set('example.com', { labels });

      expect(mockApi.updateDomainLabels).toHaveBeenCalledWith('example.com', labels);
      expect(result).toEqual(mockUpdateResponse);
    });
  });

  describe('list', () => {
    it('should call api.listDomains and return result', async () => {
      const mockResponse = {
        domains: [
          { domain: 'staging', deployment: 'abc123', url: 'https://staging.shipstatic.dev' },
          { domain: 'production', deployment: 'def456', url: 'https://production.shipstatic.dev' }
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
      const mockResponse = { domain: 'staging', deployment: 'abc123', url: 'https://staging.shipstatic.dev' };
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

  describe('validate', () => {
    it('should call api.validateDomain and return validation result', async () => {
      const mockValidateResponse = { valid: true, normalized: 'my-site.shipstatic.dev', available: true };
      (mockApi as any).validateDomain = vi.fn().mockResolvedValue(mockValidateResponse);

      const result = await domains.validate('my-site.shipstatic.dev');

      expect((mockApi as any).validateDomain).toHaveBeenCalledWith('my-site.shipstatic.dev');
      expect(result).toEqual(mockValidateResponse);
    });

    it('should return normalized domain and availability for valid platform domain', async () => {
      const mockValidateResponse = { valid: true, normalized: 'my-site.shipstatic.dev', available: true };
      (mockApi as any).validateDomain = vi.fn().mockResolvedValue(mockValidateResponse);

      const result = await domains.validate('my-site.shipstatic.dev');

      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('my-site.shipstatic.dev');
      expect(result.available).toBe(true);
    });

    it('should return normalized domain for valid custom domain', async () => {
      const mockValidateResponse = { valid: true, normalized: 'www.example.com', available: true };
      (mockApi as any).validateDomain = vi.fn().mockResolvedValue(mockValidateResponse);

      const result = await domains.validate('example.com');

      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('www.example.com');
      expect(result.available).toBe(true);
    });

    it('should indicate when platform domain is taken', async () => {
      const mockValidateResponse = { valid: true, normalized: 'taken-site.shipstatic.dev', available: false };
      (mockApi as any).validateDomain = vi.fn().mockResolvedValue(mockValidateResponse);

      const result = await domains.validate('taken-site.shipstatic.dev');

      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('taken-site.shipstatic.dev');
      expect(result.available).toBe(false);
    });

    it('should return error for invalid domain', async () => {
      const mockValidateResponse = { valid: false, error: 'Domain must be a fully qualified domain name' };
      (mockApi as any).validateDomain = vi.fn().mockResolvedValue(mockValidateResponse);

      const result = await domains.validate('invalid');

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.available).toBeUndefined();
    });

    it('should handle uppercase normalization', async () => {
      const mockValidateResponse = { valid: true, normalized: 'mysite.shipstatic.dev', available: true };
      (mockApi as any).validateDomain = vi.fn().mockResolvedValue(mockValidateResponse);

      const result = await domains.validate('MySite.SHIPSTATIC.DEV');

      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('mysite.shipstatic.dev');
      expect(result.available).toBe(true);
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
      expect(typeof domains.validate).toBe('function');
    });

    it('should return promises from all methods', () => {
      (mockApi.setDomain as any).mockResolvedValue({});
      (mockApi.updateDomainLabels as any).mockResolvedValue({});
      (mockApi.getDomain as any).mockResolvedValue({});
      (mockApi.listDomains as any).mockResolvedValue({});
      (mockApi.removeDomain as any).mockResolvedValue({});
      (mockApi.verifyDomain as any).mockResolvedValue({});
      (mockApi as any).validateDomain = vi.fn().mockResolvedValue({});

      expect(domains.set('test', { deployment: 'abc123' })).toBeInstanceOf(Promise);
      expect(domains.set('test', { deployment: 'abc123', labels: ['tag1'] })).toBeInstanceOf(Promise);
      expect(domains.set('test', { labels: ['tag1', 'tag2'] })).toBeInstanceOf(Promise);
      expect(domains.get('test')).toBeInstanceOf(Promise);
      expect(domains.list()).toBeInstanceOf(Promise);
      expect(domains.remove('test')).toBeInstanceOf(Promise);
      expect(domains.verify('test')).toBeInstanceOf(Promise);
      expect(domains.validate('test.example.com')).toBeInstanceOf(Promise);
    });
  });
});
