/**
 * @file Pure function unit tests
 * Based on feedback: Focus unit tests on pure, stateless functions
 * Fast, reliable, and easy to reason about
 */

import { ErrorType, ShipError } from '@shipstatic/types';
import { describe, expect, it, vi } from 'vitest';
import {
  error,
  formatDetails,
  formatTable,
  formatTimestamp,
  info,
  success,
  warn,
} from '../../../src/node/cli/utils';

describe('CLI Pure Functions', () => {
  describe('formatTimestamp', () => {
    it('should return "-" for zero timestamp', () => {
      expect(formatTimestamp(0)).toBe('-');
    });

    it('should return "-" for undefined timestamp', () => {
      expect(formatTimestamp(undefined)).toBe('-');
    });

    it('should return "-" for null timestamp', () => {
      expect(formatTimestamp(null as any)).toBe('-');
    });

    it('should format unix timestamp to ISO string without milliseconds', async () => {
      // January 1, 2022 00:00:00 UTC
      const timestamp = 1640995200;
      const result = formatTimestamp(timestamp);
      expect(result).toBe('2022-01-01T00:00:00Z');
    });

    it('should handle table context with hidden T and Z', async () => {
      const timestamp = 1640995200;
      const result = formatTimestamp(timestamp, 'table');
      // Should still be valid ISO format but with hidden chars for display
      expect(result).toContain('2022-01-01');
      expect(result).toContain('00:00:00');
    });

    it('should handle details context normally', async () => {
      const timestamp = 1640995200;
      const result = formatTimestamp(timestamp, 'details');
      expect(result).toBe('2022-01-01T00:00:00Z');
    });
  });

  describe('Message formatting functions', () => {
    // These tests verify the functions work without actually printing
    // by capturing the behavior through return values or side effects

    it('success should format message correctly in non-JSON mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      success('deployment created ✨', false);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('deployment created ✨'));
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('\n'), // Should end with newline
      );

      consoleSpy.mockRestore();
    });

    it('success should format message correctly in JSON mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      success('deployment created ✨', true);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"success"'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"deployment created ✨"'));

      consoleSpy.mockRestore();
    });

    it('error should format message correctly in non-JSON mode', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      error('something went wrong', false);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('something went wrong'));

      consoleSpy.mockRestore();
    });

    // The JSON channel transmits the platform's `ErrorResponse` verbatim: the
    // `error` key names the ErrorType, never the message. It carried prose
    // until 2026-07-29, which left `--json` consumers nothing to branch on but
    // the sentence — against the platform's own "branch on type / status,
    // never on message strings" law.
    it('error should emit the wire ErrorResponse in JSON mode', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      error(ShipError.notFound('Deployment', 'nope'), true);

      const parsed = JSON.parse(consoleSpy.mock.calls[0][0] as string);
      expect(parsed).toEqual({
        error: ErrorType.NotFound,
        message: 'Deployment nope not found',
        status: 404,
        details: undefined,
      });

      consoleSpy.mockRestore();
    });

    it('error carries details through the JSON channel', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      error(ShipError.rateLimit('Too many requests', { retryAfter: 30 }), true);

      const parsed = JSON.parse(consoleSpy.mock.calls[0][0] as string);
      expect(parsed.error).toBe(ErrorType.RateLimit);
      expect(parsed.details).toEqual({ retryAfter: 30 });

      consoleSpy.mockRestore();
    });

    it('error strips internal auth telemetry in JSON mode (toResponse owns it)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      error(ShipError.authentication('Authentication failed', { internal: 'jwt_missing' }), true);

      const parsed = JSON.parse(consoleSpy.mock.calls[0][0] as string);
      expect(parsed.error).toBe(ErrorType.Authentication);
      expect(parsed.details).toBeUndefined();

      consoleSpy.mockRestore();
    });

    it('error renders a ShipError message in text mode', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      error(ShipError.validation('bad input'), false);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('bad input'));

      consoleSpy.mockRestore();
    });

    it('warn should format message correctly in non-JSON mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      warn('cache miss detected', false);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('cache miss detected'));

      consoleSpy.mockRestore();
    });

    it('info should format message correctly in non-JSON mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      info('processing files', false);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('processing files'));

      consoleSpy.mockRestore();
    });
  });

  describe('formatTable', () => {
    it('should return empty string for empty data', async () => {
      expect(formatTable([])).toBe('');
      expect(formatTable(null as any)).toBe('');
      expect(formatTable(undefined as any)).toBe('');
    });

    it('should format simple table with string values', async () => {
      const data = [
        { name: 'app1', endpoint: 'https://app1.example.com' },
        { name: 'app2', endpoint: 'https://app2.example.com' },
      ];

      const result = formatTable(data);

      // Should contain headers
      expect(result).toContain('name');
      expect(result).toContain('endpoint');

      // Should contain data
      expect(result).toContain('app1');
      expect(result).toContain('app2');
      expect(result).toContain('https://app1.example.com');
      expect(result).toContain('https://app2.example.com');

      // Should have proper column separation (3 spaces) - account for ANSI codes
      expect(result).toMatch(/name.*endpoint/);
    });

    it('should handle mixed data types correctly', async () => {
      const data = [
        { id: 'abc123', count: 42, active: true, size: null },
        { id: 'def456', count: 0, active: false, size: undefined },
      ];

      const result = formatTable(data);

      expect(result).toContain('abc123');
      expect(result).toContain('42');
      expect(result).toContain('true');
      expect(result).toContain('def456');
      expect(result).toContain('0');
      expect(result).toContain('false');
    });

    it('should use custom column order when provided', async () => {
      const data = [
        { created: '2022-01-01', name: 'test1', id: 'abc123' },
        { created: '2022-01-02', name: 'test2', id: 'def456' },
      ];

      const result = formatTable(data, ['name', 'id', 'created']);

      // Should start with name column - account for ANSI codes
      expect(result).toMatch(/name/);
      // Should not start with created (which would be natural order)
      expect(result).not.toMatch(/^created/);
    });

    it('should filter out internal properties by default', async () => {
      const data = [
        {
          name: 'test',
          isCreate: false, // Should be filtered (internal field)
          url: 'example.com',
        },
      ];

      const result = formatTable(data);

      expect(result).toContain('name');
      expect(result).toContain('url');
      expect(result).not.toContain('isCreate');
    });

    it('should preserve property order from first item', async () => {
      const data = [{ z_last: 'last', a_first: 'first', m_middle: 'middle' }];

      const result = formatTable(data);
      const lines = result.split('\n');
      const headerLine = lines[0];

      // Should maintain insertion order: z_last, a_first, m_middle
      // Extract headers by removing ANSI codes first
      const cleanLine = headerLine.replace(/\u001b\[[0-9;]*m/g, '');
      const headers = cleanLine.split(/\s{2,}/);
      expect(headers[0].trim()).toBe('z_last');
      expect(headers[1].trim()).toBe('a_first');
      expect(headers[2].trim()).toBe('m_middle');
    });

    it('should handle empty values gracefully', async () => {
      const data = [
        { name: '', site: 'test.com', count: 0 },
        { name: 'app', site: '', count: null },
      ];

      const result = formatTable(data);

      // Should not break on empty strings or null values
      expect(result).toContain('name');
      expect(result).toContain('site');
      expect(result).toContain('count');
      expect(result).toContain('app');
      expect(result).toContain('test.com');
    });
  });

  describe('formatDetails nested objects', () => {
    // The details view is a flat key-value surface; nested objects flatten
    // into their cell. `Account.usage` (rendered by `ship whoami`) is the
    // shape this exists for.
    it('renders a nested metrics object as inline key=value pairs', () => {
      const result = formatDetails({ plan: 'sponsored', usage: { customDomains: 0 } }, true);

      expect(result).toContain('customDomains=0');
      expect(result).not.toContain('[object Object]');
    });

    it('renders multi-key objects comma-separated', () => {
      const result = formatDetails({ usage: { customDomains: 2, sites: 7 } }, true);

      expect(result).toContain('customDomains=2, sites=7');
    });

    it('renders an empty object as the standard empty marker', () => {
      const result = formatDetails({ usage: {} }, true);

      expect(result).toContain('-');
      expect(result).not.toContain('[object Object]');
    });

    it('leaves arrays on their existing comma-joined rendering', () => {
      const result = formatDetails({ labels: ['a', 'b'] }, true);

      expect(result).toContain('a,b');
    });
  });
});
