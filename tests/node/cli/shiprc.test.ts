/**
 * @file Subject: `src/node/cli/shiprc.ts` — the CLI's config-file reader.
 *
 * The CLI is the only place that touches the filesystem for credentials; the
 * SDK reads only `SHIP_*` env vars. Two locations exist and no repository file
 * is one of them, so these tests cover exactly that: `~/.shiprc`, the
 * `--config` path, strict-JSON parsing, and schema validation.
 *
 * The directory-walk and `package.json` blocks that used to live here went
 * with the search itself in 2.0.0 (see CLAUDE.md, "no repository file is ever
 * read"). What replaced them is the booby-trap test at the bottom, which is
 * the only one of the group with teeth.
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
  let dirs: { home: string; project: string };
  let originalCwd: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-shiprc-test-'));
    dirs = {
      home: path.join(tempDir, 'home'),
      project: path.join(tempDir, 'home', 'work', 'project'),
    };
    await fs.mkdir(dirs.project, { recursive: true });

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

  describe('the home file', () => {
    it('returns empty when it does not exist', () => {
      process.chdir(dirs.project);
      expect(loadShipFile()).toEqual({});
    });

    it('reads ~/.shiprc regardless of the working directory', async () => {
      await fs.writeFile(
        path.join(dirs.home, '.shiprc'),
        JSON.stringify({ token: 'home-token', apiUrl: 'https://api.example.com' }),
      );
      process.chdir(dirs.project);

      expect(loadShipFile()).toEqual({
        token: 'home-token',
        apiUrl: 'https://api.example.com',
      });
    });

    it('treats an empty file as an absent config, not a broken one', async () => {
      // `touch ~/.shiprc` and any interrupted write produce this, and both are
      // ordinary. Refusing it would send the user to `ship config` to repair a
      // file that is fine.
      await fs.writeFile(path.join(dirs.home, '.shiprc'), '');
      process.chdir(dirs.project);

      expect(loadShipFile()).toEqual({});
    });

    it('treats a whitespace-only file the same way', async () => {
      await fs.writeFile(path.join(dirs.home, '.shiprc'), '\n   \n');
      process.chdir(dirs.project);

      expect(loadShipFile()).toEqual({});
    });
  });

  describe('explicit path (--config)', () => {
    it('loads the exact file when a path is provided', async () => {
      const explicit = path.join(tempDir, 'custom.json');
      await fs.writeFile(
        explicit,
        JSON.stringify({ token: 'explicit-token', apiUrl: 'https://explicit.example.com' }),
      );
      process.chdir(dirs.project);

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
      // reach for must work. These were once a real bug class — the loader
      // dispatched on file extension, so `dev.shiprc` threw where `.shiprc`
      // loaded. There is no extension dispatch any more: a path is just read.
      const explicit = path.join(dirs.project, filename);
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
        path.join(dirs.project, 'ship.config.json'),
        JSON.stringify({ token: 'relative-token' }),
      );
      process.chdir(dirs.project);

      expect(loadShipFile('./ship.config.json').token).toBe('relative-token');
    });

    it('an empty --config falls through to the home file', async () => {
      // `--config "$VAR"` with VAR unset must not error; it is absence.
      await fs.writeFile(path.join(dirs.home, '.shiprc'), JSON.stringify({ token: 'home-token' }));
      process.chdir(dirs.project);

      expect(loadShipFile('')).toEqual({ token: 'home-token' });
    });
  });

  describe('no repository file is ever read', () => {
    // The reason the project search is gone, stated as behavior. Two exploits
    // were verified against the real binary before this change (CLAUDE.md
    // carries the transcripts): a cloned repo's `package.json` could redirect
    // `apiUrl` and receive the user's bearer token, and — worse, because it
    // survived the first patch — a repo's `token` outranked `~/.shiprc`
    // entirely, so `ship ./dist` deployed to the repo owner's account.
    //
    // Both were properties of the SURFACE, not of any particular field, which
    // is why the fix is a deletion rather than a rule.
    const planted = {
      token: `ship-${'b'.repeat(64)}`,
      apiUrl: 'http://127.0.0.1:1',
    };

    it.each([
      ['./.shiprc', '.shiprc', (c: object) => c],
      ['./package.json', 'package.json', (c: object) => ({ name: 'cloned-repo', ship: c })],
    ])('ignores a planted %s entirely', async (_name, filename, wrap) => {
      await fs.writeFile(path.join(dirs.project, filename), JSON.stringify(wrap(planted)));
      await fs.writeFile(
        path.join(dirs.home, '.shiprc'),
        JSON.stringify({ token: `ship-${'a'.repeat(64)}` }),
      );
      process.chdir(dirs.project);

      // The user's own credential, and no endpoint from the repository.
      expect(loadShipFile()).toEqual({ token: `ship-${'a'.repeat(64)}` });
    });

    it('a planted project file cannot even supply config when the home file is absent', async () => {
      await fs.writeFile(path.join(dirs.project, '.shiprc'), JSON.stringify(planted));
      process.chdir(dirs.project);

      expect(loadShipFile()).toEqual({});
    });

    it('a broken project file cannot break the CLI either', async () => {
      // It is not read, so it cannot even raise a parse error — which is the
      // difference between "not trusted" and "not consulted".
      await fs.writeFile(path.join(dirs.project, '.shiprc'), '{ this is not json');
      process.chdir(dirs.project);

      expect(loadShipFile()).toEqual({});
    });
  });

  describe('format', () => {
    it.each([
      ['a trailing comma', '{"token": "x",}'],
      ['a YAML mapping', 'token: x'],
      ['a comment', '{"token": "x"} // nope'],
      ['a bare scalar', 'not json at all'],
      ['a list', '["token"]'],
    ])('refuses %s — the file is strict JSON', async (_name, contents) => {
      await fs.writeFile(path.join(dirs.home, '.shiprc'), contents);
      process.chdir(dirs.project);

      expect(() => loadShipFile()).toThrow(/Invalid config in/);
    });
  });

  describe('validation', () => {
    it('throws on invalid apiUrl', async () => {
      await fs.writeFile(path.join(dirs.home, '.shiprc'), JSON.stringify({ apiUrl: 'not-a-url' }));
      process.chdir(dirs.project);

      expect(() => loadShipFile()).toThrow(/Invalid config/);
    });

    it('rejects empty-string credentials', async () => {
      await fs.writeFile(path.join(dirs.home, '.shiprc'), JSON.stringify({ token: '' }));
      process.chdir(dirs.project);

      expect(() => loadShipFile()).toThrow(/Invalid config/);
    });

    it('rejects unknown keys (strict schema)', async () => {
      await fs.writeFile(
        path.join(dirs.home, '.shiprc'),
        JSON.stringify({ token: 'some-token', unknownField: 'huh' }),
      );
      process.chdir(dirs.project);

      expect(() => loadShipFile()).toThrow(/Invalid config/);
    });

    it('names the rename for a retired credential key', async () => {
      await fs.writeFile(
        path.join(dirs.home, '.shiprc'),
        JSON.stringify({ apiKey: `ship-${'a'.repeat(64)}` }),
      );
      process.chdir(dirs.project);

      expect(() => loadShipFile()).toThrow(
        /"apiKey" is no longer supported — the key is now "token"/,
      );
    });

    it('names both retired keys when both are present', async () => {
      await fs.writeFile(
        path.join(dirs.home, '.shiprc'),
        JSON.stringify({ apiKey: 'a', deployToken: 'b' }),
      );
      process.chdir(dirs.project);

      expect(() => loadShipFile()).toThrow(/"apiKey" and "deployToken" are no longer supported/);
    });

    it('returns empty for an empty JSON object', async () => {
      await fs.writeFile(path.join(dirs.home, '.shiprc'), '{}');
      process.chdir(dirs.project);

      expect(loadShipFile()).toEqual({});
    });
  });
});
