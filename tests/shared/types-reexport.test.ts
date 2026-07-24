/**
 * @file Re-export freshness fence.
 *
 * Imports the platform vocabulary through ship's own re-export surface
 * (`src/shared/types.ts` → `export * from '@shipstatic/types'`). The published
 * artifact bundles `@shipstatic/types`, so a build against a stale types
 * package would silently ship yesterday's platform to every consumer — these
 * assertions turn that into a red suite instead.
 */
import { describe, it, expect } from 'vitest';
import { AuthMethod, OAuthScope } from '../../src/shared/types';

describe('Platform vocabulary re-export', () => {
  describe('AuthMethod', () => {
    it('should have all credential populations', () => {
      expect(AuthMethod.SESSION).toBe('session');
      expect(AuthMethod.API_KEY).toBe('apiKey');
      expect(AuthMethod.TOKEN).toBe('token');
      expect(AuthMethod.AGENT).toBe('agent');
      expect(AuthMethod.OAUTH).toBe('oauth');
      expect(AuthMethod.WEBHOOK).toBe('webhook');
      expect(AuthMethod.SYSTEM).toBe('system');
    });

    it('should have no duplicate values', () => {
      const values = Object.values(AuthMethod);
      expect(new Set(values).size).toBe(values.length);
    });
  });

  describe('OAuthScope', () => {
    // Scope strings are a wire contract — OAuth clients hold grants recorded
    // against these exact values. Changing one invalidates issued tokens.
    it('should have the exact platform scope vocabulary', () => {
      expect(OAuthScope.ACCOUNT_READ).toBe('account:read');
      expect(OAuthScope.DEPLOYMENTS_READ).toBe('deployments:read');
      expect(OAuthScope.DEPLOYMENTS_WRITE).toBe('deployments:write');
      expect(OAuthScope.DOMAINS_READ).toBe('domains:read');
      expect(OAuthScope.DOMAINS_WRITE).toBe('domains:write');
      expect(Object.keys(OAuthScope)).toHaveLength(5);
    });
  });
});
