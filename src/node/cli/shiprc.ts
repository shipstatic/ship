/**
 * @file File-based configuration for the `ship` CLI.
 *
 * The CLI is the only place that touches the filesystem for credentials — the
 * SDK reads only `SHIP_*` env vars. That separation is what makes
 * `new Ship({})` safe in embedded hosts (MCP, n8n, the GitHub Action): the SDK
 * cannot reach a developer's dotfile.
 *
 * **Two locations, and no repository file is one of them:**
 *   1. `~/.shiprc` — the ambient config, written by `ship config`
 *   2. whatever `--config <file>` names — any path, read exactly
 *
 * Strict JSON. An empty file is an ABSENT config, not a broken one.
 *
 * A project-level search (`./.shiprc`, `package.json` `"ship"`, walking up)
 * used to sit in front of both, via cosmiconfig. It was deleted in 2.0.0
 * because its only capability was the anti-pattern: a repository-controlled
 * file supplying credentials. See CLAUDE.md, "no repository file is ever
 * read", for the two verified exploits and why patching them was the wrong
 * shape of fix.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ShipError } from '@shipstatic/types';
import { z } from 'zod';
import { CREDENTIAL_FIELDS } from '../../shared/core/credential-schema.js';
import type { ShipClientOptions } from '../../shared/types.js';

// `.strict()` rejects unknown keys — catches typos like `apikey` (lowercase)
// in user-authored `.shiprc` files. The env reader doesn't need this because
// its input is exactly the two SHIP_* vars we read.
const FileConfigSchema = z.object(CREDENTIAL_FIELDS).strict();

/** The one ambient config file. */
const homeConfigPath = () => join(homedir(), '.shiprc');

const detail = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Parse ONE config file into its raw object — the FORMAT half of reading one,
 * with no opinion on the contents.
 *
 * Exported because `ship config` REWRITES this file, and a writer that parses
 * by different rules than the reader is a divergence waiting to be a bug. The
 * SCHEMA half deliberately stays out: the reader validates and rejects, the
 * writer repairs what the reader rejects (dropping `apiKey` is the whole point
 * of the rename hint). One parse, two policies.
 */
export function parseShipFile(filePath: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (error) {
    throw ShipError.config(`Failed to read ship config (${filePath}): ${detail(error)}`);
  }

  // An empty file is an absent config, not a broken one — `touch ~/.shiprc`
  // and any interrupted write produce one, and both are ordinary.
  if (!raw.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw ShipError.config(`Invalid config in ${filePath}: ${detail(error)}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw ShipError.config(`Invalid config in ${filePath}: expected a JSON object`);
  }
  return parsed as Record<string, unknown>;
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
 * Load configuration from `~/.shiprc`, or from the file `--config` names.
 *
 * | Mode | Behavior |
 * |------|----------|
 * | No `~/.shiprc` | Returns `{}` — file config is optional |
 * | `--config <path>` and the file does not exist | Throws — a typo'd path is a clear user error, not a silent fallback to a downstream "auth failed" |
 * | Unreadable, or not JSON, or not an object | Throws, naming the file |
 * | Empty file | Returns `{}` — absent, not broken |
 * | Fails schema validation | Throws with the offending field path |
 */
export function loadShipFile(configFile?: string): Partial<ShipClientOptions> {
  // Empty path is treated as absence — matches credential-flag handling
  // (`--token ""` falls through to env). A user passing `--config "$VAR"`
  // with `VAR` unset gets `--config ""`, which should not error.
  const explicit = configFile || undefined;
  if (explicit) return validateConfig(parseShipFile(explicit), explicit);

  const home = homeConfigPath();
  return existsSync(home) ? validateConfig(parseShipFile(home), home) : {};
}
