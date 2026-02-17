/**
 * @file Interactive config file creation for `ship config`.
 * Asks for API key, merges into existing ~/.shiprc, preserves all other fields.
 * Uses Node.js built-in readline/promises — zero additional dependencies.
 */

import { createInterface } from 'node:readline/promises';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { DEFAULT_API, validateApiKey } from '@shipstatic/types';
import { dim, green } from 'yoctocolors';

/** Path to the global config file */
const CONFIG_PATH = join(homedir(), '.shiprc');

/**
 * Mask an API key for display: ship-a1b2...c3d4
 */
function maskApiKey(key: string): string {
  if (key.length < 13) return key;
  return key.slice(0, 9) + '...' + key.slice(-4);
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
 * Asks for API key, merges into existing config, writes ~/.shiprc.
 */
export async function runConfig(options: { noColor?: boolean; json?: boolean } = {}): Promise<void> {
  const { noColor, json } = options;
  const applyDim = (text: string) => noColor ? text : dim(text);
  const applyGreen = (text: string) => noColor ? text : green(text);

  // JSON mode: show current config status
  if (json) {
    const existing = readExistingConfig();
    const apiKey = typeof existing.apiKey === 'string' ? existing.apiKey : undefined;
    const apiUrl = typeof existing.apiUrl === 'string' ? existing.apiUrl : undefined;
    console.log(JSON.stringify({
      path: CONFIG_PATH,
      exists: existsSync(CONFIG_PATH),
      ...(apiKey ? { apiKey: maskApiKey(apiKey) } : {}),
      ...(apiUrl && apiUrl !== DEFAULT_API ? { apiUrl } : {}),
    }, null, 2) + '\n');
    return;
  }

  const existing = readExistingConfig();
  const existingApiKey = typeof existing.apiKey === 'string' ? existing.apiKey : undefined;

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('');

  const prompt = existingApiKey
    ? `  API Key (${applyDim(maskApiKey(existingApiKey))}): `
    : '  API Key: ';

  let input: string;
  try {
    input = (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }

  if (input) {
    validateApiKey(input);
    existing.apiKey = input;
  }

  writeFileSync(CONFIG_PATH, JSON.stringify(existing, null, 2) + '\n');
  console.log(`\n  ${applyGreen('saved to')} ${applyDim(CONFIG_PATH)}\n`);
}
