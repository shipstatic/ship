/**
 * @file Early validation of `--token` and `--api-url` — the preAction hook in
 * `src/node/cli/index.ts` that fails fast, before any client exists.
 *
 * IN-PROCESS via `buildProgram()`. The same behaviour used to be proven
 * through the spawned binary, invisibly to V8; the binary path is now the
 * smoke tier's job.
 *
 * Token validation is prefix-classified: `ship-` and `deploy-` values carry
 * format guarantees and are checked strictly; anything else is an opaque
 * platform bearer (e.g. an OAuth access token) and passes through — its
 * validity is the server's to decide.
 */

import { describe, expect, it } from 'vitest';
import { runProgram } from './harness';

describe('CLI validation', () => {
  describe('token validation', () => {
    it('rejects a ship- token with wrong length', async () => {
      const result = await runProgram(['--token', 'ship-short', 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('API key must be 69 characters total');
    });

    it('rejects a ship- token with invalid hex chars', async () => {
      const result = await runProgram(['--token', `ship-${'g'.repeat(64)}`, 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('must contain 64 hexadecimal characters');
    });

    it('rejects a deploy- token with wrong length', async () => {
      const result = await runProgram(['--token', 'deploy-short', 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('deploy token must be 71 characters total');
    });

    it('accepts a valid API key', async () => {
      const result = await runProgram(['--token', `ship-${'a'.repeat(64)}`, '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
    });

    it('accepts a valid deploy token', async () => {
      const result = await runProgram(['--token', `deploy-${'a'.repeat(64)}`, '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
    });

    it('accepts an opaque token (no known prefix)', async () => {
      // Opaque bearers are classified server-side — the CLI passes them
      // through verbatim rather than guessing at their format.
      const result = await runProgram(['--token', 'opaque-access-token', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
    });
  });

  describe('API URL validation', () => {
    it('rejects an invalid URL format', async () => {
      const result = await runProgram(['--api-url', 'not-a-url', 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('API URL must be a valid URL');
    });

    it('rejects a URL without protocol', async () => {
      const result = await runProgram(['--api-url', 'api.example.com', 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('API URL must be a valid URL');
    });

    it('rejects a URL with a path', async () => {
      const result = await runProgram(['--api-url', 'https://api.example.com/path', 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('API URL must not contain a path');
    });

    it('rejects a URL with query parameters', async () => {
      const result = await runProgram(['--api-url', 'https://api.example.com?param=value', 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('API URL must not contain query parameters');
    });

    it('accepts a valid HTTPS URL', async () => {
      const result = await runProgram(['--api-url', 'https://api.example.com', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
    });

    it('accepts a valid HTTP URL', async () => {
      const result = await runProgram(['--api-url', 'http://localhost:3000', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
    });
  });

  describe('flag arity', () => {
    it('rejects a value-taking flag with no value', async () => {
      const result = await runProgram(['--token']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('token');
    });
  });

  describe('validation timing', () => {
    it('validates before any network call — the hook rejects, not the server', async () => {
      const result = await runProgram(['--token', 'ship-invalid', 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('API key must be 69 characters total');
    });
  });
});
