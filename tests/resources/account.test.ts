import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAccountResource, type AccountResource } from '@/resources';
import type { ApiHttp } from '@/api/http';

describe('AccountResource', () => {
  let mockApi: ApiHttp;
  let account: AccountResource;

  beforeEach(() => {
    // Mock the ApiHttp client
    mockApi = {
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
      deploy: vi.fn(),
      ping: vi.fn(),
      getDeployments: vi.fn(),
      getDeployment: vi.fn(),
      removeDeployment: vi.fn(),
      getAliases: vi.fn(),
      getAlias: vi.fn(),
      setAlias: vi.fn(),
      removeAlias: vi.fn(),
      getAccount: vi.fn()
    } as unknown as ApiHttp;

    account = createAccountResource(mockApi);
  });

  describe('get', () => {
    it('should call API getAccount and return result', async () => {
      const mockResponse = {
        email: 'test@example.com',
        name: 'Test User',
        subscription: 'free',
        createdAt: 1234567890
      };
      
      (mockApi.getAccount as any).mockResolvedValue(mockResponse);
      
      const result = await account.get();
      
      expect(mockApi.getAccount).toHaveBeenCalledWith();
      expect(result).toEqual(mockResponse);
    });

    it('should handle different account types', async () => {
      const testCases = [
        {
          email: 'free@example.com',
          name: 'Free User',
          subscription: 'free' as const,
          createdAt: 1234567890
        },
        {
          email: 'paid@example.com',
          name: 'Paid User',
          picture: 'https://example.com/avatar.jpg',
          subscription: 'active' as const,
          createdAt: 1234567890,
          subscribedAt: 1234567900
        }
      ];
      
      for (const testCase of testCases) {
        (mockApi.getAccount as any).mockResolvedValue(testCase);
        
        const result = await account.get();
        expect(mockApi.getAccount).toHaveBeenCalledWith();
        expect(result.email).toBe(testCase.email);
        expect(result.subscription).toBe(testCase.subscription);
      }
    });
  });

  describe('integration', () => {
    it('should create account resource with API client', () => {
      expect(account).toBeDefined();
      expect(typeof account.get).toBe('function');
    });

    it('should return promise from get method', () => {
      expect(account.get()).toBeInstanceOf(Promise);
    });
  });
});