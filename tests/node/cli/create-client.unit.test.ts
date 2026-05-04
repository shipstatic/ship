/**
 * @file Locks in the CLI's credential precedence: flag > env > file.
 *
 * `mergeCliConfig` is a pure function — these tests don't touch the
 * filesystem, env vars, or the SDK. If a future refactor ever flips the
 * precedence, these will fail loudly.
 */

import { describe, it, expect } from 'vitest';
import { mergeCliConfig } from '../../../src/node/cli/create-client';

describe('mergeCliConfig — CLI credential precedence', () => {
  it('flag wins over env and file', () => {
    expect(mergeCliConfig(
      { apiKey: 'flag-key' },
      { apiKey: 'env-key' },
      { apiKey: 'file-key' },
    )).toMatchObject({ apiKey: 'flag-key' });
  });

  it('env wins over file when no flag is given', () => {
    // Env-over-file is the canonical CLI posture: CI runners and secret
    // managers set env vars, and a stale dotfile from local dev must not
    // override them.
    expect(mergeCliConfig(
      {},
      { apiKey: 'env-key' },
      { apiKey: 'file-key' },
    )).toMatchObject({ apiKey: 'env-key' });
  });

  it('file is the deepest fallback', () => {
    expect(mergeCliConfig(
      {},
      {},
      { apiKey: 'file-key' },
    )).toMatchObject({ apiKey: 'file-key' });
  });

  it('returns undefined for fields absent from all sources', () => {
    // Anonymous deploy path — the SDK fetches an agent token at request time.
    expect(mergeCliConfig({}, {}, {})).toEqual({
      apiUrl: undefined,
      apiKey: undefined,
      deployToken: undefined,
    });
  });

  it('per-field precedence is independent', () => {
    // A flag-supplied apiUrl must not suppress an env-supplied apiKey,
    // and an env-supplied apiKey must not suppress a file-supplied deployToken.
    expect(mergeCliConfig(
      { apiUrl: 'https://flag.example.com' },
      { apiKey: 'env-key' },
      { deployToken: 'file-token' },
    )).toEqual({
      apiUrl: 'https://flag.example.com',
      apiKey: 'env-key',
      deployToken: 'file-token',
    });
  });

  it('treats explicit undefined in flags as "no flag" (lets env/file fill in)', () => {
    // Commander hands missing flags through as `undefined`, not as omitted
    // properties. Nullish coalescing must treat them identically.
    expect(mergeCliConfig(
      { apiKey: undefined },
      { apiKey: 'env-key' },
      {},
    )).toMatchObject({ apiKey: 'env-key' });
  });

  it('treats empty-string flags as absence (falls through to env, then file)', () => {
    // Regression: CI/CD shell expansion of an unset variable produces
    // `--api-key ""`. Treating that as a deliberate empty credential would
    // silently demote an authenticated deploy to anonymous PUBLIC_ACCOUNT
    // — the agent-token fallback fires when the auth state is null, which
    // it is for an empty string (falsy). Empty must fall through.
    expect(mergeCliConfig(
      { apiKey: '' },
      { apiKey: 'env-key' },
      {},
    )).toMatchObject({ apiKey: 'env-key' });

    // And again, all the way to file:
    expect(mergeCliConfig(
      { apiKey: '' },
      { apiKey: '' },
      { apiKey: 'file-key' },
    )).toMatchObject({ apiKey: 'file-key' });
  });
});
