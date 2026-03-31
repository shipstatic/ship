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

    it('should handle tokens create with --label flag', async () => {
      // Tokens create with labels - should succeed with mock server
      const result = await runCli(['tokens', 'create', '--label', 'production']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('token');
    });

    it('should handle tokens remove command', async () => {
      // Tokens remove with non-existent token should fail
      const result = await runCli(['tokens', 'remove', 'a1b2c3d'], { expectFailure: true });
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

    it('should handle domains set with labels only', async () => {
      // Update the pre-seeded domain with new labels using set
      const result = await runCli(['domains', 'set', 'staging', '--label', 'updated-label']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('staging');
    });

    it('should handle domains set with multiple labels', async () => {
      const result = await runCli(['domains', 'set', 'staging', '--label', 'label1', '--label', 'label2']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('staging');
    });

    it('should create domain with labels-only via PUT upsert', async () => {
      const result = await runCli(['domains', 'set', 'non-existent-domain', '--label', 'test']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('non-existent-domain');
    });

    it('should handle domains set without deployment (domain reservation)', async () => {
      const result = await runCli(['domains', 'set', 'reserved-domain']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('reserved-domain');
    });

    it('should show domains help', async () => {
      const result = await runCli(['domains', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('set');
      expect(result.stdout).toContain('Create domain');
      expect(result.stdout).toContain('records');
      expect(result.stdout).toContain('dns');
      expect(result.stdout).toContain('share');
    });

    it('should handle domains records for external domain', async () => {
      // Create external domain first (external = has dots, starts as pending)
      await runCli(['domains', 'set', 'test.example.com']);
      const result = await runCli(['domains', 'records', 'test.example.com']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('type');
      expect(result.stdout).toContain('CNAME');
    });

    it('should handle domains records in quiet mode', async () => {
      await runCli(['domains', 'set', 'quiet.example.com']);
      const result = await runCli(['domains', 'records', 'quiet.example.com', '-q']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toContain('CNAME');
    });

    it('should handle domains records in json mode', async () => {
      await runCli(['domains', 'set', 'json.example.com']);
      const result = await runCli(['domains', 'records', 'json.example.com', '--json']);
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.records).toBeInstanceOf(Array);
      expect(json.apex).toBeDefined();
    });

    it('should handle domains dns for external domain', async () => {
      await runCli(['domains', 'set', 'dns.example.com']);
      const result = await runCli(['domains', 'dns', 'dns.example.com']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('provider');
    });

    it('should handle domains dns in quiet mode', async () => {
      await runCli(['domains', 'set', 'dnsq.example.com']);
      const result = await runCli(['domains', 'dns', 'dnsq.example.com', '-q']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('Cloudflare');
    });

    it('should handle domains share for external domain', async () => {
      await runCli(['domains', 'set', 'share.example.com']);
      const result = await runCli(['domains', 'share', 'share.example.com']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('https://setup.shipstatic.com/');
    });

    it('should handle domains share in quiet mode', async () => {
      await runCli(['domains', 'set', 'shareq.example.com']);
      const result = await runCli(['domains', 'share', 'shareq.example.com', '-q']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toContain('https://setup.shipstatic.com/');
    });

    it('should exit 0 for valid domain', async () => {
      const result = await runCli(['domains', 'validate', 'www.example.com']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('domain is valid');
    });

    it('should exit 1 for invalid domain', async () => {
      const result = await runCli(['domains', 'validate', 'not a domain'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
    });

    it('should exit 1 with no output in quiet mode for invalid domain', async () => {
      const result = await runCli(['domains', 'validate', 'not a domain', '-q'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
    });

    it('should output normalized name in quiet mode for valid domain', async () => {
      const result = await runCli(['domains', 'validate', 'www.example.com', '-q']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('www.example.com');
    });

    it('should exit 1 with valid JSON for invalid domain in json mode', async () => {
      const result = await runCli(['domains', 'validate', 'not a domain', '--json'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      const json = JSON.parse(result.stdout.trim());
      expect(json.valid).toBe(false);
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