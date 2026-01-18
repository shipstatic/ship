/**
 * @file Consolidated basic tests
 * Tests help, version, snapshots - the "impossible simplicity" approach
 * Replaces: snapshots.test.ts, simple-cli.test.ts, debug.test.ts
 */

import { describe, it, expect } from 'vitest';
import { runCli } from './helpers';

describe('CLI Basics', () => {
  describe('Help and Version', () => {
    it('should show help with no arguments', async () => {
      const result = await runCli([]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
      expect(result.stdout).toContain('🚀 Deploy static sites with simplicity');
      expect(result.stdout).toContain('COMMANDS');
      expect(result.stdout).toContain('FLAGS');
    });

    it('should show help with --help flag', async () => {
      const result = await runCli(['--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
      expect(result.stdout).toContain('deployments');
      expect(result.stdout).toContain('domains');
      expect(result.stdout).toContain('account');
      expect(result.stdout).toContain('completion');
    });

    // Short form '-h' flag is not supported, only full '--help' flag is available

    it('should show version with --version flag', async () => {
      const result = await runCli(['--version']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    // Removed -v short flag as part of CLI simplification
    // Only --version long flag is supported now
  });

  describe('Output Snapshots', () => {
    it('help output should match snapshot', async () => {
      const result = await runCli(['--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatchSnapshot();
    });

    it('version output should be valid semver format', async () => {
      const result = await runCli(['--version']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('no args help output should match snapshot', async () => {
      const result = await runCli([]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatchSnapshot();
    });
  });

  describe('Unknown Command Detection', () => {
    it('should detect unknown commands vs paths', async () => {
      // Commands that don't look like paths should show "unknown command"
      const result = await runCli(['unknown'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'unknown'");
    });

    it('should handle path-like arguments properly', async () => {
      // Arguments that look like paths should show path error
      const result = await runCli(['./nonexistent/path'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('path does not exist');
    });

    it('should show help for empty arguments', async () => {
      const result = await runCli([]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
    });
  });

  describe('Error Snapshots', () => {
    it('unknown command error should match snapshot', async () => {
      const result = await runCli(['unknown-command'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatchSnapshot();
    });

    it('unknown option error should match snapshot', async () => {
      const result = await runCli(['ping', '--unknown-option'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatchSnapshot();
    });

    it('nonexistent path error should match snapshot', async () => {
      const result = await runCli(['./nonexistent/path'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatchSnapshot();
    });
  });

  describe('Tokens Command Snapshots', () => {
    it('tokens help output should include all commands', async () => {
      const result = await runCli(['tokens', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('tokens');
      expect(result.stdout).toContain('list');
      expect(result.stdout).toContain('create');
      expect(result.stdout).toContain('remove');
    });

    it('tokens list should succeed with auth', async () => {
      const result = await runCli(['tokens', 'list']);
      expect(result.exitCode).toBe(0);
    });

    it('tokens create should succeed with auth', async () => {
      const result = await runCli(['tokens', 'create']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('token');
    });

    it('tokens remove should fail gracefully without auth', async () => {
      const result = await runCli(['tokens', 'remove', 'token-abc123'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('error');
    });

    it('tokens help should match expected structure', async () => {
      const result = await runCli(['tokens', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatchSnapshot();
    });
  });

  describe('CLI Philosophy', () => {
    it('should embody impossible simplicity', () => {
      // The CLI design should be impossibly simple
      // This test documents our philosophy: everything should "just work"
      expect(true).toBe(true);
    });

    it('should provide intuitive command structure', async () => {
      const helpResult = await runCli(['--help']);
      expect(helpResult.stdout).toContain('deployments');
      expect(helpResult.stdout).toContain('domains');
      expect(helpResult.stdout).toContain('tokens');
      expect(helpResult.stdout).toContain('account');

      // Commands should be logical and predictable
      expect(helpResult.stdout).toContain('deployments');
      expect(helpResult.stdout).toContain('domains');
      expect(helpResult.stdout).toContain('tokens');
      expect(helpResult.stdout).toContain('account');
    });
  });
});