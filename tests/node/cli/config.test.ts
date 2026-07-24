/**
 * @file Tests for `ship config` command.
 * All tests run via subprocess, same as every other CLI command.
 */

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers';

const TEST_TOKEN = 'ship-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const ALT_TOKEN = 'ship-abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

describe('Config Command', () => {
  let tempHome: string;
  let configPath: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'ship-config-test-'));
    configPath = join(tempHome, '.shiprc');
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  describe('--json mode', () => {
    it('should show config path when no config exists', async () => {
      const result = await runCli(['config', '--json'], {
        env: { HOME: tempHome },
      });
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.path).toContain('.shiprc');
      expect(output.exists).toBe(false);
    });

    it('should show masked token when config exists', async () => {
      writeFileSync(configPath, JSON.stringify({ token: TEST_TOKEN }));
      const result = await runCli(['config', '--json'], {
        env: { HOME: tempHome },
      });
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.exists).toBe(true);
      expect(output.token).toBe('ship-1234...cdef');
      expect(output.token).not.toBe(TEST_TOKEN);
    });

    it('masks short opaque tokens entirely', async () => {
      writeFileSync(configPath, JSON.stringify({ token: 'short-tok' }));
      const result = await runCli(['config', '--json'], {
        env: { HOME: tempHome },
      });
      const output = JSON.parse(result.stdout.trim());
      expect(output.token).toBe('...');
    });

    it('should not include default API URL', async () => {
      writeFileSync(configPath, JSON.stringify({ token: TEST_TOKEN }));
      const result = await runCli(['config', '--json'], {
        env: { HOME: tempHome },
      });
      const output = JSON.parse(result.stdout.trim());
      expect(output.apiUrl).toBeUndefined();
    });

    it('should include custom API URL', async () => {
      writeFileSync(
        configPath,
        JSON.stringify({ token: TEST_TOKEN, apiUrl: 'https://custom.example.com' }),
      );
      const result = await runCli(['config', '--json'], {
        env: { HOME: tempHome },
      });
      const output = JSON.parse(result.stdout.trim());
      expect(output.apiUrl).toBe('https://custom.example.com');
    });
  });

  describe('interactive flow', () => {
    it('should create config with a token', async () => {
      const result = await runCli(['config'], {
        stdin: [TEST_TOKEN],
        env: { HOME: tempHome },
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('saved to');

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.token).toBe(TEST_TOKEN);
    });

    it('should preserve existing token when pressing Enter', async () => {
      writeFileSync(configPath, JSON.stringify({ token: TEST_TOKEN }));

      const result = await runCli(['config'], {
        stdin: [''],
        env: { HOME: tempHome },
      });
      expect(result.exitCode).toBe(0);

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.token).toBe(TEST_TOKEN);
    });

    it('should replace existing token with new input', async () => {
      writeFileSync(configPath, JSON.stringify({ token: TEST_TOKEN }));

      const result = await runCli(['config'], {
        stdin: [ALT_TOKEN],
        env: { HOME: tempHome },
      });
      expect(result.exitCode).toBe(0);

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.token).toBe(ALT_TOKEN);
    });

    it('writes the credential file owner-only (0600)', async () => {
      const result = await runCli(['config'], {
        stdin: [TEST_TOKEN],
        env: { HOME: tempHome },
      });
      expect(result.exitCode).toBe(0);
      expect(statSync(configPath).mode & 0o777).toBe(0o600);
    });

    it('repairs permissions on a pre-existing world-readable config', async () => {
      writeFileSync(configPath, JSON.stringify({ token: TEST_TOKEN }), { mode: 0o644 });

      const result = await runCli(['config'], {
        stdin: [''],
        env: { HOME: tempHome },
      });
      expect(result.exitCode).toBe(0);
      expect(statSync(configPath).mode & 0o777).toBe(0o600);
    });

    it('should preserve other fields like apiUrl', async () => {
      writeFileSync(
        configPath,
        JSON.stringify({
          token: TEST_TOKEN,
          apiUrl: 'https://custom.example.com',
        }),
      );

      const result = await runCli(['config'], {
        stdin: [ALT_TOKEN],
        env: { HOME: tempHome },
      });
      expect(result.exitCode).toBe(0);

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.token).toBe(ALT_TOKEN);
      expect(config.apiUrl).toBe('https://custom.example.com');
    });

    it('should create empty config when pressing Enter with no existing config', async () => {
      const result = await runCli(['config'], {
        stdin: [''],
        env: { HOME: tempHome },
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('saved to');

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config).toEqual({});
    });

    it('should reject a malformed prefixed token', async () => {
      // Prefixed tokens carry format guarantees — a truncated paste fails
      // here rather than as a confusing 401 later.
      const result = await runCli(['config'], {
        stdin: ['ship-short'],
        env: { HOME: tempHome },
        expectFailure: true,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('ship-');
    });
  });
});
