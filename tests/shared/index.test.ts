/**
 * @file Subject: `src/shared/index.ts`, the entry with no filesystem code,
 * and what the Node entry publishes beside its own `Ship`.
 *
 * What the class does is `tests/shared/ship*.test.ts`, and the names the
 * built entries publish are held whole by `tests/package/dist-entries.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import * as node from '../../src/node/index';
import * as entry from '../../src/shared/index';
import { Ship } from '../../src/shared/ship';

describe('the entry with no filesystem code', () => {
  it('publishes the shared Ship class, by name and as the default', () => {
    expect(entry.Ship).toBe(Ship);
    expect(entry.default).toBe(Ship);
  });

  it('gives the Node entry every name but Ship, which Node replaces with its own', () => {
    const { Ship: nodeShip, default: nodeDefault, ...beside } = node;
    const { Ship: _ship, default: _default, ...shared } = entry;

    expect(beside).toEqual(shared);
    expect(nodeDefault).toBe(nodeShip);
    expect(Object.getPrototypeOf(nodeShip)).toBe(Ship);
  });
});
