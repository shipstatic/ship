/**
 * @file Environment variable resolution for the Node.js Ship SDK.
 *
 * The SDK has exactly one ambient credential source: process environment variables.
 * `SHIP_API_KEY`, `SHIP_DEPLOY_TOKEN`, and `SHIP_API_URL` are honored as the
 * universal "process boundary" — the same idiom used by the OpenAI and Anthropic
 * SDKs. Constructor arguments always win over env vars.
 *
 * File-based config (`~/.shiprc`, `package.json` `"ship"` key) is the CLI's
 * responsibility — see `src/node/cli/shiprc.ts`. The SDK does not read files,
 * which is what lets embedded consumers (MCP, n8n, GitHub Action) construct
 * `new Ship({})` for anonymous deployments without leaking the host developer's
 * personal credentials.
 */

import { z } from 'zod';
import type { ShipClientOptions } from '../../shared/types.js';
import { ShipError } from '@shipstatic/types';
import { getENV } from '../../shared/lib/env.js';
import { CREDENTIAL_FIELDS } from '../../shared/core/credential-schema.js';

// `.strict()` matches the file-config schema. The `raw` object below is
// constructed from a fixed set of keys, so .strict() doesn't catch user
// typos here (env vars we don't read are simply never put into `raw` in
// the first place). What it does catch is a *contributor* error — adding
// a new env-var read without updating `CREDENTIAL_FIELDS` produces a clear
// validation failure rather than a silently-stripped value. Nearly free
// (one method call), and keeps both schemas reading the same.
const EnvConfigSchema = z.object(CREDENTIAL_FIELDS).strict();

/**
 * Map a `ShipClientOptions` field name (camelCase) back to the env var that
 * supplied it (SCREAMING_SNAKE_CASE), so validation errors point users at
 * the actual variable they need to fix. Kept as an explicit table rather
 * than a regex because the set is small, fixed, and unambiguous.
 */
const ENV_VAR_BY_FIELD: Record<string, string> = {
  apiUrl: 'SHIP_API_URL',
  apiKey: 'SHIP_API_KEY',
  deployToken: 'SHIP_DEPLOY_TOKEN',
};

/**
 * Read `SHIP_*` environment variables and validate the result.
 *
 * Empty strings (CI/Docker often sets env vars to `""` instead of unsetting them)
 * are normalized to `undefined` before validation, so they don't trigger zod's
 * "min length 1" check or accidentally override a valid constructor argument.
 *
 * Returns an empty object outside Node.js — browser/edge runtimes have no
 * `process.env` we should reach into.
 */
export function readEnvConfig(): Partial<ShipClientOptions> {
  if (getENV() !== 'node') return {};

  const raw = {
    apiUrl: process.env.SHIP_API_URL || undefined,
    apiKey: process.env.SHIP_API_KEY || undefined,
    deployToken: process.env.SHIP_DEPLOY_TOKEN || undefined,
  };

  try {
    return EnvConfigSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      const field = issue.path[0] as string | undefined;
      const envVar = (field && ENV_VAR_BY_FIELD[field]) ?? 'SHIP environment configuration';
      throw ShipError.config(`Invalid ${envVar}: ${issue.message}`);
    }
    throw ShipError.config('Invalid environment configuration');
  }
}
