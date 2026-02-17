/**
 * @file Tests for `ship config` command.
 * All tests run via subprocess, same as every other CLI command.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runCli } from './helpers';

const TEST_API_KEY = 'ship-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const ALT_API_KEY = 'ship-abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

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

    it('should show masked key when config exists', async () => {
      writeFileSync(configPath, JSON.stringify({ apiKey: TEST_API_KEY }));
      const result = await runCli(['config', '--json'], {
        env: { HOME: tempHome },
      });
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.exists).toBe(true);
      expect(output.apiKey).toBe('ship-1234...cdef');
      expect(output.apiKey).not.toBe(TEST_API_KEY);
    });

    it('should not include default API URL', async () => {
      writeFileSync(configPath, JSON.stringify({ apiKey: TEST_API_KEY }));
      const result = await runCli(['config', '--json'], {
        env: { HOME: tempHome },
      });
      const output = JSON.parse(result.stdout.trim());
      expect(output.apiUrl).toBeUndefined();
    });

    it('should include custom API URL', async () => {
      writeFileSync(configPath, JSON.stringify({ apiKey: TEST_API_KEY, apiUrl: 'https://custom.example.com' }));
      const result = await runCli(['config', '--json'], {
        env: { HOME: tempHome },
      });
      const output = JSON.parse(result.stdout.trim());
      expect(output.apiUrl).toBe('https://custom.example.com');
    });
  });

  describe('interactive flow', () => {
    it('should create config with API key', async () => {
      const result = await runCli(['config'], {
        stdin: [TEST_API_KEY],
        env: { HOME: tempHome },
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('saved to');

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.apiKey).toBe(TEST_API_KEY);
    });

    it('should preserve existing API key when pressing Enter', async () => {
      writeFileSync(configPath, JSON.stringify({ apiKey: TEST_API_KEY }));

      const result = await runCli(['config'], {
        stdin: [''],
        env: { HOME: tempHome },
      });
      expect(result.exitCode).toBe(0);

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.apiKey).toBe(TEST_API_KEY);
    });

    it('should replace existing API key with new one', async () => {
      writeFileSync(configPath, JSON.stringify({ apiKey: TEST_API_KEY }));

      const result = await runCli(['config'], {
        stdin: [ALT_API_KEY],
        env: { HOME: tempHome },
      });
      expect(result.exitCode).toBe(0);

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.apiKey).toBe(ALT_API_KEY);
    });

    it('should preserve other fields like deployToken', async () => {
      writeFileSync(configPath, JSON.stringify({
        apiKey: TEST_API_KEY,
        deployToken: 'token-abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678e',
      }));

      const result = await runCli(['config'], {
        stdin: [ALT_API_KEY],
        env: { HOME: tempHome },
      });
      expect(result.exitCode).toBe(0);

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.apiKey).toBe(ALT_API_KEY);
      expect(config.deployToken).toBe('token-abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678e');
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

    it('should reject invalid API key', async () => {
      const result = await runCli(['config'], {
        stdin: ['bad-key'],
        env: { HOME: tempHome },
        expectFailure: true,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('ship-');
    });
  });
});
