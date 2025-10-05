/**
 * @file CLI --tag flag tests
 * Tests the --tag flag functionality for deployments create and aliases set commands
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCli } from './helpers';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import * as path from 'path';

describe('CLI --tag Flag', () => {
  let mockServer: ReturnType<typeof createServer>;
  let serverPort: number;
  const DEMO_SITE_PATH = path.resolve(__dirname, '../../fixtures/demo-site');

  // Helper to create test options with server URL
  const testEnv = () => ({
    env: {
      SHIP_API_URL: `http://localhost:${serverPort}`,
      SHIP_API_KEY: 'ship-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    }
  });

  beforeAll(async () => {
    // Start mock API server
    serverPort = 3333;

    mockServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url || '';

      // Parse request body for POST/PUT requests
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', () => {
        // Handle deployments create
        if (req.method === 'POST' && url === '/deployments') {
          // Extract tags from multipart form data if present
          const tagsMatch = body.match(/"tags"\s*\r?\n\r?\n(.*?)(?:\r?\n--)/);
          let tags: string[] | undefined;

          if (tagsMatch) {
            try {
              tags = JSON.parse(tagsMatch[1]);
            } catch (e) {
              // Ignore parse errors
            }
          }

          // Validate tags if present
          if (tags && tags.length > 0) {
            // Check max count
            if (tags.length > 10) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: 'business_logic_error',
                message: 'Maximum 10 tags allowed'
              }));
              return;
            }

            // Check min length
            for (const tag of tags) {
              if (tag.length < 3) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  error: 'business_logic_error',
                  message: 'Tags must be at least 3 characters long'
                }));
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
            ...(tags && tags.length > 0 ? { tags } : {})
          }));
          return;
        }

        // Handle aliases set
        if (req.method === 'PUT' && url.startsWith('/aliases/')) {
          const aliasName = url.split('/aliases/')[1];
          let requestData: any = {};

          try {
            requestData = JSON.parse(body);
          } catch (e) {
            // Ignore parse errors
          }

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            alias: aliasName,
            deployment: requestData.deployment || 'test-deployment-123',
            url: `https://${aliasName}.shipstatic.dev`,
            ...(requestData.tags && requestData.tags.length > 0 ? { tags: requestData.tags } : {})
          }));
          return;
        }

        // Handle tokens create
        if (req.method === 'POST' && url === '/tokens') {
          let requestData: any = {};

          try {
            requestData = JSON.parse(body);
          } catch (e) {
            // Ignore parse errors
          }

          // Validate tags if present
          if (requestData.tags && requestData.tags.length > 0) {
            // Check max count
            if (requestData.tags.length > 10) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: 'business_logic_error',
                message: 'Maximum 10 tags allowed'
              }));
              return;
            }

            // Check min length
            for (const tag of requestData.tags) {
              if (tag.length < 3) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  error: 'business_logic_error',
                  message: 'Tags must be at least 3 characters long'
                }));
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

        // Handle config endpoint
        if (req.method === 'GET' && url === '/config') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            maxFileSize: 10485760,
            maxFilesCount: 1000,
            maxTotalSize: 52428800
          }));
          return;
        }

        // Handle SPA check endpoint
        if (req.method === 'POST' && url === '/spa-check') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ isSPA: false }));
          return;
        }

        // Default 404
        res.writeHead(404);
        res.end('Not found');
      });
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(serverPort, () => resolve());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });
  });

  describe('deployments create --tag', () => {
    it('should accept single --tag flag', async () => {
      const result = await runCli([
        '--json',
        'deployments', 'create', DEMO_SITE_PATH,
        '--tag', 'production'
      ], testEnv());

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.deployment).toBe('test-deployment-123');
      expect(output.tags).toEqual(['production']);
    });

    it('should accept multiple --tag flags', async () => {
      const result = await runCli([
        '--json',
        'deployments', 'create', DEMO_SITE_PATH,
        '--tag', 'production',
        '--tag', 'v1.0.0'
      ], testEnv());

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.deployment).toBe('test-deployment-123');
      expect(output.tags).toEqual(['production', 'v1.0.0']);
    });

    it('should handle tags with special characters', async () => {
      const result = await runCli([
        '--json',
        'deployments', 'create', DEMO_SITE_PATH,
        '--tag', 'release-2024',
        '--tag', 'version_1.0.0',
        '--tag', 'env:prod'
      ], testEnv());

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.tags).toEqual(['release-2024', 'version_1.0.0', 'env:prod']);
    });

    it('should work without --tag flag', async () => {
      const result = await runCli([
        '--json',
        'deployments', 'create', DEMO_SITE_PATH
      ], testEnv());

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.deployment).toBe('test-deployment-123');
      expect(output.tags).toBeUndefined();
    });
  });

  describe('aliases set --tag', () => {
    it('should accept single --tag flag', async () => {
      const result = await runCli([
        '--json',
        'aliases', 'set', 'staging', 'test-deployment-123',
        '--tag', 'production'
      ], testEnv());

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.alias).toBe('staging');
      expect(output.tags).toEqual(['production']);
    });

    it('should accept multiple --tag flags', async () => {
      const result = await runCli([
        '--json',
        'aliases', 'set', 'production', 'test-deployment-456',
        '--tag', 'prod',
        '--tag', 'v1.0.0',
        '--tag', 'stable'
      ], testEnv());

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.alias).toBe('production');
      expect(output.tags).toEqual(['prod', 'v1.0.0', 'stable']);
    });

    it('should work without --tag flag', async () => {
      const result = await runCli([
        '--json',
        'aliases', 'set', 'test-alias', 'test-deployment-xyz'
      ], testEnv());

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.alias).toBe('test-alias');
      expect(output.tags).toBeUndefined();
    });
  });

  describe('--tag flag validation', () => {
    it('should preserve tag order', async () => {
      const result = await runCli([
        '--json',
        'deployments', 'create', DEMO_SITE_PATH,
        '--tag', 'first',
        '--tag', 'second',
        '--tag', 'third'
      ], testEnv());

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.tags).toEqual(['first', 'second', 'third']);
    });

    it('should use same --tag pattern for both commands', async () => {
      // Deploy with tags
      const deployResult = await runCli([
        '--json',
        'deployments', 'create', DEMO_SITE_PATH,
        '--tag', 'v1.0.0',
        '--tag', 'production'
      ], testEnv());

      expect(deployResult.exitCode).toBe(0);
      const deployOutput = JSON.parse(deployResult.stdout.trim());

      // Set alias with same tags
      const aliasResult = await runCli([
        '--json',
        'aliases', 'set', 'prod', deployOutput.deployment,
        '--tag', 'v1.0.0',
        '--tag', 'production'
      ], testEnv());

      expect(aliasResult.exitCode).toBe(0);
      const aliasOutput = JSON.parse(aliasResult.stdout.trim());

      // Both should have the same tags format
      expect(deployOutput.tags).toEqual(aliasOutput.tags);
      expect(aliasOutput.tags).toEqual(['v1.0.0', 'production']);
    });

    it('should reject tags shorter than 3 characters', async () => {
      const result = await runCli([
        '--json',
        'deployments', 'create', DEMO_SITE_PATH,
        '--tag', 'ab'
      ], testEnv());

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBeTruthy();
      const error = JSON.parse(result.stderr.trim());
      expect(error.error).toContain('at least 3 characters');
    });

    it('should reject more than 10 tags', async () => {
      const result = await runCli([
        '--json',
        'deployments', 'create', DEMO_SITE_PATH,
        '--tag', 'tag01',
        '--tag', 'tag02',
        '--tag', 'tag03',
        '--tag', 'tag04',
        '--tag', 'tag05',
        '--tag', 'tag06',
        '--tag', 'tag07',
        '--tag', 'tag08',
        '--tag', 'tag09',
        '--tag', 'tag10',
        '--tag', 'tag11'
      ], testEnv());

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBeTruthy();
      const error = JSON.parse(result.stderr.trim());
      expect(error.error).toContain('Maximum 10 tags');
    });
  });

  describe('tokens create --tag', () => {
    it('should accept single --tag flag', async () => {
      const result = await runCli([
        '--json',
        'tokens', 'create',
        '--tag', 'production'
      ], testEnv());

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.token).toBe('token-abc123def456');
      expect(output.tags).toEqual(['production']);
    });

    it('should accept multiple --tag flags', async () => {
      const result = await runCli([
        '--json',
        'tokens', 'create',
        '--tag', 'production',
        '--tag', 'api',
        '--tag', 'automated'
      ], testEnv());

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.token).toBe('token-abc123def456');
      expect(output.tags).toEqual(['production', 'api', 'automated']);
    });

    it('should accept --tag with --ttl flag', async () => {
      const result = await runCli([
        '--json',
        'tokens', 'create',
        '--ttl', '3600',
        '--tag', 'temporary',
        '--tag', 'test'
      ], testEnv());

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.token).toBe('token-abc123def456');
      expect(output.expires).toBeTruthy();
      expect(output.tags).toEqual(['temporary', 'test']);
    });

    it('should work without --tag flag', async () => {
      const result = await runCli([
        '--json',
        'tokens', 'create'
      ], testEnv());

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.token).toBe('token-abc123def456');
      expect(output.tags).toBeUndefined();
    });

    it('should handle tags with special characters', async () => {
      const result = await runCli([
        '--json',
        'tokens', 'create',
        '--tag', 'ci-cd',
        '--tag', 'version_2.0',
        '--tag', 'env:staging'
      ], testEnv());

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.tags).toEqual(['ci-cd', 'version_2.0', 'env:staging']);
    });

    it('should reject tags shorter than 3 characters', async () => {
      const result = await runCli([
        '--json',
        'tokens', 'create',
        '--tag', 'ab'
      ], testEnv());

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBeTruthy();
      const error = JSON.parse(result.stderr.trim());
      expect(error.error).toContain('at least 3 characters');
    });

    it('should reject more than 10 tags', async () => {
      const result = await runCli([
        '--json',
        'tokens', 'create',
        '--tag', 'tag01',
        '--tag', 'tag02',
        '--tag', 'tag03',
        '--tag', 'tag04',
        '--tag', 'tag05',
        '--tag', 'tag06',
        '--tag', 'tag07',
        '--tag', 'tag08',
        '--tag', 'tag09',
        '--tag', 'tag10',
        '--tag', 'tag11'
      ], testEnv());

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBeTruthy();
      const error = JSON.parse(result.stderr.trim());
      expect(error.error).toContain('Maximum 10 tags');
    });
  });
});
