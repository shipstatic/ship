import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSubscriptionResource, type SubscriptionResource } from '../../../src/shared/resources';
import type { ApiHttp } from '../../../src/shared/api/http';

describe('SubscriptionResource', () => {
  let mockApi: ApiHttp;
  let subscriptions: SubscriptionResource;

  beforeEach(() => {
    // Mock the ApiHttp client
    mockApi = {
      createCheckout: vi.fn(),
      getSubscriptionStatus: vi.fn(),
    } as unknown as ApiHttp;

    subscriptions = createSubscriptionResource(() => mockApi);
  });

  describe('checkout', () => {
    it('should call API createCheckout and return checkout session', async () => {
      const mockResponse = {
        checkoutUrl: 'https://checkout.creem.io/session_123',
        checkoutId: 'session_123'
      };

      (mockApi.createCheckout as any).mockResolvedValue(mockResponse);

      const result = await subscriptions.checkout();

      expect(mockApi.createCheckout).toHaveBeenCalledWith();
      expect(result).toEqual(mockResponse);
      expect(result.checkoutUrl).toBe(mockResponse.checkoutUrl);
      expect(result.checkoutId).toBe(mockResponse.checkoutId);
    });
  });

  describe('status', () => {
    it('should call API getSubscriptionStatus and return status', async () => {
      const mockResponse = {
        hasSubscription: true,
        plan: 'paid' as const,
        subscriptionId: 'sub_123',
        units: 2,
        customDomains: 1,
        status: 'active',
        portalLink: 'https://portal.creem.io/customer_123'
      };

      (mockApi.getSubscriptionStatus as any).mockResolvedValue(mockResponse);

      const result = await subscriptions.status();

      expect(mockApi.getSubscriptionStatus).toHaveBeenCalledWith();
      expect(result).toEqual(mockResponse);
      expect(result.hasSubscription).toBe(true);
      expect(result.plan).toBe('paid');
      expect(result.units).toBe(2);
    });

    it('should handle free tier (no subscription)', async () => {
      const mockResponse = {
        hasSubscription: false,
        plan: 'free' as const,
        customDomains: 0,
        portalLink: null
      };

      (mockApi.getSubscriptionStatus as any).mockResolvedValue(mockResponse);

      const result = await subscriptions.status();

      expect(mockApi.getSubscriptionStatus).toHaveBeenCalledWith();
      expect(result.hasSubscription).toBe(false);
      expect(result.plan).toBe('free');
      expect(result.portalLink).toBeNull();
    });
  });

  /**
   * IMPOSSIBLE SIMPLICITY: No sync() tests needed!
   * Webhooks are the single source of truth. Frontend polls status().
   */

  describe('integration', () => {
    it('should create subscription resource with API client', () => {
      expect(subscriptions).toBeDefined();
      expect(typeof subscriptions.checkout).toBe('function');
      expect(typeof subscriptions.status).toBe('function');
    });

    it('should return promises from all methods', () => {
      (mockApi.createCheckout as any).mockResolvedValue({});
      (mockApi.getSubscriptionStatus as any).mockResolvedValue({});

      expect(subscriptions.checkout()).toBeInstanceOf(Promise);
      expect(subscriptions.status()).toBeInstanceOf(Promise);
    });
  });
});
