/**
 * @file Interactive config file creation for `ship config`.
 *
 * Writes `~/.shiprc`, or the file `--config` names. Uses Node.js built-in
 * readline/promises — zero additional dependencies.
 *
 * **This command is the only WRITER of the file `shiprc.ts` is the only READER
 * of, so the two must not hold different ideas of what that file is.** They
 * did until 2026-07-30, in both directions, and both were user-visible:
 *
 * - The reader parses with cosmiconfig and validates against the credential
 *   schema; this writer parsed with a bare `JSON.parse` inside a
 *   `catch → {}`. So a `.shiprc` the reader rejected by name — "Invalid
 *   config in …" — was read here as "no existing config", and the wizard
 *   wrote `{}` over it: token and apiUrl gone, under a `saved to …` message.
 *   The natural response to the reader's error is to run this command, which
 *   made the repair path the destructive one.
 * - Going the other way, "preserve every other field" preserved fields that
 *   make the file UNLOADABLE. The reader's own rename hint reads `"apiKey" is
 *   no longer supported — the key is now "token". Run \`ship config\` to
 *   rewrite it`; doing so wrote `token` and kept `apiKey`, so the very next
 *   command failed with the identical error. The advice was a loop.
 *
 * Both are one rule now: **the schema is the file.** `CREDENTIAL_FIELDS` is
 * `.strict()`, so `token` and `apiUrl` are not merely the fields we care
 * about — they are the only fields a `.shiprc` may legally hold. This writer
 * keeps exactly those and drops the rest, which is what makes the rename hint
 * true. And it refuses what it cannot parse rather than replacing it, because
 * a file we cannot read is a file whose contents we cannot claim to preserve.
 *
 * The FORMAT half is shared outright: `readExistingConfig` calls the reader's
 * own `parseShipFile`. The first fix of this pair kept a bare `JSON.parse`
 * here, which merely moved the divergence down a layer — an empty `.shiprc`
 * (`touch`, or an interrupted write) read as absent everywhere and as broken
 * here. **One parse, two policies:** the reader validates and rejects, the
 * writer repairs what the reader rejects.
 */

import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { DEFAULT_API, isShipError, ShipError, validateToken } from '@shipstatic/types';
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
 * A bare `JSON.parse` sat here until 2026-07-30 and was a third parsing rule
 * for a file that must have exactly one: the reader takes YAML (a JSON
 * superset), so `token: ship-…` and, more commonly, an EMPTY file — `touch
 * ~/.shiprc`, or any interrupted write — loaded fine everywhere and came back
 * "Invalid config in …" from the one command whose job is to fix it.
 *
 * What it still adds is the fact only a WRITER can state: nothing was written.
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
  options: { noColor?: boolean; json?: boolean; configFile?: string } = {},
): Promise<void> {
  const { noColor, json } = options;
  // `--config <file>` means "exactly this file" for reading, so it means the
  // same for writing. Without it this command could only ever maintain
  // `~/.shiprc`, which is half a feature beside a loader that takes any path.
  const configPath = options.configFile || defaultConfigPath();
  const applyDim = (text: string) => (noColor ? text : dim(text));
  const applyGreen = (text: string) => (noColor ? text : green(text));

  // JSON mode: show current config status
  if (json) {
    const existing = readExistingConfig(configPath);
    const token = typeof existing.token === 'string' ? existing.token : undefined;
    const apiUrl = typeof existing.apiUrl === 'string' ? existing.apiUrl : undefined;
    console.log(
      `${JSON.stringify(
        {
          path: configPath,
          exists: existsSync(configPath),
          ...(token ? { token: maskToken(token) } : {}),
          ...(apiUrl && apiUrl !== DEFAULT_API ? { apiUrl } : {}),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const existing = readExistingConfig(configPath);
  const existingToken = typeof existing.token === 'string' ? existing.token : undefined;
  const dropped = Object.keys(existing).filter((key) => !ALLOWED_KEYS.includes(key));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('');
  console.log(`  ${applyDim('Create a free API key at')} https://my.shipstatic.com/api-key`);
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
