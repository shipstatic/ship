/**
 * @file Comprehensive tests to ensure unknown commands always show error + help
 * These tests protect against regressions in error handling behavior
 */
import { describe, it, expect } from 'vitest';
import { runCli } from './helpers';

describe('Unknown Commands - Comprehensive Protection', () => {
  describe('First Level Unknown Commands', () => {
    it('should show error message and full help for simple unknown command', async () => {
      const result = await runCli(['badcommand'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'badcommand'");
      expect(result.stdout).toContain('USAGE');
      expect(result.stdout).toContain('COMMANDS');
    });

    it('should show error message and full help for unknown command with multiple args', async () => {
      const result = await runCli(['xyz', 'arg1', 'arg2'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'xyz'");
      expect(result.stdout).toContain('USAGE');
      expect(result.stdout).toContain('COMMANDS');
    });

    it('should handle JSON mode for unknown commands', async () => {
      const result = await runCli(['unknown', '--json'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('"error"');
      expect(result.stderr).toContain('unknown command');
      // Help should NOT be shown in JSON mode
      expect(result.stdout).not.toContain('USAGE');
    });
  });

  describe('Second Level Unknown Commands - Scoped Usage', () => {
    it('should show error + scoped usage for unknown deployments subcommand', async () => {
      const result = await runCli(['deployments', 'badsubcmd'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'badsubcmd'");
      expect(result.stdout).toContain('usage: ship deployments');
      expect(result.stdout).toContain('list');
      expect(result.stdout).toContain('upload');
    });

    it('should show error + scoped usage for unknown domains subcommand', async () => {
      const result = await runCli(['domains', 'invalid'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'invalid'");
      expect(result.stdout).toContain('usage: ship domains');
      expect(result.stdout).toContain('records');
      expect(result.stdout).toContain('verify');
    });

    it('should show error + scoped usage for unknown account subcommand', async () => {
      const result = await runCli(['account', 'wrong'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'wrong'");
      expect(result.stdout).toContain('usage: ship account');
    });

    it('should show error + scoped usage for unknown completion subcommand', async () => {
      const result = await runCli(['completion', 'missing'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'missing'");
      expect(result.stdout).toContain('usage: ship completion');
    });

    it('should suppress scoped usage in JSON mode', async () => {
      const result = await runCli(['deployments', 'bad', '--json'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('"error"');
      expect(result.stdout).not.toContain('usage:');
    });
  });

  describe('Edge Cases - Protection Against Regressions', () => {
    it('should handle multiple unknown args correctly', async () => {
      const result = await runCli(['deployments', 'bad1', 'bad2'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'bad1'");
      expect(result.stdout).toContain('usage: ship deployments');
    });

    it('should show scoped usage for bare group command (no subcommand)', async () => {
      const result = await runCli(['deployments'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('usage: ship deployments');
      expect(result.stderr).not.toContain('unknown command');
    });

    it('should distinguish between unknown commands and invalid paths', async () => {
      const result = await runCli(['notapath'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'notapath'");
      expect(result.stdout).toContain('USAGE');
    });

    it('should handle commands that look like flags', async () => {
      const result = await runCli(['--badcommand'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('unknown option');
      expect(result.stdout).toContain('USAGE');
    });
  });

  describe('Output Structure Verification', () => {
    it('should show full help for top-level unknown commands', async () => {
      const result = await runCli(['badcmd'], { expectFailure: true });
      expect(result.exitCode).toBe(1);

      const cleanError = result.stderr.replace(/\u001b\[[0-9;]*m/g, '');
      expect(cleanError).toMatch(/\[error\]/);
      expect(result.stderr).toContain("unknown command 'badcmd'");

      // Full help for top-level unknowns
      expect(result.stdout).toContain('USAGE');
      expect(result.stdout).toContain('COMMANDS');
      expect(result.stdout).toContain('FLAGS');
      expect(result.stdout).toContain('Deployments');
      expect(result.stdout).toContain('Domains');
    });

    it('should show scoped usage for all subcommand-level unknowns', async () => {
      const subcommands: [string, string[]][] = [
        ['deployments', ['list', 'upload', 'get', 'set', 'remove']],
        ['domains', ['list', 'get', 'set', 'validate', 'records', 'dns', 'share', 'verify', 'remove']],
        ['account', ['get']],
        ['completion', ['install', 'uninstall']],
      ];

      for (const [parent, expected] of subcommands) {
        const result = await runCli([parent, 'bad'], { expectFailure: true });
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("unknown command 'bad'");
        expect(result.stdout).toContain(`usage: ship ${parent}`);
        // Scoped usage should list the valid subcommands
        for (const cmd of expected) {
          expect(result.stdout).toContain(cmd);
        }
      }
    });
  });
});
