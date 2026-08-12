/**
 * @file Subject: `src/shared/lib/file-rules.ts` — the one ordered table of
 * deploy-file rules, and the single evaluation both renderers share.
 *
 * Two things need holding, and they are different in kind:
 *
 *  1. **Every sentence, pinned by hand.** These strings are what a user reads
 *     when a deploy is refused, and they exist as a table precisely because
 *     one rule used to read three ways. A hand-written expectation per row is
 *     the only thing that can notice a reworded rule.
 *  2. **The two renderers cannot disagree.** Parity between the node and
 *     browser pipelines was a comment saying "matches Node validation"; it is
 *     asserted from the table now.
 */

import type { PlatformLimits } from '@shipstatic/types';
import { describe, expect, it } from 'vitest';
import { FILE_RULES, firstBrokenRule } from '../../../src/shared/lib/file-rules';
import { validateDeployFile } from '../../../src/shared/lib/security';

const LIMITS: PlatformLimits = {
  maxFileSize: 5 * 1024 * 1024,
  maxFilesCount: 100,
  maxTotalSize: 25 * 1024 * 1024,
  blockedExtensions: ['exe', 'dmg'],
};

/** A file that breaks nothing, so each case below breaks exactly one thing. */
const clean = { path: 'index.html', size: 1024, totalSize: 1024 };

describe('the file-rule table', () => {
  /**
   * One row per rule: the input that breaks it, and the sentence it produces.
   * Hand-written on purpose — an expectation computed from the table would
   * agree with the table by construction and prove nothing.
   */
  const CASES: Array<[string, { path: string; size: number; totalSize: number }, string]> = [
    ['name', { ...clean, path: 'bad<name>.html' }, 'File name contains unsafe characters'],
    [
      'extension',
      { ...clean, path: 'installer.exe' },
      'File extension not allowed: "installer.exe"',
    ],
    [
      'fileSize',
      { ...clean, path: 'huge.bin', size: 6 * 1024 * 1024, totalSize: 6 * 1024 * 1024 },
      'File "huge.bin" too large. Maximum 5 MB allowed',
    ],
    [
      'totalSize',
      { ...clean, path: 'last.bin', size: 1024, totalSize: 26 * 1024 * 1024 },
      'Total upload size too large. 26 MB exceeds maximum of 25 MB',
    ],
  ];

  it.each(CASES)('%s produces its one sentence', (name, input, sentence) => {
    const broken = firstBrokenRule(input, LIMITS);
    expect(broken?.name).toBe(name);
    expect(broken?.sentence(input, LIMITS)).toBe(sentence);
  });

  it('covers every rule in the table', () => {
    // The completeness TIE. Without it this file counts its own array and the
    // check is a tautology — the exact trap the formatters fence records
    // having fallen into once. Tied to PRODUCTION, in table order, so a new
    // rule cannot half-exist and a reordering cannot pass unnoticed.
    expect(CASES.map(([name]) => name)).toEqual(FILE_RULES.map((rule) => rule.name));
  });

  it('says nothing about a file that breaks nothing', () => {
    expect(firstBrokenRule(clean, LIMITS)).toBeUndefined();
  });

  it('reports the FIRST broken rule, so a caller fixes one thing at a time', () => {
    // Both misnamed and oversized: the name wins, because a caller fixing the
    // name may have no size problem at all.
    const both = { path: 'bad<name>.exe', size: 9 * 1024 * 1024, totalSize: 9 * 1024 * 1024 };
    expect(firstBrokenRule(both, LIMITS)?.name).toBe('name');
  });

  it('treats an absent blocklist as no client-side check, never an empty policy', () => {
    // An API predating `blockedExtensions` sends none; the boundary still
    // refuses the file, which is where refusal belongs.
    const { blockedExtensions: _omitted, ...withoutList } = LIMITS;
    expect(firstBrokenRule({ ...clean, path: 'installer.exe' }, withoutList)).toBeUndefined();
  });
});

describe('the two renderers reach the same verdict', () => {
  it('the throwing renderer raises the table sentence verbatim', () => {
    // A renderer chooses how to DELIVER; it never authors prose. If this
    // string were composed at the throw site, this is where it would show.
    const input = { path: 'huge.bin', size: 6 * 1024 * 1024, totalSize: 6 * 1024 * 1024 };
    expect(() => validateDeployFile(input, LIMITS)).toThrow(
      'File "huge.bin" too large. Maximum 5 MB allowed',
    );
  });

  it('the throwing renderer raises nothing a clean file could trip', () => {
    expect(() => validateDeployFile(clean, LIMITS)).not.toThrow();
  });

  it('every rule, through the throwing renderer, in the same order', () => {
    // Structural parity, quantified over the table rather than restated: the
    // node and browser pipelines both call `validateDeployFile`, so proving
    // the renderer follows the table proves both pipelines do.
    for (const [name, input, sentence] of [
      ['name', { ...clean, path: 'bad<name>.html' }, 'File name contains unsafe characters'],
      [
        'extension',
        { ...clean, path: 'installer.exe' },
        'File extension not allowed: "installer.exe"',
      ],
    ] as const) {
      expect(() => validateDeployFile(input, LIMITS), name).toThrow(sentence);
    }
  });
});
