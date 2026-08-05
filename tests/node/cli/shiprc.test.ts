/**
 * @file Tests for the CLI's `.shiprc` / `package.json` loader.
 *
 * The CLI is the only place that touches the filesystem for credentials —
 * the SDK reads only `SHIP_*` env vars. These tests cover what the CLI loader
 * actually needs to do: cosmiconfig directory traversal, home-dir fallback,
 * explicit-path loading via `--config`, and schema validation.
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadShipFile } from '../../../src/node/cli/shiprc';

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: vi.fn() };
});

describe('CLI shiprc loader', () => {
  let tempDir: string;
  let dirs: { home: string; shallow: string; middle: string; deep: string };
  let originalCwd: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-shiprc-test-'));
    dirs = {
      home: path.join(tempDir, 'home'),
      shallow: path.join(tempDir, 'home', 'a'),
      middle: path.join(tempDir, 'home', 'a', 'b'),
      deep: path.join(tempDir, 'home', 'a', 'b', 'c'),
    };
    await fs.mkdir(dirs.deep, { recursive: true });

    originalHome = process.env.HOME;
    process.env.HOME = dirs.home;
    vi.mocked(os.homedir).mockReturnValue(dirs.home);

    originalCwd = process.cwd();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('search', () => {
    it('returns empty when no config file exists', async () => {
      process.chdir(dirs.deep);
      expect(loadShipFile()).toEqual({});
    });

    it('finds .shiprc in the current directory', async () => {
      // Token only: a project file may name a credential but not the endpoint
      // it is sent to (see "a project config may not choose the endpoint").
      await fs.writeFile(path.join(dirs.deep, '.shiprc'), JSON.stringify({ token: 'cwd-token' }));
      process.chdir(dirs.deep);

      expect(loadShipFile()).toEqual({ token: 'cwd-token' });
    });

    it('walks up the directory tree to find .shiprc', async () => {
      await fs.writeFile(
        path.join(dirs.shallow, '.shiprc'),
        JSON.stringify({ token: 'shallow-token' }),
      );
      process.chdir(dirs.deep);

      const result = loadShipFile();
      expect(result.token).toBe('shallow-token');
    });

    it('falls back to $HOME/.shiprc when no project file is found', async () => {
      await fs.writeFile(path.join(dirs.home, '.shiprc'), JSON.stringify({ token: 'home-token' }));
      process.chdir(dirs.deep);

      const result = loadShipFile();
      expect(result.token).toBe('home-token');
    });

    it('reads the "ship" key from package.json', async () => {
      await fs.writeFile(
        path.join(dirs.middle, 'package.json'),
        JSON.stringify({
          name: 'test-pkg',
          ship: { token: 'pkg-token' },
        }),
      );
      process.chdir(dirs.deep);

      expect(loadShipFile()).toEqual({ token: 'pkg-token' });
    });

    it('prefers the closer config when multiple are present', async () => {
      // .shiprc in the deep dir should win over a $HOME/.shiprc.
      await fs.writeFile(path.join(dirs.home, '.shiprc'), JSON.stringify({ token: 'home-token' }));
      await fs.writeFile(path.join(dirs.deep, '.shiprc'), JSON.stringify({ token: 'deep-token' }));
      process.chdir(dirs.deep);

      const result = loadShipFile();
      expect(result.token).toBe('deep-token');
    });
  });

  describe('explicit path (--config)', () => {
    it('loads the exact file when a path is provided', async () => {
      const explicit = path.join(tempDir, 'custom.json');
      await fs.writeFile(
        explicit,
        JSON.stringify({ token: 'explicit-token', apiUrl: 'https://explicit.example.com' }),
      );
      process.chdir(dirs.deep);

      expect(loadShipFile(explicit)).toEqual({
        token: 'explicit-token',
        apiUrl: 'https://explicit.example.com',
      });
    });

    it.each([
      ['.shiprc', 'the conventional name, in another directory'],
      ['dev.shiprc', 'the two-environment convention'],
      ['prod.shiprc', 'its sibling'],
      ['custom.shiprc.json', 'name plus an explicit extension'],
      ['.shiprc-dev', 'a suffixed variant'],
    ])('loads %s (%s)', async (filename) => {
      // `--config` is "load exactly this file", so every spelling a user might
      // reach for must work. `dev.shiprc` did not until 2026-07-30: its
      // extname IS `.shiprc`, and cosmiconfig had no loader registered for
      // that, so it threw `No loader specified for extension ".shiprc"` while
      // the identically-formatted `.shiprc` beside it loaded fine.
      const explicit = path.join(dirs.deep, filename);
      await fs.writeFile(explicit, JSON.stringify({ token: `token-${filename}` }));

      expect(loadShipFile(explicit)).toEqual({ token: `token-${filename}` });
    });

    it('throws when the explicit path does not exist', () => {
      // Surfacing the typo immediately is much clearer than a downstream
      // "auth failed" — the user knows exactly which file we couldn't read.
      expect(() => loadShipFile('/non/existent/path.shiprc')).toThrow(/Failed to read ship config/);
    });

    it('supports relative paths', async () => {
      await fs.writeFile(
        path.join(dirs.middle, 'ship.config.json'),
        JSON.stringify({ token: 'relative-token' }),
      );
      process.chdir(dirs.deep);

      const result = loadShipFile('../ship.config.json');
      expect(result.token).toBe('relative-token');
    });
  });

  describe('a project config may not choose the endpoint', () => {
    // Verified against the real binary on 2026-07-30: a cloned repo whose
    // `package.json` carried `{"ship": {"apiUrl": "http://127.0.0.1:19099"}}`
    // received `Authorization: Bearer <the user's SHIP_TOKEN>` on a plain
    // `ship deployments list` — exit 0, no warning. The search reaches project
    // files before `$HOME/.shiprc`, which is right for configuration and wrong
    // for a destination.
    //
    // Only reachable when the credential comes from env or `--token`: if the
    // project file wins the search, `~/.shiprc` is never read, so a user whose
    // token lives only there has none to leak. `SHIP_TOKEN` is the documented
    // CI path, so that population is the realistic one.
    it.each([
      ['./.shiprc', (d: typeof dirs) => path.join(d.deep, '.shiprc'), false],
      ['a parent .shiprc', (d: typeof dirs) => path.join(d.shallow, '.shiprc'), false],
      ['package.json', (d: typeof dirs) => path.join(d.middle, 'package.json'), true],
    ])('refuses apiUrl from %s', async (_name, target, isPkg) => {
      const body = isPkg
        ? { name: 'some-cloned-repo', ship: { apiUrl: 'https://evil.example.com' } }
        : { apiUrl: 'https://evil.example.com' };
      await fs.writeFile(target(dirs), JSON.stringify(body));
      process.chdir(dirs.deep);

      expect(() => loadShipFile()).toThrow(/"apiUrl" may not come from a project config/);
    });

    it('still accepts a token from a project config', async () => {
      // The credential half is legitimate — only the endpoint is refused.
      await fs.writeFile(path.join(dirs.deep, '.shiprc'), JSON.stringify({ token: 'proj-token' }));
      process.chdir(dirs.deep);

      expect(loadShipFile()).toEqual({ token: 'proj-token' });
    });

    it('accepts apiUrl from the home file, which is the user’s own', async () => {
      await fs.writeFile(
        path.join(dirs.home, '.shiprc'),
        JSON.stringify({ token: 'home-token', apiUrl: 'https://api.example.com' }),
      );
      process.chdir(dirs.deep);

      expect(loadShipFile()).toEqual({
        token: 'home-token',
        apiUrl: 'https://api.example.com',
      });
    });

    it('accepts apiUrl from an explicit --config, because naming a file is intent', async () => {
      const explicit = path.join(dirs.deep, 'dev.shiprc');
      await fs.writeFile(explicit, JSON.stringify({ apiUrl: 'https://api.example.com' }));
      process.chdir(dirs.deep);

      expect(loadShipFile(explicit)).toEqual({ apiUrl: 'https://api.example.com' });
    });
  });

  describe('validation', () => {
    it('throws on invalid apiUrl', async () => {
      // In the HOME file, which is the only searched place allowed to set an
      // endpoint — from a project file it would be refused before the URL was
      // ever judged, so this would pass for the wrong reason.
      await fs.writeFile(path.join(dirs.home, '.shiprc'), JSON.stringify({ apiUrl: 'not-a-url' }));
      process.chdir(dirs.deep);

      expect(() => loadShipFile()).toThrow(/Invalid config/);
    });

    it('rejects empty-string credentials', async () => {
      await fs.writeFile(path.join(dirs.deep, '.shiprc'), JSON.stringify({ token: '' }));
      process.chdir(dirs.deep);

      expect(() => loadShipFile()).toThrow(/Invalid config/);
    });

    it('rejects unknown keys (strict schema)', async () => {
      await fs.writeFile(
        path.join(dirs.deep, '.shiprc'),
        JSON.stringify({ token: 'some-token', unknownField: 'huh' }),
      );
      process.chdir(dirs.deep);

      expect(() => loadShipFile()).toThrow(/Invalid config/);
    });

    it('names the rename for a retired credential key', async () => {
      await fs.writeFile(
        path.join(dirs.deep, '.shiprc'),
        JSON.stringify({ apiKey: `ship-${'a'.repeat(64)}` }),
      );
      process.chdir(dirs.deep);

      expect(() => loadShipFile()).toThrow(
        /"apiKey" is no longer supported — the key is now "token"/,
      );
    });

    it('names both retired keys when both are present', async () => {
      await fs.writeFile(
        path.join(dirs.deep, '.shiprc'),
        JSON.stringify({ apiKey: 'a', deployToken: 'b' }),
      );
      process.chdir(dirs.deep);

      expect(() => loadShipFile()).toThrow(/"apiKey" and "deployToken" are no longer supported/);
    });

    it('returns empty for an empty config file', async () => {
      await fs.writeFile(path.join(dirs.deep, '.shiprc'), '{}');
      process.chdir(dirs.deep);

      expect(loadShipFile()).toEqual({});
    });
  });
});
