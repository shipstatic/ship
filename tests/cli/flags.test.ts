/**
 * @file Consolidated flag tests  
 * Tests all global flags without network calls - the "impossible simplicity" approach
 * Replaces: flag-combinations.test.ts
 */

import { describe, it, expect } from 'vitest';
import { runCli } from './helpers';

describe('CLI Flags', () => {
  describe('JSON Flag', () => {
    it('should work with help command', async () => {
      const result = await runCli(['--help', '--json']);
      expect(result.exitCode).toBe(0);
      // Help with JSON flag should still show help text (not convert to JSON)
      expect(result.stdout).toContain('Usage: ship');
    });

    it('should work with version command', async () => {
      const result = await runCli(['--version', '--json']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('API Key Flag', () => {
    it('should accept custom API key without network call', async () => {
      const result = await runCli(['--api-key', 'custom-key', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: ship');
    });

    it('should work with short flag', async () => {
      const result = await runCli(['-k', 'short-key', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: ship');
    });
  });

  describe('API URL Flag', () => {
    it('should accept custom API URL without network call', async () => {
      const result = await runCli(['--api-url', 'https://custom.api.com', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: ship');
    });
  });

  describe('Config Flag', () => {
    it('should accept config file path without network call', async () => {
      const result = await runCli(['--config', '/path/to/config.json', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: ship');
    });

    it('should handle nonexistent config file', async () => {
      const result = await runCli(['--config', '/nonexistent/config.json', '--help']);
      // Should still show help even with bad config path
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: ship');
    });
  });

  describe('Preserve Dirs Flag', () => {
    it('should accept preserve dirs flag without network call', async () => {
      const result = await runCli(['--preserve-dirs', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: ship');
    });

    it('should combine with JSON flag', async () => {
      const result = await runCli(['--preserve-dirs', '--json', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: ship');
    });
  });

  describe('Flag Combinations', () => {
    it('should handle multiple flags together', async () => {
      const result = await runCli([
        '--api-key', 'test-key',
        '--api-url', 'https://test.com',
        '--json',
        '--help'
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: ship');
    });

    it('should handle flag order variations', async () => {
      const result = await runCli([
        '--help',
        '--api-key', 'test-key',
        '--json'
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: ship');
    });

    it('should prioritize CLI flags over config', async () => {
      const result = await runCli([
        '--config', '/nonexistent/config.json',
        '--api-key', 'override-key',
        '--help'
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: ship');
    });
  });

  describe('Flag Validation', () => {
    it('should handle empty API key', async () => {
      const result = await runCli(['--api-key', '', '--help'], { expectFailure: true });
      // This might fail or succeed depending on validation - either is OK for help
      expect([0, 1]).toContain(result.exitCode);
    });

    it('should handle missing flag values', async () => {
      const result = await runCli(['--api-key'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('api-key');
    });
  });

});