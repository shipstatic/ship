/**
 * @file File-based configuration loader for the `ship` CLI.
 *
 * The CLI is the only place that reads `~/.shiprc` and `package.json` `"ship"` keys.
 * Programmatic SDK consumers never touch the filesystem — they pass options to the
 * `Ship` constructor, optionally falling back to `SHIP_*` environment variables.
 * Keeping file resolution out of the SDK is what makes embedded usage (MCP, n8n,
 * GitHub Action) safe by default: `new Ship({})` cannot accidentally pick up the
 * host developer's `~/.shiprc`.
 *
 * Search order (cosmiconfig defaults):
 *   1. `.shiprc` walking up from CWD to `$HOME`
 *   2. `package.json` `"ship"` key walking up from CWD
 *   3. `$HOME/.shiprc`
 *
 * The `--config <file>` CLI flag bypasses the search and loads a specific path.
 * Any filename works there — `cfg.json`, `.shiprc`, `dev.shiprc`,
 * `prod.shiprc.json` — because the `.shiprc` loader is registered explicitly
 * alongside cosmiconfig's extension defaults (see `loaders` below).
 */

import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { isShipError, ShipError } from '@shipstatic/types';
import { cosmiconfigSync, defaultLoadersSync } from 'cosmiconfig';
import { z } from 'zod';
import { CREDENTIAL_FIELDS } from '../../shared/core/credential-schema.js';
import type { ShipClientOptions } from '../../shared/types.js';

// `.strict()` rejects unknown keys — catches typos like `apikey` (lowercase)
// in user-authored `.shiprc` files. The env reader doesn't need this because
// its input is exactly the two SHIP_* vars we read.
const FileConfigSchema = z.object(CREDENTIAL_FIELDS).strict();

const MODULE_NAME = 'ship';

function createExplorer() {
  const home = homedir();
  return cosmiconfigSync(MODULE_NAME, {
    searchPlaces: [`.${MODULE_NAME}rc`, 'package.json', `${home}/.${MODULE_NAME}rc`],
    stopDir: home,
    // `.shiprc` is a FILENAME here, not an extension — but cosmiconfig's
    // explicit `load(path)` dispatches on `path.extname`, which is `''` for
    // `.shiprc` (Node treats a leading dot as a hidden file) and `'.shiprc'`
    // for `dev.shiprc`. So the search worked while `--config dev.shiprc` threw
    // `No loader specified for extension ".shiprc"` — and `dev.shiprc` /
    // `prod.shiprc` is exactly the convention someone juggling two
    // environments reaches for.
    //
    // Mapped to the SAME loader `noExt` uses, deliberately: one filename
    // convention must mean one format, or `~/.shiprc` and `./dev.shiprc` would
    // parse by different rules. (That loader is YAML, which is a JSON
    // superset — which is why every JSON config in the wild loads through it.)
    loaders: { [`.${MODULE_NAME}rc`]: defaultLoadersSync.noExt },
  });
}

/**
 * Run a cosmiconfig operation, normalizing any failure (missing explicit path,
 * unparseable content, permissions) into the platform's config error.
 * Surfacing it beats a confusing "auth failed" later.
 */
