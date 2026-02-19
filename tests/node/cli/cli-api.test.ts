/**
 * @file CLI tests requiring mock API server
 * Consolidated tests for via field, labels, and spinner behavior
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

          // Extract labels from multipart form data
          const labelsMatch = body.match(/name="labels"[\s\S]*?\r?\n\r?\n([^\r\n]*)/);
          let labels: string[] | undefined;
          if (labelsMatch) {
            try { labels = JSON.parse(labelsMatch[1]); } catch (e) { /* ignore */ }
          }

          // Validate labels
          if (labels && labels.length > 0) {
            if (labels.length > 10) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'business_logic_error', message: 'Maximum 10 labels allowed' }));
              return;
            }
            for (const label of labels) {
              if (label.length < 3) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'business_logic_error', message: 'Labels must be at least 3 characters long' }));
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
            labels: labels ?? [],
            ...(via ? { via } : {})
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
            labels: requestData.labels ?? []
          }));
          return;
        }

        // Tokens create
        if (req.method === 'POST' && url === '/tokens') {
          let requestData: any = {};
          try { requestData = JSON.parse(body); } catch (e) { /* ignore */ }

          // Validate labels
          if (requestData.labels && requestData.labels.length > 0) {
            if (requestData.labels.length > 10) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'business_logic_error', message: 'Maximum 10 labels allowed' }));
              return;
            }
            for (const label of requestData.labels) {
              if (label.length < 3) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'business_logic_error', message: 'Labels must be at least 3 characters long' }));
                return;
              }
            }
          }

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            token: 'token-abc123def456',
            expires: requestData.ttl ? Date.now() + (requestData.ttl * 1000) : null,
            message: 'Token created successfully',
            labels: requestData.labels ?? []
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

    it('should set via: cli when using deployments create with labels', async () => {
      const result = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH, '--label', 'production'], testEnv());
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
    it('should support --label flag on shortcut', async () => {
      const result = await runCli(['--json', DEMO_SITE_PATH, '--label', 'production'], testEnv());
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.labels).toEqual(['production']);
    });

    it('should support multiple --label flags on shortcut', async () => {
      const result = await runCli(['--json', DEMO_SITE_PATH, '--label', 'prod', '--label', 'v1.0.0'], testEnv());
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.labels).toEqual(['prod', 'v1.0.0']);
    });

    it('should produce same result with shortcut and long command', async () => {
      const shortcutResult = await runCli(['--json', DEMO_SITE_PATH, '--label', 'test-label'], testEnv());
      const longResult = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH, '--label', 'test-label'], testEnv());

      expect(shortcutResult.exitCode).toBe(0);
      expect(longResult.exitCode).toBe(0);

      const shortcutOutput = JSON.parse(shortcutResult.stdout.trim());
      const longOutput = JSON.parse(longResult.stdout.trim());

      expect(shortcutOutput.labels).toEqual(longOutput.labels);
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
  // Label Tests - Deployments
  // ─────────────────────────────────────────────────────────────────────────────

  describe('deployments create --label', () => {
    it('should accept single --label flag', async () => {
      const result = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH, '--label', 'production'], testEnv());
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.deployment).toBe('test-deployment-123');
      expect(output.labels).toEqual(['production']);
    });

    it('should accept multiple --label flags', async () => {
      const result = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH, '--label', 'production', '--label', 'v1.0.0'], testEnv());
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.labels).toEqual(['production', 'v1.0.0']);
    });

    it('should handle labels with special characters', async () => {
      const result = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH, '--label', 'release-2024', '--label', 'version_1.0.0', '--label', 'env:prod'], testEnv());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).labels).toEqual(['release-2024', 'version_1.0.0', 'env:prod']);
    });

    it('should work without --label flag', async () => {
      const result = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH], testEnv());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).labels).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Label Tests - Domains
  // ─────────────────────────────────────────────────────────────────────────────

  describe('domains set --label', () => {
    it('should accept single --label flag', async () => {
      const result = await runCli(['--json', 'domains', 'set', 'staging', 'test-deployment-123', '--label', 'production'], testEnv());
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.domain).toBe('staging');
      expect(output.labels).toEqual(['production']);
    });

    it('should accept multiple --label flags', async () => {
      const result = await runCli(['--json', 'domains', 'set', 'production', 'test-deployment-456', '--label', 'prod', '--label', 'v1.0.0', '--label', 'stable'], testEnv());
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.labels).toEqual(['prod', 'v1.0.0', 'stable']);
    });

    it('should work without --label flag', async () => {
      const result = await runCli(['--json', 'domains', 'set', 'test-domain', 'test-deployment-xyz'], testEnv());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).labels).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Label Tests - Tokens
  // ─────────────────────────────────────────────────────────────────────────────

  describe('tokens create --label', () => {
    it('should accept single --label flag', async () => {
      const result = await runCli(['--json', 'tokens', 'create', '--label', 'production'], testEnv());
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.token).toBe('token-abc123def456');
      expect(output.labels).toEqual(['production']);
    });

    it('should accept multiple --label flags', async () => {
      const result = await runCli(['--json', 'tokens', 'create', '--label', 'production', '--label', 'api', '--label', 'automated'], testEnv());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).labels).toEqual(['production', 'api', 'automated']);
    });

    it('should accept --label with --ttl flag', async () => {
      const result = await runCli(['--json', 'tokens', 'create', '--ttl', '3600', '--label', 'temporary', '--label', 'test'], testEnv());
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.expires).toBeTruthy();
      expect(output.labels).toEqual(['temporary', 'test']);
    });

    it('should work without --label flag', async () => {
      const result = await runCli(['--json', 'tokens', 'create'], testEnv());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).labels).toEqual([]);
    });

    it('should handle labels with special characters', async () => {
      const result = await runCli(['--json', 'tokens', 'create', '--label', 'ci-cd', '--label', 'version_2.0', '--label', 'env:staging'], testEnv());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).labels).toEqual(['ci-cd', 'version_2.0', 'env:staging']);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Label Validation Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe('label validation', () => {
    it('should preserve label order', async () => {
      const result = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH, '--label', 'first', '--label', 'second', '--label', 'third'], testEnv());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).labels).toEqual(['first', 'second', 'third']);
    });

    it('should use same --label pattern for both commands', async () => {
      const deployResult = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH, '--label', 'v1.0.0', '--label', 'production'], testEnv());
      const domainResult = await runCli(['--json', 'domains', 'set', 'prod', 'test-deployment-123', '--label', 'v1.0.0', '--label', 'production'], testEnv());

      expect(JSON.parse(deployResult.stdout.trim()).labels).toEqual(['v1.0.0', 'production']);
      expect(JSON.parse(domainResult.stdout.trim()).labels).toEqual(['v1.0.0', 'production']);
    });

    it('should reject labels shorter than 3 characters (deployments)', async () => {
      const result = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH, '--label', 'ab'], testEnv());
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr.trim()).error).toContain('at least 3 characters');
    });

    it('should reject labels shorter than 3 characters (tokens)', async () => {
      const result = await runCli(['--json', 'tokens', 'create', '--label', 'ab'], testEnv());
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr.trim()).error).toContain('at least 3 characters');
    });

    it('should reject more than 10 labels (deployments)', async () => {
      const labels = Array.from({ length: 11 }, (_, i) => ['--label', `label${String(i + 1).padStart(2, '0')}`]).flat();
      const result = await runCli(['--json', 'deployments', 'create', DEMO_SITE_PATH, ...labels], testEnv());
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr.trim()).error).toContain('Maximum 10 labels');
    });

    it('should reject more than 10 labels (tokens)', async () => {
      const labels = Array.from({ length: 11 }, (_, i) => ['--label', `label${String(i + 1).padStart(2, '0')}`]).flat();
      const result = await runCli(['--json', 'tokens', 'create', ...labels], testEnv());
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr.trim()).error).toContain('Maximum 10 labels');
    });
  });
});
