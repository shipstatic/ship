/**
 * @file Comprehensive tests to ensure unknown commands always show error + help
 * These tests protect against regressions in error handling behavior
 */
import { describe, it, expect } from 'vitest';
import { runCli } from './helpers';

describe('Unknown Commands - Comprehensive Protection', () => {
  describe('First Level Unknown Commands', () => {
    it('should show error message and help for simple unknown command', async () => {
      const result = await runCli(['badcommand'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'badcommand'");
      expect(result.stdout).toContain('USAGE');
      expect(result.stdout).toContain('🦸'); // Ensure superhero emoji is shown
    });

    it('should show error message and help for unknown command with multiple args', async () => {
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

  describe('Second Level Unknown Commands - All Parent Commands', () => {
    it('should show error + help for unknown deployments subcommand', async () => {
      const result = await runCli(['deployments', 'badsubcmd'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'badsubcmd'");
      expect(result.stdout).toContain('USAGE');
      expect(result.stdout).toContain('🦸');
    });

    it('should show error + help for unknown aliases subcommand', async () => {
      const result = await runCli(['aliases', 'invalid'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'invalid'");
      expect(result.stdout).toContain('USAGE');
      expect(result.stdout).toContain('🦸');
    });

    it('should show error + help for unknown account subcommand', async () => {
      const result = await runCli(['account', 'wrong'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'wrong'");
      expect(result.stdout).toContain('USAGE');
      expect(result.stdout).toContain('🦸');
    });

    it('should show error + help for unknown completion subcommand', async () => {
      const result = await runCli(['completion', 'missing'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'missing'");
      expect(result.stdout).toContain('USAGE');
      expect(result.stdout).toContain('🦸');
    });
  });

  describe('Edge Cases - Protection Against Regressions', () => {
    it('should handle multiple unknown args correctly', async () => {
      const result = await runCli(['deployments', 'bad1', 'bad2'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      // Should catch first unknown arg
      expect(result.stderr).toContain("unknown command 'bad1'");
      expect(result.stdout).toContain('USAGE');
    });

    it('should not show help for valid incomplete commands', async () => {
      const result = await runCli(['deployments'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      // This should show help but NO error message (just incomplete)
      expect(result.stdout).toContain('USAGE');
      expect(result.stderr).not.toContain('unknown command');
    });

    it('should distinguish between unknown commands and invalid paths', async () => {
      // This should be treated as an unknown command, not a path
      const result = await runCli(['notapath'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'notapath'");
      expect(result.stdout).toContain('USAGE');
    });

    it('should handle commands that look like flags', async () => {
      const result = await runCli(['--badcommand'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      // This should be treated as an unknown option, not unknown command
      expect(result.stderr).toContain('unknown option');
      expect(result.stdout).toContain('USAGE');
    });
  });

  describe('Output Structure Verification', () => {
    it('should always have consistent error + help structure', async () => {
      const result = await runCli(['badcmd'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      
      // Error must be in stderr with correct format (strip ANSI for easier testing)
      const cleanError = result.stderr.replace(/\u001b\[[0-9;]*m/g, '');
      expect(cleanError).toMatch(/\[error\]/);
      expect(result.stderr).toContain("unknown command 'badcmd'");
      
      // Help must be in stdout with all required sections
      expect(result.stdout).toContain('USAGE');
      expect(result.stdout).toContain('COMMANDS');
      expect(result.stdout).toContain('FLAGS');
      expect(result.stdout).toContain('Deployments');
      expect(result.stdout).toContain('Aliases');  
      expect(result.stdout).toContain('Account');
      expect(result.stdout).toContain('Completion');
      
      // Must contain superhero emoji for account section
      expect(result.stdout).toContain('🦸');
    });

    it('should maintain consistent format across all subcommand types', async () => {
      const subcommands = [
        ['deployments', 'bad'],
        ['aliases', 'bad'], 
        ['account', 'bad'],
        ['completion', 'bad']
      ];

      for (const [parent, sub] of subcommands) {
        const result = await runCli([parent, sub], { expectFailure: true });
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(`unknown command '${sub}'`);
        expect(result.stdout).toContain('USAGE');
        expect(result.stdout).toContain('🦸');
      }
    });
  });
});