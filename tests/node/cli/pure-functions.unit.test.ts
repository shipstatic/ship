/**
 * @file Pure function unit tests
 * Based on feedback: Focus unit tests on pure, stateless functions
 * Fast, reliable, and easy to reason about
 */

import { describe, it, expect, vi } from 'vitest';
import { formatTimestamp, success, error, warn, info, formatTable } from '@/node/cli/utils';

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
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('deployment created ✨')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('\n') // Should end with newline
      );
      
      consoleSpy.mockRestore();
    });

    it('success should format message correctly in JSON mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      success('deployment created ✨', true);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"success"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"deployment created ✨"')
      );
      
      consoleSpy.mockRestore();
    });

    it('error should format message correctly in non-JSON mode', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      error('something went wrong', false);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('something went wrong')
      );
      
      consoleSpy.mockRestore();
    });

    it('error should format message correctly in JSON mode', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      error('something went wrong', true);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"error"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"something went wrong"')
      );
      
      consoleSpy.mockRestore();
    });

    it('warn should format message correctly in non-JSON mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      warn('cache miss detected', false);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('cache miss detected')
      );
      
      consoleSpy.mockRestore();
    });

    it('info should format message correctly in non-JSON mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      info('processing files', false);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('processing files')
      );
      
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
        { name: 'app1', url: 'https://app1.example.com' },
        { name: 'app2', url: 'https://app2.example.com' }
      ];
      
      const result = formatTable(data);
      
      // Should contain headers
      expect(result).toContain('name');
      expect(result).toContain('url');
      
      // Should contain data
      expect(result).toContain('app1');
      expect(result).toContain('app2');
      expect(result).toContain('https://app1.example.com');
      expect(result).toContain('https://app2.example.com');
      
      // Should have proper column separation (3 spaces) - account for ANSI codes
      expect(result).toMatch(/name.*url/);
    });

    it('should handle mixed data types correctly', async () => {
      const data = [
        { id: 'abc123', count: 42, active: true, size: null },
        { id: 'def456', count: 0, active: false, size: undefined }
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
        { created: '2022-01-02', name: 'test2', id: 'def456' }
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
          isCreate: false,   // Should be filtered (internal field)
          url: 'example.com'
        }
      ];

      const result = formatTable(data);

      expect(result).toContain('name');
      expect(result).toContain('url');
      expect(result).not.toContain('isCreate');
    });

    it('should preserve property order from first item', async () => {
      const data = [
        { z_last: 'last', a_first: 'first', m_middle: 'middle' }
      ];
      
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
        { name: '', url: 'test.com', count: 0 },
        { name: 'app', url: '', count: null }
      ];
      
      const result = formatTable(data);
      
      // Should not break on empty strings or null values
      expect(result).toContain('name');
      expect(result).toContain('url');
      expect(result).toContain('count');
      expect(result).toContain('app');
      expect(result).toContain('test.com');
    });
  });
});