/**
 * @file Locks in the CLI's credential precedence: flag > env > file.
 *
 * There is one token and one API URL — precedence is per value, source order
 * only. `mergeCliConfig` is a pure function — these tests don't touch the
 * filesystem, env vars, or the SDK. If a future refactor ever flips the
 * precedence, these will fail loudly.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createClient, mergeCliConfig } from '../../../src/node/cli/create-client';
import { Ship } from '../../../src/node/index';

describe('mergeCliConfig — CLI credential precedence', () => {
  it('flag wins over env and file', () => {
    expect(
      mergeCliConfig({ token: 'flag-token' }, { token: 'env-token' }, { token: 'file-token' }),
    ).toMatchObject({ token: 'flag-token' });
  });

  it('env wins over file when no flag is given', () => {
    // Env-over-file is the canonical CLI posture: CI runners and secret
    // managers set env vars, and a stale dotfile from local dev must not
    // override them.
    expect(mergeCliConfig({}, { token: 'env-token' }, { token: 'file-token' })).toMatchObject({
      token: 'env-token',
    });
  });

  it('file is the deepest fallback', () => {
    expect(mergeCliConfig({}, {}, { token: 'file-token' })).toMatchObject({ token: 'file-token' });
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
    expect(
      mergeCliConfig({ apiUrl: 'https://flag.example.com' }, { token: 'env-token' }, {}),
    ).toEqual({
      apiUrl: 'https://flag.example.com',
      token: 'env-token',
    });
  });

  it('treats explicit undefined in flags as "no flag" (lets env/file fill in)', () => {
    // Commander hands missing flags through as `undefined`, not as omitted
    // properties. Nullish coalescing must treat them identically.
    expect(mergeCliConfig({ token: undefined }, { token: 'env-token' }, {})).toMatchObject({
      token: 'env-token',
    });
  });

  it('treats empty-string flags as absence (falls through to env, then file)', () => {
    // Regression: CI/CD shell expansion of an unset variable produces
    // `--token ""`. Treating that as a deliberate empty credential would
    // silently demote an authenticated deploy to anonymous PUBLIC_ACCOUNT.
    // Empty must fall through.
    expect(mergeCliConfig({ token: '' }, { token: 'env-token' }, {})).toMatchObject({
      token: 'env-token',
    });

    // And again, all the way to file:
    expect(mergeCliConfig({ token: '' }, { token: '' }, { token: 'file-token' })).toMatchObject({
      token: 'file-token',
    });
  });
});

/**
 * The API URL is judged once every source has become one value.
 *
 * `validateApiUrl` ran only in the CLI's `preAction` hook, which sees the FLAG
 * and nothing else — so `https://api.example.com/v1` was refused when typed
 * and accepted when saved to `.shiprc` or exported as `SHIP_API_URL`. Verified
 * against the real binary before the fix: the flag produced the constitution's
 * authored sentence, the other two produced a transport failure several
 * commands later, by which time nothing connects the symptom to the cause.
 *
 * Tested HERE rather than through the CLI harness for a mechanical reason
 * worth knowing: the harness injects `--api-url <mock server>` into every
 * invocation that does not carry one, and a flag beats both other sources by
 * design — so no harness-driven test can ever exercise the file or env path.
 * `createClient` is where the merge happens and where the check lives.
 */
describe('createClient — the API URL rule reaches every source', () => {
  const PATHY = 'https://api.example.com/v1';
  const REFUSAL = /API URL must not contain a path/;

  /** A `.shiprc` holding just an apiUrl, in a directory of its own. */
  const configFile = (apiUrl: string): string => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'ship-create-client-')), 'config.json');
    writeFileSync(file, JSON.stringify({ apiUrl }));
    return file;
  };

  it('refuses one that arrived as a FLAG', () => {
    expect(() => createClient({ apiUrl: PATHY })).toThrow(REFUSAL);
  });

  it('refuses one that arrived from a config FILE', () => {
    expect(() => createClient({ config: configFile(PATHY) })).toThrow(REFUSAL);
  });

  it('refuses one that arrived from SHIP_API_URL', () => {
    vi.stubEnv('SHIP_API_URL', PATHY);
    try {
      expect(() => createClient({})).toThrow(REFUSAL);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('accepts a clean URL from every source', () => {
    // The other half: the rule must not have become "refuse config files".
    const clean = 'https://api.example.com';
    expect(() => createClient({ apiUrl: clean })).not.toThrow();
    expect(() => createClient({ config: configFile(clean) })).not.toThrow();

    vi.stubEnv('SHIP_API_URL', clean);
    try {
      expect(() => createClient({})).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('leaves the SDK constructor loose — this is a CLI-tier rule', () => {
    // An embedded consumer may legitimately pass an unroutable apiUrl: a
    // Cloudflare service binding dispatches by binding identity, so
    // `apiUrl: 'https://api'` is correct there. The check belongs to the CLI
    // deciding what a person may write in a config file, and moving it into
    // the constructor would break a published, documented use.
    expect(() => new Ship({ apiUrl: 'https://api/some/path' })).not.toThrow();
  });
});
