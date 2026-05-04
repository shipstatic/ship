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

import { Ship } from '../index.js';
import { readEnvConfig } from '../core/config.js';
import { loadShipFile } from './shiprc.js';
import type { ShipClientOptions } from '../../shared/types.js';

/**
 * The subset of CLI flags that participate in credential resolution.
 * Other flags (`--json`, `--quiet`, etc.) flow through Commander separately.
 */
export interface CliFlags {
  /** Path to a specific config file, from `--config <file>`. */
  config?: string;
  apiUrl?: string;
  apiKey?: string;
  deployToken?: string;
}

/**
 * Pure precedence merge. Each credential field resolves independently —
 * a flag-supplied `apiUrl` does not suppress an env-supplied `apiKey`.
 *
 * Empty strings are treated as absence and fall through to the next source
 * (mirrors the env reader, which normalizes empty `process.env` values to
 * `undefined`). This handles CI/CD shell-expansion of unset variables —
 * `--api-key "$KEY"` with `KEY` unset becomes `--api-key ""`, which we
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
    apiKey: flags.apiKey || env.apiKey || file.apiKey,
    deployToken: flags.deployToken || env.deployToken || file.deployToken,
  };
}

/**
 * Resolve CLI flags + env + file into a `Ship` instance, ready for command
 * action handlers. Called once per CLI invocation by `withErrorHandling`.
 *
 * Synchronous all the way down — matches the SDK's sync constructor.
 */
export function createClient(flags: CliFlags = {}): Ship {
  return new Ship(mergeCliConfig(flags, readEnvConfig(), loadShipFile(flags.config)));
}
