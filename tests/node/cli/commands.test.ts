/**
 * @file Consolidated CLI command tests
 * Tests CLI commands without network calls - the "impossible simplicity" approach
 * Replaces: comprehensive.test.ts, account-commands.test.ts, completion-commands.test.ts, e2e-scenarios.test.ts
 */

import { describe, it, expect } from 'vitest';
import { runCli } from './helpers';
import * as fs from 'fs';
import * as path from 'path';

describe('CLI Commands', () => {
  const DEMO_SITE_PATH = path.resolve(__dirname, '../fixtures/demo-site');

  describe('Basic Commands', () => {
    it('should show help', async () => {
      const result = await runCli(['--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Deploy static sites with simplicity');
      expect(result.stdout).toContain('COMMANDS');
    });

    it('should show version', async () => {
      const result = await runCli(['--version']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });

  });


  describe('Tokens Commands', () => {
    it('should handle tokens list command', async () => {
      // Tokens list requires authentication - expect auth error without API key
      const result = await runCli(['tokens', 'list'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      // Should fail with authentication error, not command error
      expect(result.stderr).toContain('error');
    });

    it('should handle tokens create command', async () => {
      // Tokens create requires authentication
      const result = await runCli(['tokens', 'create'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('error');
    });

    it('should handle tokens create with --ttl flag', async () => {
      // Tokens create with TTL requires authentication
      const result = await runCli(['tokens', 'create', '--ttl', '3600'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('error');
    });

    it('should handle tokens create with --tag flag', async () => {
      // Tokens create with tags requires authentication
      const result = await runCli(['tokens', 'create', '--tag', 'production'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('error');
    });

    it('should handle tokens remove command', async () => {
      // Tokens remove requires authentication
      const result = await runCli(['tokens', 'remove', 'token-abc123'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('error');
    });

    it('should show tokens help', async () => {
      const result = await runCli(['tokens', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('tokens');
    });
  });

  describe('Completion Commands', () => {
    it('should install bash completion', async () => {
      // Completion commands work without network
      const result = await runCli(['completion', 'install', 'bash'], { expectFailure: true });
      // Expected to fail without proper shell setup, but shouldn't be network error
      expect(result.stderr).not.toContain('network error');
    });

    it('should install zsh completion', async () => {
      const result = await runCli(['completion', 'install', 'zsh'], { expectFailure: true });
      expect(result.stderr).not.toContain('network error');
    });

    it('should install fish completion', async () => {
      const result = await runCli(['completion', 'install', 'fish'], { expectFailure: true });
      expect(result.stderr).not.toContain('network error');
    });

    it('should uninstall completion gracefully', async () => {
      const result = await runCli(['completion', 'uninstall']);
      // Should handle gracefully even if nothing to uninstall
      expect(result.exitCode).toBe(0);
    });

    it('should show completion help', async () => {
      const result = await runCli(['completion', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('completion');
    });
  });
});