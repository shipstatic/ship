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
 */

import { homedir } from 'node:os';
import { isShipError, ShipError } from '@shipstatic/types';
import { cosmiconfigSync } from 'cosmiconfig';
import { z } from 'zod';
import { CREDENTIAL_FIELDS } from '../../shared/core/credential-schema.js';
import type { ShipClientOptions } from '../../shared/types.js';

// `.strict()` rejects unknown keys — catches typos like `apikey` (lowercase)
// in user-authored `.shiprc` files. The env reader doesn't need this because
// its input is exactly the two SHIP_* vars we read.
const FileConfigSchema = z.object(CREDENTIAL_FIELDS).strict();

const MODULE_NAME = 'ship';

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

  const home = homedir();
  const explorer = cosmiconfigSync(MODULE_NAME, {
    searchPlaces: [`.${MODULE_NAME}rc`, 'package.json', `${home}/.${MODULE_NAME}rc`],
    stopDir: home,
  });

  let result: ReturnType<typeof explorer.search>;
  try {
    result = explicitPath ? explorer.load(explicitPath) : explorer.search();
  } catch (error) {
    if (isShipError(error)) throw error;
    // Wrap any cosmiconfig failure (missing explicit path, bad JSON, permissions)
    // in a ShipError. Surfacing this beats a confusing "auth failed" later.
    const message = error instanceof Error ? error.message : String(error);
    const where = explicitPath ? ` (${explicitPath})` : '';
    throw ShipError.config(`Failed to read ship config${where}: ${message}`);
  }

  if (!result?.config) return {};

  try {
    return FileConfigSchema.parse(result.config);
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
            `Invalid config in ${result.filepath}: ${keys} ${legacy.length > 1 ? 'are' : 'is'} no longer supported — the key is now "token". Run \`ship config\` to rewrite it.`,
          );
        }
      }
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      throw ShipError.config(`Invalid config in ${result.filepath}${path}: ${issue.message}`);
    }
    throw ShipError.config(`Invalid config in ${result.filepath}`);
  }
}
