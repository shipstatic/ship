import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Node.js SDK env-var resolution', () => {
  let config: typeof import('../../../src/node/core/config');
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    originalEnv = { ...process.env };

    delete process.env.SHIP_API_URL;
    delete process.env.SHIP_TOKEN;

    config = await import('../../../src/node/core/config');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('readEnvConfig', () => {
    it('reads SHIP_* env vars', () => {
      process.env.SHIP_API_URL = 'https://api.example.com';
      process.env.SHIP_TOKEN = 'env-token';

      expect(config.readEnvConfig()).toEqual({
        apiUrl: 'https://api.example.com',
        token: 'env-token',
      });
    });

    it('treats empty-string env vars as unset (CI/Docker quirk)', () => {
      // Some CI runners and Docker setups initialize env vars to "" rather than
      // unsetting them. Without this normalization, an empty string would either
      // fail zod's "min length 1" check or override a legitimate constructor arg.
      process.env.SHIP_API_URL = '';
      process.env.SHIP_TOKEN = '';

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
      expect(() => config.readEnvConfig().apiUrl).toThrow(/SHIP_API_URL/);
    });

    it('judges a variable when it is read, so a bad one nobody reads refuses nothing', () => {
      process.env.SHIP_API_URL = 'not-a-url';
      process.env.SHIP_TOKEN = 'env-token';

      expect(config.readEnvConfig().token).toBe('env-token');
    });
  });
});
