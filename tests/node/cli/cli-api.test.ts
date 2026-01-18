/**
 * @file CLI tests requiring mock API server
 * Consolidated tests for via field, tags, and spinner behavior
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCli } from './helpers';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CLI with Mock API', () => {
  let mockServer: ReturnType<typeof createServer>;
  let serverPort: number;
  let simulateAuthError = false;
  const DEMO_SITE_PATH = path.resolve(__dirname, '../../fixtures/demo-site');

  const testEnv = () => ({
    env: {
      SHIP_API_URL: `http://localhost:${serverPort}`,
      SHIP_API_KEY: 'ship-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    }
  });

  beforeAll(async () => {
    mockServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url || '';
      let body = '';

      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        // Config endpoint
        if (req.method === 'GET' && url === '/config') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            maxFileSize: 10485760,
            maxFilesCount: 1000,
            maxTotalSize: 52428800
          }));
          return;
        }

        // SPA check endpoint
        if (req.method === 'POST' && url === '/spa-check') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ isSPA: false }));
          return;
        }

        // Deployments create
        if (req.method === 'POST' && url === '/deployments') {
          if (simulateAuthError) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'authentication_error', message: 'Invalid API key' }));
            return;
          }

          // Extract via from multipart form data
          const viaMatch = body.match(/name="via"[\s\S]*?\r?\n\r?\n([^\r\n]*)/);
          const via = viaMatch ? viaMatch[1].trim() : undefined;

          // Extract tags from multipart form data
          const tagsMatch = body.match(/name="tags"[\s\S]*?\r?\n\r?\n([^\r\n]*)/);
          let tags: string[] | undefined;
          if (tagsMatch) {
            try { tags = JSON.parse(tagsMatch[1]); } catch (e) { /* ignore */ }
          }

          // Validate tags
          if (tags && tags.length > 0) {
            if (tags.length > 10) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'business_logic_error', message: 'Maximum 10 tags allowed' }));
              return;
            }
            for (const tag of tags) {
              if (tag.length < 3) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'business_logic_error', message: 'Tags must be at least 3 characters long' }));
                return;
              }
            }
          }

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            deployment: 'test-deployment-123',
            url: 'https://test-deployment-123.shipstatic.dev',
            files: 2,
            size: 1024,
            ...(via ? { via } : {}),
            ...(tags && tags.length > 0 ? { tags } : {})
          }));
          return;
        }

        // Domains set
        if (req.method === 'PUT' && url.startsWith('/domains/')) {
          const domainName = url.split('/domains/')[1];
          let requestData: any = {};
          try { requestData = JSON.parse(body); } catch (e) { /* ignore */ }

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            domain: domainName,
            deployment: requestData.deployment || 'test-deployment-123',
            url: `https://${domainName}.shipstatic.dev`,
            ...(requestData.tags && requestData.tags.length > 0 ? { tags: requestData.tags } : {})
          }));
          return;
        }

        // Tokens create
        if (req.method === 'POST' && url === '/tokens') {
          let requestData: any = {};
          try { requestData = JSON.parse(body); } catch (e) { /* ignore */ }

          // Validate tags
          if (requestData.tags && requestData.tags.length > 0) {
            if (requestData.tags.length > 10) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'business_logic_error', message: 'Maximum 10 tags allowed' }));
              return;
            }
            for (const tag of requestData.tags) {
              if (tag.length < 3) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'business_logic_error', message: 'Tags must be at least 3 characters long' }));
                return;
              }
            }
          }

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            token: 'token-abc123def456',
            expires: requestData.ttl ? Date.now() + (requestData.ttl * 1000) : null,
            message: 'Token created successfully',
            ...(requestData.tags && requestData.tags.length > 0 ? { tags: requestData.tags } : {})
          }));
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      });
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, () => {
        const address = mockServer.address();
        if (address && typeof address === 'object') {
          serverPort = address.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Via Field Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe('via field', () => {
    it('should set via: cli when using deployments create', async () => {
      const result = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH], testEnv());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).via).toBe('cli');
    });

    it('should set via: cli when using deployments create with tags', async () => {
      const result = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH, '--tag', 'production'], testEnv());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).via).toBe('cli');
    });

    it('should set via: cli when using deploy shortcut', async () => {
      const result = await runCli(['--json', DEMO_SITE_PATH], testEnv());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).via).toBe('cli');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Deploy Shortcut Parity Tests
  // Ensures shortcut (`ship <path>`) supports same flags as `ship deployments create <path>`
  // ─────────────────────────────────────────────────────────────────────────────

  describe('deploy shortcut parity', () => {
    it('should support --tag flag on shortcut', async () => {
      const result = await runCli(['--json', DEMO_SITE_PATH, '--tag', 'production'], testEnv());
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.tags).toEqual(['production']);
    });

    it('should support multiple --tag flags on shortcut', async () => {
      const result = await runCli(['--json', DEMO_SITE_PATH, '--tag', 'prod', '--tag', 'v1.0.0'], testEnv());
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.tags).toEqual(['prod', 'v1.0.0']);
    });

    it('should produce same result with shortcut and long command', async () => {
      const shortcutResult = await runCli(['--json', DEMO_SITE_PATH, '--tag', 'test-tag'], testEnv());
      const longResult = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH, '--tag', 'test-tag'], testEnv());

      expect(shortcutResult.exitCode).toBe(0);
      expect(longResult.exitCode).toBe(0);

      const shortcutOutput = JSON.parse(shortcutResult.stdout.trim());
      const longOutput = JSON.parse(longResult.stdout.trim());

      expect(shortcutOutput.tags).toEqual(longOutput.tags);
      expect(shortcutOutput.via).toEqual(longOutput.via);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Spinner Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe('spinner behavior', () => {
    it('should not show spinner in JSON mode', async () => {
      simulateAuthError = true;
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-test-'));
      fs.writeFileSync(path.join(tempDir, 'test.txt'), 'test content');

      try {
        const result = await runCli(['--json', 'deployments', 'create', tempDir], testEnv());
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('"error"');
        expect(result.stderr).not.toContain('uploading');
      } finally {
        fs.rmSync(tempDir, { recursive: true });
        simulateAuthError = false;
      }
    });

    it('should not show spinner with --no-color flag', async () => {
      simulateAuthError = true;
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-test-'));
      fs.writeFileSync(path.join(tempDir, 'test.txt'), 'test content');

      try {
        const result = await runCli(['--no-color', 'deployments', 'create', tempDir], testEnv());
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('error');
        expect(result.stderr).not.toContain('uploading');
      } finally {
        fs.rmSync(tempDir, { recursive: true });
        simulateAuthError = false;
      }
    });

    it('should respect TTY detection', async () => {
      simulateAuthError = true;
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-test-'));
      fs.writeFileSync(path.join(tempDir, 'test.txt'), 'test content');

      try {
        const result = await runCli(['deployments', 'create', tempDir], testEnv());
        expect(result.exitCode).toBe(1);
        expect(result.stderr).not.toContain('uploading');
      } finally {
        fs.rmSync(tempDir, { recursive: true });
        simulateAuthError = false;
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Tag Tests - Deployments
  // ─────────────────────────────────────────────────────────────────────────────

  describe('deployments create --tag', () => {
    it('should accept single --tag flag', async () => {
      const result = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH, '--tag', 'production'], testEnv());
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.deployment).toBe('test-deployment-123');
      expect(output.tags).toEqual(['production']);
    });

    it('should accept multiple --tag flags', async () => {
      const result = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH, '--tag', 'production', '--tag', 'v1.0.0'], testEnv());
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.tags).toEqual(['production', 'v1.0.0']);
    });

    it('should handle tags with special characters', async () => {
      const result = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH, '--tag', 'release-2024', '--tag', 'version_1.0.0', '--tag', 'env:prod'], testEnv());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).tags).toEqual(['release-2024', 'version_1.0.0', 'env:prod']);
    });

    it('should work without --tag flag', async () => {
      const result = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH], testEnv());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).tags).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Tag Tests - Domains
  // ─────────────────────────────────────────────────────────────────────────────

  describe('domains set --tag', () => {
    it('should accept single --tag flag', async () => {
      const result = await runCli(['--json', 'domains', 'set', 'staging', 'test-deployment-123', '--tag', 'production'], testEnv());
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.domain).toBe('staging');
      expect(output.tags).toEqual(['production']);
    });

    it('should accept multiple --tag flags', async () => {
      const result = await runCli(['--json', 'domains', 'set', 'production', 'test-deployment-456', '--tag', 'prod', '--tag', 'v1.0.0', '--tag', 'stable'], testEnv());
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.tags).toEqual(['prod', 'v1.0.0', 'stable']);
    });

    it('should work without --tag flag', async () => {
      const result = await runCli(['--json', 'domains', 'set', 'test-domain', 'test-deployment-xyz'], testEnv());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).tags).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Tag Tests - Tokens
  // ─────────────────────────────────────────────────────────────────────────────

  describe('tokens create --tag', () => {
    it('should accept single --tag flag', async () => {
      const result = await runCli(['--json', 'tokens', 'create', '--tag', 'production'], testEnv());
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.token).toBe('token-abc123def456');
      expect(output.tags).toEqual(['production']);
    });

    it('should accept multiple --tag flags', async () => {
      const result = await runCli(['--json', 'tokens', 'create', '--tag', 'production', '--tag', 'api', '--tag', 'automated'], testEnv());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).tags).toEqual(['production', 'api', 'automated']);
    });

    it('should accept --tag with --ttl flag', async () => {
      const result = await runCli(['--json', 'tokens', 'create', '--ttl', '3600', '--tag', 'temporary', '--tag', 'test'], testEnv());
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.expires).toBeTruthy();
      expect(output.tags).toEqual(['temporary', 'test']);
    });

    it('should work without --tag flag', async () => {
      const result = await runCli(['--json', 'tokens', 'create'], testEnv());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).tags).toBeUndefined();
    });

    it('should handle tags with special characters', async () => {
      const result = await runCli(['--json', 'tokens', 'create', '--tag', 'ci-cd', '--tag', 'version_2.0', '--tag', 'env:staging'], testEnv());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).tags).toEqual(['ci-cd', 'version_2.0', 'env:staging']);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Tag Validation Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe('tag validation', () => {
    it('should preserve tag order', async () => {
      const result = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH, '--tag', 'first', '--tag', 'second', '--tag', 'third'], testEnv());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).tags).toEqual(['first', 'second', 'third']);
    });

    it('should use same --tag pattern for both commands', async () => {
      const deployResult = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH, '--tag', 'v1.0.0', '--tag', 'production'], testEnv());
      const domainResult = await runCli(['--json', 'domains', 'set', 'prod', 'test-deployment-123', '--tag', 'v1.0.0', '--tag', 'production'], testEnv());

      expect(JSON.parse(deployResult.stdout.trim()).tags).toEqual(['v1.0.0', 'production']);
      expect(JSON.parse(domainResult.stdout.trim()).tags).toEqual(['v1.0.0', 'production']);
    });

    it('should reject tags shorter than 3 characters (deployments)', async () => {
      const result = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH, '--tag', 'ab'], testEnv());
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr.trim()).error).toContain('at least 3 characters');
    });

    it('should reject tags shorter than 3 characters (tokens)', async () => {
      const result = await runCli(['--json', 'tokens', 'create', '--tag', 'ab'], testEnv());
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr.trim()).error).toContain('at least 3 characters');
    });

    it('should reject more than 10 tags (deployments)', async () => {
      const tags = Array.from({ length: 11 }, (_, i) => ['--tag', `tag${String(i + 1).padStart(2, '0')}`]).flat();
      const result = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH, ...tags], testEnv());
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr.trim()).error).toContain('Maximum 10 tags');
    });

    it('should reject more than 10 tags (tokens)', async () => {
      const tags = Array.from({ length: 11 }, (_, i) => ['--tag', `tag${String(i + 1).padStart(2, '0')}`]).flat();
      const result = await runCli(['--json', 'tokens', 'create', ...tags], testEnv());
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr.trim()).error).toContain('Maximum 10 tags');
    });
  });
});
