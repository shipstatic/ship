/**
 * @file CLI validation tests
 * Tests early validation of API keys and URLs
 */

import { describe, it, expect } from 'vitest';
import { runCli } from './helpers';

describe('CLI Validation', () => {
  describe('API Key Validation', () => {
    it('should reject API key without ship- prefix', async () => {
      const result = await runCli(['--api-key', 'invalid-key', 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('API key must start with "ship-"');
    });

    it('should reject API key with wrong length', async () => {
      const result = await runCli(['--api-key', 'ship-short', 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('API key must be 69 characters total');
    });

    it('should reject API key with invalid hex chars', async () => {
      const result = await runCli(['--api-key', 'ship-' + 'g'.repeat(64), 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('must contain 64 hexadecimal characters');
    });

    it('should accept valid API key format', async () => {
      const validKey = 'ship-' + 'a'.repeat(64);
      const result = await runCli(['--api-key', validKey, '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: ship');
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
      expect(result.stdout).toContain('Usage: ship');
    });

    it('should accept valid HTTP URL', async () => {
      const result = await runCli(['--api-url', 'http://localhost:3000', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: ship');
    });
  });

  describe('Validation Timing', () => {
    it('should validate before making network calls', async () => {
      // This ensures validation happens in option processing, not during API calls
      const result = await runCli(['--api-key', 'invalid', 'ping']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('API key must start with "ship-"');
      // Should fail fast without attempting network request
    });
  });
});