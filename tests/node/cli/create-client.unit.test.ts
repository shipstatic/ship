/**
 * @file Locks in the CLI's credential precedence: flag > env > file.
 *
 * There is one token and one API URL — precedence is per value, source order
 * only. `mergeCliConfig` is a pure function — these tests don't touch the
 * filesystem, env vars, or the SDK. If a future refactor ever flips the
 * precedence, these will fail loudly.
 */

import { describe, it, expect } from 'vitest';
import { mergeCliConfig } from '../../../src/node/cli/create-client';

describe('mergeCliConfig — CLI credential precedence', () => {
  it('flag wins over env and file', () => {
    expect(mergeCliConfig(
      { token: 'flag-token' },
      { token: 'env-token' },
      { token: 'file-token' },
    )).toMatchObject({ token: 'flag-token' });
  });

  it('env wins over file when no flag is given', () => {
    // Env-over-file is the canonical CLI posture: CI runners and secret
    // managers set env vars, and a stale dotfile from local dev must not
    // override them.
    expect(mergeCliConfig(
      {},
      { token: 'env-token' },
      { token: 'file-token' },
    )).toMatchObject({ token: 'env-token' });
  });

  it('file is the deepest fallback', () => {
    expect(mergeCliConfig(
      {},
      {},
      { token: 'file-token' },
    )).toMatchObject({ token: 'file-token' });
  });

  it('returns undefined for fields absent from all sources', () => {
    // Anonymous deploy path — the API grants the public-account agent
    // identity per request.
    expect(mergeCliConfig({}, {}, {})).toEqual({
      apiUrl: undefined,
      token: undefined,
    });
  });

  it('apiUrl resolves independently of the token', () => {
    // A flag-supplied apiUrl must not suppress an env-supplied token.
    expect(mergeCliConfig(
      { apiUrl: 'https://flag.example.com' },
      { token: 'env-token' },
      {},
    )).toEqual({
      apiUrl: 'https://flag.example.com',
      token: 'env-token',
    });
  });

  it('treats explicit undefined in flags as "no flag" (lets env/file fill in)', () => {
    // Commander hands missing flags through as `undefined`, not as omitted
    // properties. Nullish coalescing must treat them identically.
    expect(mergeCliConfig(
      { token: undefined },
      { token: 'env-token' },
      {},
    )).toMatchObject({ token: 'env-token' });
  });

  it('treats empty-string flags as absence (falls through to env, then file)', () => {
    // Regression: CI/CD shell expansion of an unset variable produces
    // `--token ""`. Treating that as a deliberate empty credential would
    // silently demote an authenticated deploy to anonymous PUBLIC_ACCOUNT.
    // Empty must fall through.
    expect(mergeCliConfig(
      { token: '' },
      { token: 'env-token' },
      {},
    )).toMatchObject({ token: 'env-token' });

    // And again, all the way to file:
    expect(mergeCliConfig(
      { token: '' },
      { token: '' },
      { token: 'file-token' },
    )).toMatchObject({ token: 'file-token' });
  });
});
