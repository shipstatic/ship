/**
 * @file Tests for the CLI's `.shiprc` / `package.json` loader.
 *
 * The CLI is the only place that touches the filesystem for credentials —
 * the SDK reads only `SHIP_*` env vars. These tests cover what the CLI loader
 * actually needs to do: cosmiconfig directory traversal, home-dir fallback,
 * explicit-path loading via `--config`, and schema validation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
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
      await fs.writeFile(
        path.join(dirs.deep, '.shiprc'),
        JSON.stringify({ apiKey: 'ship-cwd', apiUrl: 'https://cwd.example.com' })
      );
      process.chdir(dirs.deep);

      expect(loadShipFile()).toEqual({
        apiKey: 'ship-cwd',
        apiUrl: 'https://cwd.example.com',
      });
    });

    it('walks up the directory tree to find .shiprc', async () => {
      await fs.writeFile(
        path.join(dirs.shallow, '.shiprc'),
        JSON.stringify({ apiKey: 'ship-shallow' })
      );
      process.chdir(dirs.deep);

      const result = loadShipFile();
      expect(result.apiKey).toBe('ship-shallow');
    });

    it('falls back to $HOME/.shiprc when no project file is found', async () => {
      await fs.writeFile(
        path.join(dirs.home, '.shiprc'),
        JSON.stringify({ apiKey: 'ship-home' })
      );
      process.chdir(dirs.deep);

      const result = loadShipFile();
      expect(result.apiKey).toBe('ship-home');
    });

    it('reads the "ship" key from package.json', async () => {
      await fs.writeFile(
        path.join(dirs.middle, 'package.json'),
        JSON.stringify({
          name: 'test-pkg',
          ship: { apiKey: 'ship-pkg', apiUrl: 'https://pkg.example.com' },
        })
      );
      process.chdir(dirs.deep);

      expect(loadShipFile()).toEqual({
        apiKey: 'ship-pkg',
        apiUrl: 'https://pkg.example.com',
      });
    });

    it('prefers the closer config when multiple are present', async () => {
      // .shiprc in the deep dir should win over a $HOME/.shiprc.
      await fs.writeFile(
        path.join(dirs.home, '.shiprc'),
        JSON.stringify({ apiKey: 'ship-home' })
      );
      await fs.writeFile(
        path.join(dirs.deep, '.shiprc'),
        JSON.stringify({ apiKey: 'ship-deep' })
      );
      process.chdir(dirs.deep);

      const result = loadShipFile();
      expect(result.apiKey).toBe('ship-deep');
    });
  });

  describe('explicit path (--config)', () => {
    it('loads the exact file when a path is provided', async () => {
      // cosmiconfig parses `.json` (and `.shiprc`-named) files directly.
      const explicit = path.join(tempDir, 'custom.json');
      await fs.writeFile(
        explicit,
        JSON.stringify({ apiKey: 'ship-explicit', apiUrl: 'https://explicit.example.com' })
      );
      process.chdir(dirs.deep);

      expect(loadShipFile(explicit)).toEqual({
        apiKey: 'ship-explicit',
        apiUrl: 'https://explicit.example.com',
      });
    });

    it('throws when the explicit path does not exist', () => {
      // Surfacing the typo immediately is much clearer than a downstream
      // "auth failed" — the user knows exactly which file we couldn't read.
      expect(() => loadShipFile('/non/existent/path.shiprc'))
        .toThrow(/Failed to read ship config/);
    });

    it('supports relative paths', async () => {
      await fs.writeFile(
        path.join(dirs.middle, 'ship.config.json'),
        JSON.stringify({ apiKey: 'ship-relative' })
      );
      process.chdir(dirs.deep);

      const result = loadShipFile('../ship.config.json');
      expect(result.apiKey).toBe('ship-relative');
    });
  });

  describe('validation', () => {
    it('throws on invalid apiUrl', async () => {
      await fs.writeFile(
        path.join(dirs.deep, '.shiprc'),
        JSON.stringify({ apiUrl: 'not-a-url' })
      );
      process.chdir(dirs.deep);

      expect(() => loadShipFile()).toThrow(/Invalid config/);
    });

    it('rejects empty-string credentials', async () => {
      await fs.writeFile(
        path.join(dirs.deep, '.shiprc'),
        JSON.stringify({ apiKey: '' })
      );
      process.chdir(dirs.deep);

      expect(() => loadShipFile()).toThrow(/Invalid config/);
    });

    it('rejects unknown keys (strict schema)', async () => {
      await fs.writeFile(
        path.join(dirs.deep, '.shiprc'),
        JSON.stringify({ apiKey: 'ship-key', unknownField: 'huh' })
      );
      process.chdir(dirs.deep);

      expect(() => loadShipFile()).toThrow(/Invalid config/);
    });

    it('returns empty for an empty config file', async () => {
      await fs.writeFile(path.join(dirs.deep, '.shiprc'), '{}');
      process.chdir(dirs.deep);

      expect(loadShipFile()).toEqual({});
    });
  });
});
