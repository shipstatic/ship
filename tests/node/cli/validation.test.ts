/**
 * @file CLI validation tests
 * Tests early validation of the --token flag and --api-url.
 *
 * Token validation is prefix-classified: `ship-` and `deploy-` values carry
 * format guarantees and are checked strictly; anything else is an opaque
 * platform bearer (e.g. an OAuth access token) and passes through — its
 * validity is the server's to decide.
 */

import { describe, expect, it } from 'vitest';
import { runCli } from './helpers';

describe('CLI Validation', () => {
  describe('Token Validation', () => {
    it('should reject a ship- token with wrong length', async () => {
      const result = await runCli(['--token', 'ship-short', 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('API key must be 69 characters total');
    });

    it('should reject a ship- token with invalid hex chars', async () => {
      const result = await runCli(['--token', `ship-${'g'.repeat(64)}`, 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('must contain 64 hexadecimal characters');
    });

    it('should reject a deploy- token with wrong length', async () => {
      const result = await runCli(['--token', 'deploy-short', 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('deploy token must be 71 characters total');
    });

    it('should accept a valid API key', async () => {
      const validKey = `ship-${'a'.repeat(64)}`;
      const result = await runCli(['--token', validKey, '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
    });

    it('should accept a valid deploy token', async () => {
      const validToken = `deploy-${'a'.repeat(64)}`;
      const result = await runCli(['--token', validToken, '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
    });

    it('should accept an opaque token (no known prefix)', async () => {
      // Opaque bearers are classified server-side — the CLI passes them
      // through verbatim rather than guessing at their format.
      const result = await runCli(['--token', 'opaque-access-token', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
    });
  });

  describe('API URL Validation', () => {
    it('should reject invalid URL format', async () => {
      const result = await runCli(['--api-url', 'not-a-url', 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('API URL must be a valid URL');
    });

    it('should reject URL without protocol', async () => {
      const result = await runCli(['--api-url', 'api.example.com', 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('API URL must be a valid URL');
    });

    it('should reject URL with path', async () => {
      const result = await runCli(['--api-url', 'https://api.example.com/path', 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('API URL must not contain a path');
    });

    it('should reject URL with query parameters', async () => {
      const result = await runCli(['--api-url', 'https://api.example.com?param=value', 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('API URL must not contain query parameters');
    });

    it('should accept valid HTTPS URL', async () => {
      const result = await runCli(['--api-url', 'https://api.example.com', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
    });

    it('should accept valid HTTP URL', async () => {
      const result = await runCli(['--api-url', 'http://localhost:3000', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
    });
  });

  describe('Validation Timing', () => {
    it('should validate before making network calls', async () => {
      // This ensures validation happens in option processing, not during API calls
      const result = await runCli(['--token', 'ship-invalid', 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('API key must be 69 characters total');
      // Should fail fast without attempting network request
    });
  });
});
