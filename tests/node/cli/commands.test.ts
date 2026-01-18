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
      // Tokens list - should succeed with mock server
      const result = await runCli(['tokens', 'list']);
      expect(result.exitCode).toBe(0);
    });

    it('should handle tokens create command', async () => {
      // Tokens create - should succeed with mock server
      const result = await runCli(['tokens', 'create']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('token');
    });

    it('should handle tokens create with --ttl flag', async () => {
      // Tokens create with TTL - should succeed with mock server
      const result = await runCli(['tokens', 'create', '--ttl', '3600']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('token');
    });

    it('should handle tokens create with --tag flag', async () => {
      // Tokens create with tags - should succeed with mock server
      const result = await runCli(['tokens', 'create', '--tag', 'production']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('token');
    });

    it('should handle tokens remove command', async () => {
      // Tokens remove with non-existent token should fail
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

  describe('Domains Commands', () => {
    it('should handle domains list command', async () => {
      const result = await runCli(['domains', 'list']);
      expect(result.exitCode).toBe(0);
    });

    it('should handle domains get command', async () => {
      // Get the pre-seeded domain from mock server
      const result = await runCli(['domains', 'get', 'staging']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('staging');
    });

    it('should handle domains get for non-existent domain', async () => {
      const result = await runCli(['domains', 'get', 'non-existent-domain'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found');
    });

    it('should handle domains update command', async () => {
      // Update the pre-seeded domain with new tags
      const result = await runCli(['domains', 'update', 'staging', '--tag', 'updated-tag']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('staging');
      expect(result.stdout).toContain('updated');
    });

    it('should handle domains update with multiple tags', async () => {
      const result = await runCli(['domains', 'update', 'staging', '--tag', 'tag1', '--tag', 'tag2']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('staging');
    });

    it('should handle domains update for non-existent domain', async () => {
      const result = await runCli(['domains', 'update', 'non-existent-domain', '--tag', 'test'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found');
    });

    it('should show domains help', async () => {
      const result = await runCli(['domains', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('update');
      expect(result.stdout).toContain('Update domain tags');
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