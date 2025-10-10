/**
 * @file Consolidated output tests
 * Tests output formatting without network calls - the "impossible simplicity" approach
 * Replaces: output-consistency.test.ts, output-formatting.test.ts, property-order.test.ts, pure-functions.test.ts
 */

import { describe, it, expect } from 'vitest';
import { runCli } from './helpers';
import { formatTable, formatDetails, formatTimestamp, success, error } from '@/node/cli/utils';

describe('CLI Output', () => {
  describe('Help and Version Consistency', () => {
    it('should provide consistent help format', async () => {
      const result = await runCli(['--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
      expect(result.stdout).toContain('🚀 Deploy static sites with simplicity');
      expect(result.stdout).toContain('COMMANDS');
      expect(result.stdout).toContain('FLAGS');
    });

    it('should provide consistent version format', async () => {
      const result = await runCli(['--version']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('JSON vs Human Format (Non-Network)', () => {
    it('should handle JSON flag with help', async () => {
      const result = await runCli(['--help', '--json']);
      expect(result.exitCode).toBe(0);
      // Help should still show human format even with JSON flag
      expect(result.stdout).toContain('USAGE');
    });

    it('should handle JSON flag with version', async () => {
      const result = await runCli(['--version', '--json']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('Pure Formatting Functions', () => {
    it('should format success messages consistently', () => {
      // success() outputs to console, doesn't return a value
      expect(() => success('Test successful')).not.toThrow();
      expect(() => success('Test successful', true)).not.toThrow();
    });

    it('should format error messages consistently', () => {
      // error() outputs to console, doesn't return a value  
      expect(() => error('Test failed')).not.toThrow();
      expect(() => error('Test failed', true)).not.toThrow();
    });

    it('should format timestamps correctly', () => {
      const timestamp = 1640995200; // 2022-01-01T00:00:00Z
      const formatted = formatTimestamp(timestamp, 'table');
      expect(formatted).toContain('2022-01-01');
    });

    it('should format tables with proper spacing', () => {
      const data = [
        { name: 'test1', status: 'active' },
        { name: 'test2', status: 'inactive' }
      ];
      const formatted = formatTable(data);
      expect(formatted).toContain('name');
      expect(formatted).toContain('status');
      expect(formatted).toContain('test1');
      expect(formatted).toContain('test2');
    });

    it('should format details with consistent structure', () => {
      const obj = { name: 'test', status: 'active', created: 1640995200 };
      const formatted = formatDetails(obj);
      // Strip ANSI codes for testing
      const cleanFormatted = formatted.replace(/\u001b\[[0-9;]*m/g, '');
      expect(cleanFormatted).toContain('name:');
      expect(cleanFormatted).toContain('test');
      expect(cleanFormatted).toContain('status:');
      expect(cleanFormatted).toContain('active');
    });
  });

  describe('Error Message Formatting', () => {
    it('should format unknown command errors consistently', async () => {
      const result = await runCli(['unknown-cmd'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('unknown command');
    });

    it('should format option errors consistently', async () => {
      const result = await runCli(['--unknown-option'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('unknown option');
    });
  });

  describe('Command Structure Consistency', () => {
    it('should show consistent command structure in help', async () => {
      const result = await runCli(['--help']);
      expect(result.exitCode).toBe(0);
      
      // Verify all main commands are present
      expect(result.stdout).toContain('deployments');
      expect(result.stdout).toContain('domains');
      expect(result.stdout).toContain('account');
      expect(result.stdout).toContain('completion');
      // ping command is hidden from help but still functional
      expect(result.stdout).toContain('whoami');
    });

    it('should show consistent subcommand help', async () => {
      const result = await runCli(['deployments', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('deployments');
    });
  });

});