function attempt<T>(where: string, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (isShipError(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw ShipError.config(`Failed to read ship config${where}: ${message}`);
  }
}

/**
 * Parse ONE config file into its raw object — the FORMAT half of reading one,
 * with no opinion on the contents.
 *
 * **Exported because `ship config` REWRITES this file, and a writer that
 * parses by different rules than the reader is the same divergence in a new
 * place.** It did until 2026-07-30: the wizard used a bare `JSON.parse`, so a
 * `.shiprc` every read path loaded happily — a YAML-style `token: ship-…`, or
 * simply an EMPTY file, which `touch ~/.shiprc` and any interrupted write
 * produce — came back "Invalid config in …" from the one command whose job is
 * to fix it. Safe (it refuses rather than destroys), but incoherent: the file
 * was fine.
 *
 * The schema half deliberately does NOT move here. The reader validates and
 * rejects; the writer repairs what the reader rejects — dropping `apiKey` is
 * the whole point of the rename hint. One parse, two policies.
 */
export function parseShipFile(filePath: string): Record<string, unknown> {
  const result = attempt(` (${filePath})`, () => createExplorer().load(filePath));

  // The same falsy test the search path uses, deliberately: an empty file is an
  // ABSENT config, not a broken one.
  const config = result?.config;
  if (!config) return {};

  if (typeof config !== 'object' || Array.isArray(config)) {
    throw ShipError.config(`Invalid config in ${filePath}: expected a mapping of keys to values`);
  }
  return config as Record<string, unknown>;
}

/**
 * A path reduced to its canonical form, falling back to lexical resolution
 * when it does not exist (nothing to follow).
 */
const canonicalPath = (target: string): string => {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
};

/**
 * A PROJECT config may name a credential. It may not name the ENDPOINT that
 * credential is sent to.
 *
 * The search reaches `./.shiprc` and `package.json` before `$HOME/.shiprc`,
 * which is the right precedence for configuration and the wrong one for a
 * destination: a repository you cloned would otherwise choose where your
 * `SHIP_TOKEN` goes. Verified 2026-07-30 — a `package.json` carrying
 * `{"ship": {"apiUrl": "http://…"}}` sent `Authorization: Bearer <the user's
 * API key>` to that host on a plain `ship deployments list`, exit 0, no
 * warning. `git clone && cd && ship ./dist` is the persona's actual flow, and
 * it needs no `npm install` to get there.
 *
 * npm is the near analogue and it defends this case rather than permitting it:
 * a project `.npmrc` may set `registry`, but auth is bound to the registry
 * (`//host/:_authToken`), so a redirect does not carry the credential. One
 * unscoped bearer plus a project-settable endpoint is the combination that
 * has to be broken, and the endpoint is the half with no legitimate use —
 * `--api-url` is documented "(for development)".
 *
 * Refused loudly rather than dropped silently: a config that does not do what
 * it says is how someone ends up debugging the wrong thing. `--config <file>`
 * is exempt because naming a file IS the user's intent, and so is
 * `~/.shiprc`, which is the user's own.
 */
function refuseProjectApiUrl(config: unknown, filepath: string): unknown {
  // Compared CANONICALLY, which is load-bearing rather than defensive: on
  // macOS `/var` and `/tmp` are symlinks, so cosmiconfig reports
  // `/private/var/…/.shiprc` where `homedir()` says `/var/…`. A textual
  // comparison would call the user's OWN home file a project file and refuse
  // the endpoint they set themselves — caught by the home-file test below.
  if (canonicalPath(filepath) === canonicalPath(path.join(homedir(), `.${MODULE_NAME}rc`))) {
    return config;
  }

  const apiUrl = (config as Record<string, unknown> | null)?.apiUrl;
  if (apiUrl !== undefined) {
    throw ShipError.config(
      `Invalid config in ${filepath}: "apiUrl" may not come from a project config — the endpoint your credential is sent to must not be chosen by the repository. Use --api-url, SHIP_API_URL, or ~/.${MODULE_NAME}rc.`,
    );
  }
  return config;
}

/** Validate a parsed config against the credential schema. */
function validateConfig(config: unknown, filepath: string): Partial<ShipClientOptions> {
  try {
    return FileConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      // Keys from retired credential vocabularies get a rename hint instead
      // of a bare rejection — the fix is one edit, so the error names it.
      if (issue.code === 'unrecognized_keys') {
        const legacy = issue.keys.filter((key) => key === 'apiKey' || key === 'deployToken');
        if (legacy.length > 0) {
          const keys = legacy.map((key) => `"${key}"`).join(' and ');
          throw ShipError.config(
            `Invalid config in ${filepath}: ${keys} ${legacy.length > 1 ? 'are' : 'is'} no longer supported — the key is now "token". Run \`ship config\` to rewrite it.`,
          );
        }
      }
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      throw ShipError.config(`Invalid config in ${filepath}${path}: ${issue.message}`);
    }
    throw ShipError.config(`Invalid config in ${filepath}`);
  }
}

/**
 * Load configuration from `.shiprc` / `package.json`.
 *
 * Error semantics by failure mode:
 *
 * | Mode | Behavior |
 * |------|----------|
 * | Search finds no file | Returns `{}` — file config is optional |
 * | `--config <path>` and the file does not exist | Throws — a typo'd path is a clear user error and shouldn't be hidden behind a downstream auth failure |
 * | File found but unparseable JSON / unreadable (permissions) | Throws — silent swallowing left users debugging "wrong API key" when the real issue was their config |
 * | File parsed but fails schema validation | Throws with the offending field path |
 * | A PROJECT file sets `apiUrl` | Throws — see {@link refuseProjectApiUrl} |
 *
 * @param configFile - Optional explicit path (from the CLI's `--config` flag).
 *   When provided, cosmiconfig loads exactly that file instead of searching.
 * @returns Validated config, or `{}` if no file was found in the search.
 * @throws {ShipError} for explicit-path failures, parse errors, or schema violations.
 */
export function loadShipFile(configFile?: string): Partial<ShipClientOptions> {
  // Empty path is treated as absence — matches credential-flag handling
  // (`--token ""` falls through to env). A user passing `--config "$VAR"`
  // with `VAR` unset gets `--config ""`, which should not error: it should
  // fall through to the normal cosmiconfig search.
  const explicitPath = configFile || undefined;

  // An explicit path shares its parse with the writer, literally — this is the
  // case `--config` names and the case `ship config` rewrites.
  if (explicitPath) {
    return validateConfig(parseShipFile(explicitPath), explicitPath);
  }

  const result = attempt('', () => createExplorer().search());
  if (!result?.config) return {};
  return validateConfig(refuseProjectApiUrl(result.config, result.filepath), result.filepath);
}
