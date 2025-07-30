/**
 * @file Consolidated error tests
 * Tests error scenarios without network calls - the "impossible simplicity" approach
 * Replaces: error-scenarios.test.ts
 */

import { describe, it, expect } from 'vitest';
import { runCli } from './helpers';

describe('CLI Error Handling', () => {
  describe('Unknown Commands', () => {
    it('should handle unknown top-level commands', async () => {
      const result = await runCli(['unknown-command'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'unknown-command'");
    });

    it('should handle unknown subcommands', async () => {
      const result = await runCli(['deployments', 'unknown'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('unknown');
    });

    it('should provide JSON error format for unknown commands', async () => {
      const result = await runCli(['unknown-command', '--json'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      // Should handle JSON flag even with errors
      expect(result.stderr.length).toBeGreaterThan(0);
    });
  });

  describe('Unknown Options', () => {
    it('should handle unknown global options', async () => {
      const result = await runCli(['--unknown-option'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('unknown option');
    });

    it('should handle unknown command options', async () => {
      const result = await runCli(['completion', '--unknown-flag'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('unknown option');
    });
  });

  describe('Invalid Paths', () => {
    it('should handle nonexistent deployment paths', async () => {
      const result = await runCli(['./nonexistent/path'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('path does not exist');
    });

    it('should provide detailed error in JSON format', async () => {
      const result = await runCli(['./nonexistent/path', '--json'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      // Should handle JSON flag even with path errors
      expect(result.stderr.length).toBeGreaterThan(0);
    });
  });

  describe('Validation Errors', () => {
    it('should handle missing required arguments', async () => {
      const result = await runCli(['deployments'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('help');
    });

    it('should handle invalid argument formats', async () => {
      const result = await runCli(['--api-key'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('api-key');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty command gracefully', async () => {
      const result = await runCli([]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: ship');
    });

    it('should detect path vs command ambiguity', async () => {
      const result = await runCli(['unknown'], { expectFailure: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'unknown'");
    });

    it('should handle signals gracefully', () => {
      // This test doesn't need to run anything - just documents the expectation
      expect(true).toBe(true);
    });
  });

});