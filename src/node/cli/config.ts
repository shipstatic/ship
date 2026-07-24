/**
 * @file Interactive config file creation for `ship config`.
 * Asks for a token, merges into existing ~/.shiprc, preserves all other fields.
 * Uses Node.js built-in readline/promises — zero additional dependencies.
 */

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { DEFAULT_API, validateToken } from '@shipstatic/types';
import { dim, green } from 'yoctocolors';

/** Path to the global config file */
const CONFIG_PATH = join(homedir(), '.shiprc');

/**
 * Mask a token for display: ship-a1b2...c3d4. A token too short to keep a
 * useful prefix + suffix is masked entirely — never printed verbatim.
 */
function maskToken(token: string): string {
  if (token.length < 13) return '...';
  return `${token.slice(0, 9)}...${token.slice(-4)}`;
}

/**
 * Read existing config file, preserving all fields.
 * Returns empty object if file doesn't exist or is invalid.
 */
function readExistingConfig(): Record<string, unknown> {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Run the interactive config flow.
 * Asks for a token, merges into existing config, writes ~/.shiprc.
 */
export async function runConfig(
  options: { noColor?: boolean; json?: boolean } = {},
): Promise<void> {
  const { noColor, json } = options;
  const applyDim = (text: string) => (noColor ? text : dim(text));
  const applyGreen = (text: string) => (noColor ? text : green(text));

  // JSON mode: show current config status
  if (json) {
    const existing = readExistingConfig();
    const token = typeof existing.token === 'string' ? existing.token : undefined;
    const apiUrl = typeof existing.apiUrl === 'string' ? existing.apiUrl : undefined;
    console.log(
      `${JSON.stringify(
        {
          path: CONFIG_PATH,
          exists: existsSync(CONFIG_PATH),
          ...(token ? { token: maskToken(token) } : {}),
          ...(apiUrl && apiUrl !== DEFAULT_API ? { apiUrl } : {}),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const existing = readExistingConfig();
  const existingToken = typeof existing.token === 'string' ? existing.token : undefined;

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

  if (input) {
    validateToken(input);
    existing.token = input;
  }

  // The file holds a credential: owner-only, like ~/.netrc. `mode` only
  // applies on creation, so chmod repairs files written before this rule.
  writeFileSync(CONFIG_PATH, `${JSON.stringify(existing, null, 2)}\n`, { mode: 0o600 });
  chmodSync(CONFIG_PATH, 0o600);
  console.log(`\n  ${applyGreen('saved to')} ${applyDim(CONFIG_PATH)}\n`);
}
