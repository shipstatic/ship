/**
 * @file The `ship config` wizard — the only WRITER of the file `shiprc.ts` is
 * the only reader of. Writes `~/.shiprc`, or the file `--config` names.
 *
 * Three rules, each bought with a shipped bug (CLAUDE.md, "one file, two
 * commands, one idea of what it is"):
 *
 * - **One parse.** The format question is answered once, by the reader's
 *   `parseShipFile`. A private parser here means a file that loads everywhere
 *   and is called broken by the one command whose job is to repair it.
 * - **The schema is the file.** `CREDENTIAL_FIELDS` is `.strict()`, so its
 *   keys are not the fields we care about — they are the only fields a
 *   `.shiprc` may legally hold. The wizard rebuilds from those keys rather
 *   than mutating what it read, which is what makes the loader's `apiKey`
 *   rename hint true instead of a loop.
 * - **Refuse, never replace.** A file we cannot read is a file whose contents
 *   we cannot claim to preserve.
 *
 * The schema half stays split on purpose: the reader validates and rejects,
 * this writer repairs what the reader rejects.
 */

import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { isShipError, MY_API_KEY_URL, ShipError, validateToken } from '@shipstatic/types';
import { dim, green } from 'yoctocolors';
import { CREDENTIAL_FIELDS } from '../../shared/core/credential-schema.js';
import { parseShipFile } from './shiprc.js';
import { warn } from './utils.js';

/**
 * Every key a `.shiprc` may hold — read from the loader's own schema rather
 * than restated here, so the writer cannot come to permit a key the reader
 * rejects.
 */
const ALLOWED_KEYS = Object.keys(CREDENTIAL_FIELDS);

/** Where `ship config` writes when `--config` names no file. */
const defaultConfigPath = () => join(homedir(), '.shiprc');

/**
 * Mask a token for display: ship-a1b2...c3d4. A token too short to keep a
 * useful prefix + suffix is masked entirely — never printed verbatim.
 */
function maskToken(token: string): string {
  if (token.length < 13) return '...';
  return `${token.slice(0, 9)}...${token.slice(-4)}`;
}

/**
 * Read the file this command is about to REWRITE — through the READER's parse,
 * never a second one.
 *
 * A private parser here would be a second answer to the format question, and
 * a file that loads everywhere would be called broken by the one command whose
 * job is to repair it. See CLAUDE.md, "one file, two commands".
 *
 * What this adds is the fact only a WRITER can state: nothing was written.
 * That is the whole reason to refuse rather than replace.
 */
function readExistingConfig(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) return {};
  try {
    return parseShipFile(configPath);
  } catch (err) {
    if (!isShipError(err)) throw err;
    throw ShipError.config(`${err.message} — the file was left unchanged`);
  }
}

/**
 * Run the interactive config flow.
 *
 * Asks for a token, keeps the fields the schema permits, and writes the file.
 */
export async function runConfig(
  options: { noColor?: boolean; configFile?: string } = {},
): Promise<void> {
  const { noColor } = options;
  // `--config <file>` means "exactly this file" for reading, so it means the
  // same for writing. Without it this command could only ever maintain
  // `~/.shiprc`, which is half a feature beside a loader that takes any path.
  const configPath = options.configFile || defaultConfigPath();
  const applyDim = (text: string) => (noColor ? text : dim(text));
  const applyGreen = (text: string) => (noColor ? text : green(text));

  const existing = readExistingConfig(configPath);
  const existingToken = typeof existing.token === 'string' ? existing.token : undefined;
  const dropped = Object.keys(existing).filter((key) => !ALLOWED_KEYS.includes(key));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('');
  console.log(`  ${applyDim('Create a free API key at')} ${MY_API_KEY_URL}`);
  console.log('');

  const prompt = existingToken ? `  Token (${applyDim(maskToken(existingToken))}): ` : '  Token: ';

  let input: string;
  try {
    input = (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }

  // Before anything is written: a rejected token must leave the file untouched.
  if (input) validateToken(input);

  // Rebuilt from the schema's keys rather than mutated in place, so a key the
  // loader would reject cannot survive the rewrite. Dropping one IS the repair
  // the rename hint promises — but it is still the removal of something the
  // user typed, so it is said out loud rather than done quietly.
  const config: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    if (existing[key] !== undefined) config[key] = existing[key];
  }
  if (input) config.token = input;

  if (dropped.length > 0) {
    warn(
      `dropped ${dropped.map((key) => `"${key}"`).join(', ')} — a ship config holds only ${ALLOWED_KEYS.join(' and ')}`,
      false,
      noColor,
    );
  }

  // The file holds a credential: owner-only, like ~/.netrc. `mode` only
  // applies on creation, so chmod repairs files written before this rule.
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(configPath, 0o600);
  console.log(`\n  ${applyGreen('saved to')} ${applyDim(configPath)}\n`);
}
