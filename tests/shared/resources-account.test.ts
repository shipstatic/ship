/**
 * @file Subject: `src/shared/resources.ts` — the account resource.
 *
 * One method, one endpoint, and that is the whole of it. The file previously
 * mocked an `ApiHttp` and asserted the delegation reached `getAccount()`; that
 * method no longer exists, because the delegation was the layer this wave
 * folded away. What it asserts now is the request itself.
 *
 * Its old mock listed `get`/`post`/`delete`/`deploy`/`ping`/`getDeployments`
 * beside the one method the resource reaches. That is not harmless padding:
 * `as unknown as ApiHttp` hides the whole object from the typechecker, so a
 * phantom survives every rename — and four of those names (`getAliases`,
 * `getAlias`, `setAlias`, `removeAlias`) were an API generation that predates
 * domains. A fake with exactly the surface under test cannot rot that way.
 */

import { API_PATHS } from '@shipstatic/types';
import { describe, expect, it, vi } from 'vitest';
import type { Transport } from '../../src/shared/api/http';
import { type AccountResource, createAccountResource } from '../../src/shared/resources';

function accountOver(answer: unknown) {
  const request = vi.fn().mockResolvedValue(answer);
  const transport = {
    request,
    requestWithStatus: vi.fn(),
    deploy: { endpoint: '/deployments', timeout: 1, buildTimeout: 2 },
  } as unknown as Transport;
  const account: AccountResource = createAccountResource({ getApi: () => transport });
  return { account, request };
}

describe('AccountResource', () => {
  it('GETs /account and resolves the wire’s answer', async () => {
    const answer = { account: 'acc-1', email: 'user@example.com', name: 'Test User' };
    const { account, request } = accountOver(answer);

    const result = await account.get();

    expect(request).toHaveBeenCalledWith(API_PATHS.ACCOUNT, { method: 'GET' }, 'Get account');
    expect(result).toEqual(answer);
  });

  it('does not catch — a failed read is the caller’s to handle', async () => {
    const { account } = accountOver(undefined);
    const failing = createAccountResource({
      getApi: () =>
        ({
          request: vi.fn().mockRejectedValue(new Error('boom')),
        }) as unknown as Transport,
    });
    void account;

    await expect(failing.get()).rejects.toThrow('boom');
  });
});
