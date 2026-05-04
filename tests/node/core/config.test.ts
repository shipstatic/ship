import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../../../src/shared/lib/env', () => ({
  getENV: vi.fn(() => 'node'),
}));

describe('Node.js SDK env-var resolution', () => {
  let config: typeof import('../../../src/node/core/config');
  let sharedConfig: typeof import('../../../src/shared/core/config');
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    originalEnv = { ...process.env };

    delete process.env.SHIP_API_URL;
    delete process.env.SHIP_API_KEY;
    delete process.env.SHIP_DEPLOY_TOKEN;

    const { getENV } = await import('../../../src/shared/lib/env');
    (getENV as any).mockReturnValue('node');

    config = await import('../../../src/node/core/config');
    sharedConfig = await import('../../../src/shared/core/config');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('readEnvConfig', () => {
    it('returns empty object outside Node.js', async () => {
      const { getENV } = await import('../../../src/shared/lib/env');
      (getENV as any).mockReturnValue('browser');

      expect(config.readEnvConfig()).toEqual({});
    });

    it('reads SHIP_* env vars', () => {
      process.env.SHIP_API_URL = 'https://api.example.com';
      process.env.SHIP_API_KEY = 'ship-key';
      process.env.SHIP_DEPLOY_TOKEN = 'token-token';

      expect(config.readEnvConfig()).toEqual({
        apiUrl: 'https://api.example.com',
        apiKey: 'ship-key',
        deployToken: 'token-token',
      });
    });

    it('treats empty-string env vars as unset (CI/Docker quirk)', () => {
      // Some CI runners and Docker setups initialize env vars to "" rather than
      // unsetting them. Without this normalization, an empty string would either
      // fail zod's "min length 1" check or override a legitimate constructor arg.
      process.env.SHIP_API_URL = '';
      process.env.SHIP_API_KEY = '';
      process.env.SHIP_DEPLOY_TOKEN = '';

      expect(config.readEnvConfig()).toEqual({});
    });

    it('does not touch the filesystem (no .shiprc lookup)', () => {
      // Regression: the SDK must not read files. Embedded consumers like MCP
      // rely on this — a host's ~/.shiprc must never leak into a `new Ship({})`.
      // We assert by environment-variable behavior: no env, no result. If file
      // resolution ever crept back in, this could return file-derived creds.
      expect(config.readEnvConfig()).toEqual({});
    });

    it('rejects malformed apiUrl with a message that names the actual env var', () => {
      // Regression: an earlier version up-cased the camelCase field name and
      // produced "SHIP_APIURL", which doesn't exist. The message has to point
      // users at SHIP_API_URL or it's worse than no message at all.
      process.env.SHIP_API_URL = 'not-a-url';
      expect(() => config.readEnvConfig()).toThrow(/SHIP_API_URL/);
    });
  });

  describe('resolveConfig', () => {
    it('uses the default API URL when none is provided', () => {
      expect(sharedConfig.resolveConfig()).toEqual({
        apiUrl: 'https://api.shipstatic.com',
      });
    });

    it('passes through a user-supplied apiUrl', () => {
      expect(sharedConfig.resolveConfig({
        apiUrl: 'https://user.example.com',
        apiKey: 'ship-key',
      })).toEqual({
        apiUrl: 'https://user.example.com',
        apiKey: 'ship-key',
      });
    });

    it('omits apiKey and deployToken when undefined (rather than including them as undefined)', () => {
      // Spread merges downstream rely on absent fields; an undefined value
      // would shadow defaults from `clientDefaults` in `mergeDeployOptions`.
      const result = sharedConfig.resolveConfig({ apiUrl: 'https://x.com' });
      expect(result).toEqual({ apiUrl: 'https://x.com' });
      expect('apiKey' in result).toBe(false);
      expect('deployToken' in result).toBe(false);
    });
  });

  describe('mergeDeployOptions', () => {
    it('merges per-deploy options with client defaults', () => {
      const result = sharedConfig.mergeDeployOptions(
        { timeout: 5000 },
        { apiUrl: 'https://api.example.com', apiKey: 'default-key', timeout: 10000, maxConcurrency: 3 }
      );
      expect(result).toEqual({
        timeout: 5000,
        maxConcurrency: 3,
        apiKey: 'default-key',
        apiUrl: 'https://api.example.com',
      });
    });

    it('does not override user options with defaults', () => {
      const result = sharedConfig.mergeDeployOptions(
        { timeout: 5000, apiKey: 'user-key' },
        { timeout: 10000, apiKey: 'default-key' }
      );
      expect(result).toEqual({
        timeout: 5000,
        apiKey: 'user-key',
      });
    });
  });
});
