/**
 * @file Re-export freshness fence.
 *
 * Imports the platform vocabulary through ship's own re-export surface
 * (`src/shared/types.ts` → `export * from '@shipstatic/types'`). The published
 * artifact **bundles** `@shipstatic/types`, so a build against a stale types
 * package would silently ship yesterday's platform to every consumer — these
 * assertions turn that into a red suite instead.
 *
 * Type-level vocabulary (unions, optional fields) has no runtime value to
 * assert. Those entries are `satisfies` expressions instead: erased at run
 * time, but real the moment `pnpm typecheck` covers `tests/**` — which it
 * does. A stale types package fails to compile them.
 */
import { describe, expect, it } from 'vitest';
import type { Account, UserVisibleActivityEvent } from '../../src/shared/types';
import { AUTH_BASE_PATH, AuthMethod, OAuthScope } from '../../src/shared/types';

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

  describe('AUTH_BASE_PATH', () => {
    // Where human identity is mounted on the API host. The SDK never calls it,
    // but it rides the same bundled vocabulary — its absence is the cheapest
    // possible signal that the bundled types have fallen behind.
    it('should be the identity mount the API serves', () => {
      expect(AUTH_BASE_PATH).toBe('/auth');
    });
  });

  describe('type-level vocabulary', () => {
    it('carries the full user-visible token activity vocabulary', () => {
      const tokenEvents = [
        'token.create',
        'token.consume',
        'token.delete',
      ] satisfies UserVisibleActivityEvent[];
      expect(tokenEvents).toHaveLength(3);
    });

    it('carries the API key last-use instant on Account', () => {
      const account = { used: 1_700_000_000 } satisfies Pick<Account, 'used'>;
      expect(account.used).toBe(1_700_000_000);
    });
  });
});
