/**
 * @file Resolves CLI configuration into a `Ship` instance.
 *
 * Owns the credential precedence contract: **flag > env > file**.
 *
 * Env-over-file is the canonical CLI tooling posture: CI runners and secret
 * managers set environment variables; a stale dotfile from local dev should
 * never override them. The merge is extracted as a pure function so the
 * contract is unit-testable and a future refactor can't silently flip the
 * order.
 *
 * The SDK itself only knows about constructor args + env vars (see
 * `node/index.ts`). File resolution lives here, in the CLI layer, exactly
 * once — keeping the SDK pure is what guarantees embedded consumers like
 * MCP can't inadvertently inherit the host developer's `~/.shiprc`.
 */

import { validateApiUrl } from '@shipstatic/types';
import type { ShipClientOptions } from '../../shared/types.js';
import { readEnvConfig } from '../core/config.js';
import { Ship } from '../index.js';
import { loadShipFile } from './shiprc.js';

/**
 * The subset of CLI flags that participate in config resolution.
 * Other flags (`--json`, `--quiet`, etc.) flow through Commander separately.
 */
export interface CliFlags {
  /** Path to a specific config file, from `--config <file>`. */
  config?: string;
  apiUrl?: string;
  token?: string;
}

/**
 * Pure precedence merge: flag > env > file, per value. There is one token
 * and one API URL — nothing to arbitrate beyond source order.
 *
 * Empty strings are treated as absence and fall through to the next source
 * (mirrors the env reader, which normalizes empty `process.env` values to
 * `undefined`). This handles CI/CD shell-expansion of unset variables —
 * `--token "$TOKEN"` with `TOKEN` unset becomes `--token ""`, which we
 * must not lock in as a credential. Without this, an empty flag would
 * silently demote an authenticated deploy to anonymous PUBLIC_ACCOUNT.
 *
 * Exported separately from `createClient` so tests can lock in the contract
 * without mocking the SDK or the filesystem.
 */
export function mergeCliConfig(
  flags: CliFlags,
  env: Partial<ShipClientOptions>,
  file: Partial<ShipClientOptions>,
): ShipClientOptions {
  return {
    apiUrl: flags.apiUrl || env.apiUrl || file.apiUrl,
    token: flags.token || env.token || file.token,
  };
}

/**
 * Resolve CLI flags + env + file into a `Ship` instance, ready for command
 * action handlers. Called once per CLI invocation by `withErrorHandling`.
 *
 * Synchronous all the way down — matches the SDK's sync constructor.
 */
export function createClient(flags: CliFlags = {}): Ship {
  const resolved = mergeCliConfig(flags, readEnvConfig(), loadShipFile(flags.config));

  // The API URL is judged HERE because here is where every source has become
  // one value. The `preAction` hook validates the FLAG — earlier, and with a
  // better moment to fail — but it can only ever see the flag, so the same
  // value written into `.shiprc` or exported as `SHIP_API_URL` reached the
  // wire unjudged: `https://api.example.com/v1` was refused when typed and
  // accepted when saved, and the saved form is the one that persists. The
  // authored sentence ("API URL must not contain a path") was reaching the
  // source least likely to hold the mistake.
  //
  // One rule, one owner (`validateApiUrl` in `@shipstatic/types`), two call
  // sites at two tiers — the same shape as validating a password in the SDK
  // and again at the API, and not a second statement of the rule itself.
  //
  // CLI TIER ONLY, deliberately. The `Ship` constructor stays loose because
  // an embedded consumer may legitimately pass an unroutable `apiUrl` — a
  // Cloudflare service binding dispatches by binding identity, so
  // `apiUrl: 'https://api'` is correct there. This is the CLI deciding what a
  // person may put in a config file, which is a different question.
  if (resolved.apiUrl) validateApiUrl(resolved.apiUrl);

  return new Ship(resolved);
}
