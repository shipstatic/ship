import { describe, it, expect } from 'vitest';
import { pluralize } from '../../../src/shared/lib/text';

describe('Text Utilities', () => {
  describe('pluralize', () => {
    it('should return singular form for count 1', () => {
      expect(pluralize(1, 'file', 'files')).toBe('1 file');
    });

    it('should return plural form for count 0', () => {
      expect(pluralize(0, 'file', 'files')).toBe('0 files');
    });

    it('should return plural form for count > 1', () => {
      expect(pluralize(2, 'file', 'files')).toBe('2 files');
      expect(pluralize(10, 'item', 'items')).toBe('10 items');
    });

    it('should handle negative counts as plural (conventionally)', () => {
      expect(pluralize(-1, 'error', 'errors')).toBe('-1 errors');
      expect(pluralize(-5, 'warning', 'warnings')).toBe('-5 warnings');
    });

    it('should omit count if includeCount is false', () => {
      expect(pluralize(1, 'file', 'files', false)).toBe('file');
      expect(pluralize(5, 'file', 'files', false)).toBe('files');
      expect(pluralize(0, 'file', 'files', false)).toBe('files');
    });

    it('should work with different singular/plural forms', () => {
      expect(pluralize(1, 'box', 'boxes')).toBe('1 box');
      expect(pluralize(3, 'box', 'boxes')).toBe('3 boxes');
      expect(pluralize(1, 'mouse', 'mice')).toBe('1 mouse');
      expect(pluralize(4, 'mouse', 'mice')).toBe('4 mice');
    });
  });
});
