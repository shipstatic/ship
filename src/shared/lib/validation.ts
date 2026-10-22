/**
 * @file Client-side input validation for SDK request boundaries.
 *
 * These validators run before request construction, and this module is the
 * one import surface for them (`http.ts` takes all three from here). The
 * rules themselves live in `@shipstatic/types` as whole checks
 * (`validateLabels`, `validatePassword`, `assertShipJsonSyntax`), so the SDK
 * and the API can never disagree about what a value must look like.
 *
 * Every check here is format, never policy: length envelopes, patterns, JSON
 * syntax. Anything that can evolve server-side — password strength, plan
 * caps, the ship.json schema — is deliberately absent, because a client that
 * judged it would reject input a newer platform accepts. See
 * `@shipstatic/types/CLAUDE.md` "Validation: format vs policy".
 */

import type { StaticFile } from '@shipstatic/types';
import { assertShipJsonSyntax, DEPLOYMENT_CONFIG_FILENAME } from '@shipstatic/types';

// The label and password checks are the types-tier definitions, re-exported
// so SDK callers keep one import path. See `@shipstatic/types/CLAUDE.md`
// "Validation: format vs policy".
export { validateLabels, validatePassword } from '@shipstatic/types';

/**
 * Validate a deploy's root `ship.json` — syntax only, never schema.
 *
 * The same format-not-policy split the password and label validators follow,
 * drawn one layer further out: ship.json's schema and its compiler live on
 * the server and evolve there, so a client that judged them would reject
 * configs a newer platform accepts. `assertShipJsonSyntax` (the types-tier
 * definition, and the single source of truth) checks only what holds for
 * every past and future schema — the text parses as JSON, and its top level
 * is an object.
 *
 * Scope matches the API's `findDeploymentConfigFile`: the exact name at the
 * deploy root, so a `config/ship.json` stays an ordinary asset the platform
 * never reads. Deploy paths reach here canonical (`normalizeWebPath` strips
 * any leading slash), so the root is the bare name.
 */
export async function validateDeployConfig(files: StaticFile[]): Promise<void> {
  const config = files.find((f) => f.path === DEPLOYMENT_CONFIG_FILENAME);
  if (!config) return;

  // Node hands the pipeline a `Buffer`; the browser a `File`/`Blob`, which is
  // the only one of the two carrying `.text()`.
  const content = config.content as Blob;
  const text =
    typeof content.text === 'function'
      ? await content.text()
      : (config.content as Buffer).toString('utf8');

  assertShipJsonSyntax(text);
}
