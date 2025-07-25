import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAliasResource, type AliasResource } from '@/resources';
import type { ApiHttp } from '@/api/http';

describe('AliasResource', () => {
  let mockApi: ApiHttp;
  let aliases: AliasResource;

  beforeEach(() => {
    // Mock the ApiHttp client with the new methods
    mockApi = {
      setAlias: vi.fn(),
      getAlias: vi.fn(),
      listAliases: vi.fn(),
      removeAlias: vi.fn(),
      deploy: vi.fn(),
      ping: vi.fn()
    } as unknown as ApiHttp;

    aliases = createAliasResource(() => mockApi);
  });

  describe('set', () => {
    it('should call api.setAlias and return the alias directly (no double API call)', async () => {
      const mockSetResponse = { alias: 'staging', deployment: 'abc123' };
      (mockApi.setAlias as any).mockResolvedValue(mockSetResponse);
      
      const result = await aliases.set('staging', 'abc123');
      
      expect(mockApi.setAlias).toHaveBeenCalledWith('staging', 'abc123');
      expect(mockApi.getAlias).not.toHaveBeenCalled(); // Should NOT make a second API call
      expect(result).toEqual(mockSetResponse);
    });

    it('should handle different deployment and alias combinations', async () => {
      const mockSetResponse = { alias: 'production', deployment: 'def456' };
      (mockApi.setAlias as any).mockResolvedValue(mockSetResponse);
      
      const result = await aliases.set('production', 'def456');
      
      expect(mockApi.setAlias).toHaveBeenCalledWith('production', 'def456');
      expect(mockApi.getAlias).not.toHaveBeenCalled(); // Should NOT make a second API call
      expect(result).toEqual(mockSetResponse);
    });
  });

  describe('list', () => {
    it('should call api.listAliases and return result', async () => {
      const mockResponse = {
        aliases: [
          { alias: 'staging', deployment: 'abc123' },
          { alias: 'production', deployment: 'def456' }
        ]
      };
      (mockApi.listAliases as any).mockResolvedValue(mockResponse);
      
      const result = await aliases.list();
      
      expect(mockApi.listAliases).toHaveBeenCalled();
      expect(result).toEqual(mockResponse);
    });
  });

  describe('remove', () => {
    it('should call api.removeAlias with correct parameter and return void', async () => {
      const mockResponse = { message: 'Alias removed' };
      (mockApi.removeAlias as any).mockResolvedValue(mockResponse);
      
      const result = await aliases.remove('staging');
      
      expect(mockApi.removeAlias).toHaveBeenCalledWith('staging');
      expect(result).toBeUndefined();
    });

    it('should handle different alias names', async () => {
      const mockResponse = { message: 'Alias removed' };
      (mockApi.removeAlias as any).mockResolvedValue(mockResponse);
      
      const result = await aliases.remove('production');
      
      expect(mockApi.removeAlias).toHaveBeenCalledWith('production');
      expect(result).toBeUndefined();
    });
  });

  describe('get', () => {
    it('should call api.getAlias with correct parameter', async () => {
      const mockResponse = { alias: 'staging', deployment: 'abc123' };
      (mockApi.getAlias as any).mockResolvedValue(mockResponse);
      
      const result = await aliases.get('staging');
      
      expect(mockApi.getAlias).toHaveBeenCalledWith('staging');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('integration', () => {
    it('should create alias resource with API client', () => {
      expect(aliases).toBeDefined();
      expect(typeof aliases.set).toBe('function');
      expect(typeof aliases.get).toBe('function');
      expect(typeof aliases.list).toBe('function');
      expect(typeof aliases.remove).toBe('function');
    });

    it('should return promises from all methods', () => {
      (mockApi.setAlias as any).mockResolvedValue({});
      (mockApi.getAlias as any).mockResolvedValue({});
      (mockApi.listAliases as any).mockResolvedValue({});
      (mockApi.removeAlias as any).mockResolvedValue({});

      expect(aliases.set('test', 'abc123')).toBeInstanceOf(Promise);
      expect(aliases.get('test')).toBeInstanceOf(Promise);
      expect(aliases.list()).toBeInstanceOf(Promise);
      expect(aliases.remove('test')).toBeInstanceOf(Promise);
    });
  });
});