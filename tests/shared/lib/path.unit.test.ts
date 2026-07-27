/**
 * @file Subject: `src/shared/lib/path.ts` — `findCommonParent`, the basis of
 * `pathDetect`: the prefix stripped from every deploy path so a deployment's
 * root is the site's root.
 *
 * Rewritten 2026-07-27. Every call in the previous version passed a second
 * `separator` argument — `findCommonParent(paths, separator)` — which the
 * function has never accepted. TypeScript would have said so, but `tests/**`
 * sat outside `pnpm typecheck`; at runtime the extra argument was simply
 * ignored. So the two describes the file was structured around, "browser
 * environment (forward slash separator)" and "Node.js environment
 * (OS-specific separator)", ran the SAME code path with a decorative
 * parameter — and cross-environment consistency, the file's stated subject,
 * was the one thing it could not have detected a failure in.
 *
 * The real contract is separator-agnostic by construction: the function
 * normalizes `\` to `/` before comparing, so MIXED input is the interesting
 * case, not two parallel suites.
 */

import { describe, expect, it } from 'vitest';
import { findCommonParent } from '../../../src/shared/lib/path';

describe('findCommonParent', () => {
  describe('degenerate input', () => {
    it.each([
      ['no paths', []],
      ['an empty string', ['']],
      ['a null entry', [null as unknown as string]],
      ['an undefined entry', [undefined as unknown as string]],
    ])('returns empty for %s', (_name, input) => {
      expect(findCommonParent(input)).toBe('');
    });
  });

  describe('a single directory is its own common parent', () => {
    it.each([
      ['posix', '/app/public', '/app/public'],
      ['windows', 'C:\\app\\public', 'C:/app/public'],
      ['relative', 'app/public', 'app/public'],
    ])('%s', (_name, input, expected) => {
      expect(findCommonParent([input])).toBe(expected);
    });
  });

  describe('common prefix', () => {
    it('finds the shared directory', () => {
      expect(findCommonParent(['app/public', 'app/public'])).toBe('app/public');
    });

    it('stops at the deepest shared segment', () => {
      expect(findCommonParent(['app/public/css', 'app/public/js'])).toBe('app/public');
    });

    it('goes as deep as the paths agree', () => {
      expect(findCommonParent(['app/public/css/vendor', 'app/public/css/site'])).toBe(
        'app/public/css',
      );
    });

    it('returns empty when nothing is shared', () => {
      expect(findCommonParent(['app/public', 'lib/internal'])).toBe('');
    });

    it('does not treat a partial segment name as shared', () => {
      // `app` and `application` share four characters but no directory.
      expect(findCommonParent(['app/public', 'application/public'])).toBe('');
    });
  });

  describe('separator agnosticism (the actual cross-environment contract)', () => {
    it('treats a Windows path and a posix path as the same tree', () => {
      expect(findCommonParent(['app\\public\\css', 'app/public/js'])).toBe('app/public');
    });

    it('normalizes separators mixed WITHIN one path', () => {
      expect(findCommonParent(['app\\public/css', 'app/public\\js'])).toBe('app/public');
    });

    it('always answers with forward slashes, whatever it was given', () => {
      expect(findCommonParent(['C:\\app\\public\\css', 'C:\\app\\public\\js'])).toBe(
        'C:/app/public',
      );
    });
  });
});
