/**
 * @file Subject: `src/browser/index.ts`, the entry with no filesystem code.
 *
 * It adds nothing to the shared SDK, and these rows hold exactly that: its
 * `Ship` is the shared class, and its names are the shared names. What the
 * class does is `tests/shared/ship*.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import * as entry from '../../src/browser/index';
import * as shared from '../../src/shared/index';
import { Ship } from '../../src/shared/ship';

describe('the entry with no filesystem code', () => {
  it('publishes the shared Ship class itself, by name and as the default', () => {
    expect(entry.Ship).toBe(Ship);
    expect(entry.default).toBe(Ship);
  });

  it('publishes the shared names beside it, and nothing else', () => {
    expect(Object.keys(entry).sort()).toEqual([...Object.keys(shared), 'Ship', 'default'].sort());
  });
});
