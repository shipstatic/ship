/**
 * @file Fence: the CLI and the SDK reach the same surface.
 *
 * `OUTPUTS` is keyed by `resource.operation`, which is almost literally the
 * SDK's own call shape — `client.deployments.list` ↔ `deployment.list`. That
 * correspondence is the coordination claim, so it is stated once and checked
 * in both directions:
 *
 * - an SDK resource method with no CLI output row is the `tokens get` gap
 *   class: it shipped SDK-first on 2026-07-28 and the CLI followed days later,
 *   during which the command existed but announced nothing and printed nothing
 *   under `-q`;
 * - a CLI row with no SDK method behind it is invented surface — a command
 *   promising an operation the SDK cannot perform.
 *
 * Both sides are enumerated from PRODUCTION. Nothing here restates the command
 * tree: the SDK half is read off a real `Ship` instance and the CLI half off
 * the real table, so a hand-written list cannot drift from either.
 */

import { describe, expect, it } from 'vitest';
import { OUTPUTS } from '../../src/node/cli/formatters';
import { Ship } from '../../src/node/index';

/**
 * Resource methods the SDK exposes but the CLI deliberately does not surface —
 * each a decision, not a patch. Same shape as `HELP_OMISSIONS`.
 *
 * Empty today, and that is the interesting part: every resource method the SDK
 * can perform has a command behind it.
 */
const CLI_OMISSIONS: Readonly<Record<string, string>> = {};

/**
 * CLI rows with no resource method behind them — top-level SDK calls rather
 * than resource calls.
 */
const NOT_RESOURCE_METHODS: Readonly<Record<string, string>> = {
  ping: '`ship.ping()` is a top-level method, not a member of a resource',
};

/** `deployments` → `deployment`: the collection reads plural, the noun does not. */
const singular = (collection: string) => collection.replace(/s$/, '');

/**
 * Every `resource.operation` the SDK can actually perform, read off a real
 * instance. The constructor is synchronous and makes no request (the `/limits`
 * fetch is lazy), so building one in the fence tier is inert — and the
 * hermeticity setup has scrubbed `SHIP_*` besides.
 */
function sdkSurface(): string[] {
  const ship = new Ship({});
  const collections = ['deployments', 'domains', 'tokens', 'account'] as const;

  return collections.flatMap((collection) => {
    const resource = ship[collection] as unknown as Record<string, unknown>;
    return Object.keys(resource)
      .filter((key) => typeof resource[key] === 'function')
      .map((method) => `${singular(collection)}.${method}`);
  });
}

describe('the CLI reaches exactly what the SDK offers', () => {
  const sdk = sdkSurface();
  const cli = Object.keys(OUTPUTS);

  it('finds a non-trivial surface on both sides', () => {
    // Guards the quantifiers: were either enumeration to come back empty, both
    // assertions below would pass while proving nothing at all.
    expect(sdk.length).toBeGreaterThan(15);
    expect(cli.length).toBeGreaterThan(15);
  });

  it('has a CLI output row for every SDK resource method', () => {
    const missing = sdk.filter((key) => !cli.includes(key) && !(key in CLI_OMISSIONS));
    expect(missing, `SDK methods with no CLI row: ${missing.join(', ')}`).toEqual([]);
  });

  it('has an SDK resource method behind every CLI output row', () => {
    const invented = cli.filter((key) => !sdk.includes(key) && !(key in NOT_RESOURCE_METHODS));
    expect(invented, `CLI rows with no SDK method: ${invented.join(', ')}`).toEqual([]);
  });

  it('records every exception with a reason', () => {
    // An exception map that grows silently is how a fence becomes decoration.
    for (const reason of [
      ...Object.values(CLI_OMISSIONS),
      ...Object.values(NOT_RESOURCE_METHODS),
    ]) {
      expect(reason.length).toBeGreaterThan(20);
    }
    expect(Object.keys(CLI_OMISSIONS).length + Object.keys(NOT_RESOURCE_METHODS).length).toBe(1);
  });
});
