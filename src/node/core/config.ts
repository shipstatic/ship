/**
 * @file The `SHIP_*` environment variables, for the Node.js Ship SDK.
 *
 * The SDK has exactly one ambient credential source: process environment
 * variables. `SHIP_TOKEN` (any platform token: the value's prefix says what
 * it is) and `SHIP_API_URL` are the one-token idiom of a process boundary
 * (`GITHUB_TOKEN`, `NPM_TOKEN`, `VERCEL_TOKEN`). Constructor arguments win
 * over them.
 *
 * File-based config (`~/.shiprc`, or the file `--config` names) is the CLI's
 * responsibility: see `src/node/cli/shiprc.ts`. The SDK does not read files,
 * which is what lets embedded consumers (MCP, the VS Code extension, GitHub
 * Action) construct `new Ship({})` for anonymous deployments without leaking
 * the host developer's personal credentials.
 */

import { SHIP_ENV, ShipError } from '@shipstatic/types';
import { CREDENTIAL_FIELDS } from './credential-schema.js';

/** The variable behind each field, so a refusal names what the person set. */
const VARIABLE = {
  apiUrl: SHIP_ENV.API_URL,
  token: SHIP_ENV.TOKEN,
} as const;

/**
 * One variable's value, held to the rule its field has in a config file too.
 * An empty string is unset: CI and Docker often set a variable to `""`
 * instead of unsetting it.
 */
function read(field: keyof typeof VARIABLE): string | undefined {
  const result = CREDENTIAL_FIELDS[field].safeParse(process.env[VARIABLE[field]] || undefined);
  if (!result.success) {
    throw ShipError.config(`Invalid ${VARIABLE[field]}: ${result.error.issues[0].message}`);
  }
  return result.data;
}

/**
 * The `SHIP_*` variables, each read when it is asked for. Every caller reads
 * one under a value of its own (`options.apiUrl || env.apiUrl`), so a
 * variable that an argument or a flag overrides is never read, and a bad one
 * refuses only the client that would have used it.
 */
export function readEnvConfig(): { readonly apiUrl?: string; readonly token?: string } {
  return {
    get apiUrl() {
      return read('apiUrl');
    },
    get token() {
      return read('token');
    },
  };
}
