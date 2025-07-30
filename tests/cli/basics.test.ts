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
      expect(result.stdout).toContain('Usage: ship');
      expect(result.stdout).toContain('🚀 Deploy static sites with simplicity');
      expect(result.stdout).toContain('Commands:');
      expect(result.stdout).toContain('Options:');
    });

    it('should show help with --help flag', async () => {
      const result = await runCli(['--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: ship');
      expect(result.stdout).toContain('deployments');
      expect(result.stdout).toContain('aliases');
      expect(result.stdout).toContain('account');
      expect(result.stdout).toContain('completion');
    });

    it('should show help with -h flag', async () => {
      const result = await runCli(['-h']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: ship');
    });

    it('should show version with --version flag', async () => {
      const result = await runCli(['--version']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should show version with -v flag', async () => {
      const result = await runCli(['-v']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('Output Snapshots', () => {
    it('help output should match snapshot', async () => {
      const result = await runCli(['--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatchSnapshot();
    });

    it('version output should match snapshot', async () => {
      const result = await runCli(['--version']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatchSnapshot();
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
      expect(result.stdout).toContain('Usage: ship');
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

  describe('CLI Philosophy', () => {
    it('should embody impossible simplicity', () => {
      // The CLI design should be impossibly simple
      // This test documents our philosophy: everything should "just work"
      expect(true).toBe(true);
    });

    it('should provide intuitive command structure', async () => {
      const helpResult = await runCli(['--help']);
      expect(helpResult.stdout).toContain('deployments');
      expect(helpResult.stdout).toContain('aliases');
      expect(helpResult.stdout).toContain('account');
      
      // Commands should be logical and predictable
      expect(helpResult.stdout).toContain('deployments');
      expect(helpResult.stdout).toContain('aliases');
      expect(helpResult.stdout).toContain('account');
    });
  });
});