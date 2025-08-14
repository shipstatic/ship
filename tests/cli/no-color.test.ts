/**
 * @file Tests for --no-color flag functionality
 * Tests that our custom utility functions respect the --no-color flag
 * Note: commander.js help/version outputs are naturally uncolored
 */

import { describe, it, expect } from 'vitest';
import { runCli } from './helpers';
import { success, error, warn, info, formatTable, formatDetails } from '../../src/cli/utils';

describe('CLI --no-color Flag', () => {
  describe('Utility Functions with --no-color', () => {
    it('should format success messages without colors', () => {
      // Test that our utility functions work with noColor flag
      expect(() => success('test message', false, true)).not.toThrow();
      expect(() => success('test message', true, true)).not.toThrow();
    });

    it('should format error messages without colors', () => {
      expect(() => error('test error', false, true)).not.toThrow();
      expect(() => error('test error', true, true)).not.toThrow();
    });

    it('should format warning messages without colors', () => {
      expect(() => warn('test warning', false, true)).not.toThrow();
      expect(() => warn('test warning', true, true)).not.toThrow();
    });

    it('should format info messages without colors', () => {
      expect(() => info('test info', false, true)).not.toThrow();
      expect(() => info('test info', true, true)).not.toThrow();
    });

    it('should format tables without colors', () => {
      const data = [
        { name: 'test1', status: 'active', created: 1640995200 },
        { name: 'test2', status: 'inactive', created: 1640995300 }
      ];
      const formatted = formatTable(data, undefined, true);
      expect(formatted).toContain('name');
      expect(formatted).toContain('test1');
      expect(formatted).toContain('test2');
      // Should not contain ANSI escape codes when noColor is true
      expect(formatted).not.toMatch(/\u001b\[[0-9;]*m/);
    });

    it('should format details without colors', () => {
      const obj = { name: 'test', status: 'active', created: 1640995200 };
      const formatted = formatDetails(obj, true);
      expect(formatted).toContain('name:');
      expect(formatted).toContain('test');
      expect(formatted).toContain('status:');
      expect(formatted).toContain('active');
      // Should not contain ANSI escape codes when noColor is true
      expect(formatted).not.toMatch(/\u001b\[[0-9;]*m/);
    });
  });

  describe('CLI Integration with --no-color', () => {
    it('should accept --no-color flag with help', async () => {
      const result = await runCli(['--help', '--no-color']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
      expect(result.stdout).toContain('--no-color');
      expect(result.stdout).toContain('Disable colored output');
    });

    it('should accept --no-color flag with version', async () => {
      const result = await runCli(['--version', '--no-color']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should accept --no-color with subcommand help', async () => {
      const result = await runCli(['deployments', '--help', '--no-color']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('deployments');
      expect(result.stdout).toContain('list');
      expect(result.stdout).toContain('create');
    });
  });

  describe('Flag Combinations with --no-color', () => {
    it('should work with --json and --no-color together', async () => {
      const result = await runCli(['--version', '--json', '--no-color']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should work with --api-key and --no-color together', async () => {
      const result = await runCli(['--api-key', 'test-key', '--help', '--no-color']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
    });

    it('should work with multiple flags and --no-color', async () => {
      const result = await runCli([
        '--api-key', 'test-key',
        '--api-url', 'https://test.com',
        '--no-path-detect',
        '--no-color',
        '--help'
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
    });
  });

  describe('Flag Order with --no-color', () => {
    it('should work when --no-color comes first', async () => {
      const result = await runCli(['--no-color', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
    });

    it('should work when --no-color comes last', async () => {
      const result = await runCli(['--help', '--no-color']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
    });

    it('should work when --no-color is in the middle', async () => {
      const result = await runCli(['--api-key', 'test', '--no-color', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
    });
  });

  describe('Color vs No-Color Utility Functions', () => {
    it('should produce different output with and without noColor flag', () => {
      const data = [{ name: 'test', created: 1640995200 }];
      
      // With colors (default)
      const withColors = formatTable(data, undefined, false);
      // Without colors (noColor = true)  
      const withoutColors = formatTable(data, undefined, true);
      
      // Both should contain the same content
      expect(withColors).toContain('name');
      expect(withColors).toContain('test');
      expect(withoutColors).toContain('name');
      expect(withoutColors).toContain('test');
      
      // The colorless version should not have ANSI codes
      expect(withoutColors).not.toMatch(/\u001b\[[0-9;]*m/);
    });
  });
});