/**
 * @file Subject: `src/node/index.ts`, the Node entry: what `Ship` adds where
 * there is a filesystem and a process. The `SHIP_*` variables fill what the
 * constructor left out, and a deploy takes paths as well as `File`s. What
 * the class does everywhere is `tests/shared/ship*.test.ts`.
 *
 * Nothing inside the SDK is replaced here: the environment is the real one,
 * the folders are real, and every row reads what the client hands to `fetch`.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_API } from '@shipstatic/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NodeDefault, { Ship } from '../../src/node/index';
import { Ship as SharedShip } from '../../src/shared/ship';
import type { Fetch, ShipClientOptions } from '../../src/shared/types';
import { apiKey, deployToken, FREE_PLAN_LIMITS } from '../fixtures/builders';

const SPA_SITE = path.resolve(__dirname, '../fixtures/spa-site');
const SHIP_JSON = path.resolve(__dirname, '../fixtures/nested-site/dist/ship.json');

const ENV_TOKEN = apiKey('e');
const ARGUMENT_TOKEN = deployToken('a');

/** One request, as the client handed it to `fetch`. */
interface Sent {
  url: string;
  authorization: string | undefined;
  body: unknown;
}

/** A client whose requests are answered here and kept for the row to read. */
function client(options: ShipClientOptions = {}) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    sent.push({ url, authorization: headers?.Authorization, body: init?.body });
    return Response.json(
      url.endsWith('/limits')
        ? FREE_PLAN_LIMITS
        : { deployment: 'dep.shipstatic.com', url: 'https://dep.shipstatic.com' },
    );
  }) as unknown as Fetch;
  return { ship: new Ship({ fetch, ...options }), sent };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the Node entry', () => {
  it('is the shared class with one method overridden, by name and as the default', () => {
    expect(NodeDefault).toBe(Ship);
    expect(Object.getPrototypeOf(Ship)).toBe(SharedShip);
    expect(Object.getOwnPropertyNames(Ship.prototype).sort()).toEqual(['constructor', 'sources']);
  });

  describe('the SHIP_* variables', () => {
    /** Where the client's one request went, and as whom. */
    const pinged = async (options?: ShipClientOptions) => {
      const { ship, sent } = client(options);
      await ship.ping();
      return sent[0];
    };

    it('fill what the constructor left out', async () => {
      vi.stubEnv('SHIP_TOKEN', ENV_TOKEN);
      vi.stubEnv('SHIP_API_URL', 'https://env.example.com');

      expect(await pinged()).toMatchObject({
        url: 'https://env.example.com/ping',
        authorization: `Bearer ${ENV_TOKEN}`,
      });
    });

    it('sit under the constructor arguments', async () => {
      vi.stubEnv('SHIP_TOKEN', ENV_TOKEN);
      vi.stubEnv('SHIP_API_URL', 'https://env.example.com');

      expect(
        await pinged({ token: ARGUMENT_TOKEN, apiUrl: 'https://argument.example.com' }),
      ).toMatchObject({
        url: 'https://argument.example.com/ping',
        authorization: `Bearer ${ARGUMENT_TOKEN}`,
      });
    });

    it('fill each value on its own: an argument for one leaves the other to its variable', async () => {
      vi.stubEnv('SHIP_TOKEN', ENV_TOKEN);
      vi.stubEnv('SHIP_API_URL', 'https://env.example.com');

      expect(await pinged({ apiUrl: 'https://argument.example.com' })).toMatchObject({
        url: 'https://argument.example.com/ping',
        authorization: `Bearer ${ENV_TOKEN}`,
      });
    });

    it('supply the token when the argument is an empty string, which is no token', async () => {
      // An unset CI variable, expanded by the shell, arrives as ''.
      vi.stubEnv('SHIP_TOKEN', ENV_TOKEN);

      expect((await pinged({ token: '' })).authorization).toBe(`Bearer ${ENV_TOKEN}`);
    });

    it('leave a cookie session alone: the token in the environment does not ride along', async () => {
      vi.stubEnv('SHIP_TOKEN', ENV_TOKEN);

      expect((await pinged({ session: true })).authorization).toBeUndefined();
    });

    it('are judged only when used: a bad variable under an argument refuses nothing', async () => {
      vi.stubEnv('SHIP_API_URL', 'not-a-url');

      expect((await pinged({ apiUrl: 'https://argument.example.com' })).url).toBe(
        'https://argument.example.com/ping',
      );
    });

    it('refuse the client when the one it would use is no URL, naming the variable', () => {
      vi.stubEnv('SHIP_API_URL', 'not-a-url');

      expect(() => new Ship()).toThrow('Invalid SHIP_API_URL');
    });
  });

  describe('a config file', () => {
    it('is never read: a token in ~/.shiprc reaches no request', async () => {
      // The file is the CLI's. An embedded host (the MCP server, the GitHub
      // Action) builds `new Ship()` for an anonymous deploy, and must not
      // deploy as whoever owns the computer it runs on.
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-home-'));
      fs.writeFileSync(
        path.join(home, '.shiprc'),
        JSON.stringify({ token: apiKey('f'), apiUrl: 'https://file.example.com' }),
      );
      vi.stubEnv('HOME', home);
      vi.stubEnv('USERPROFILE', home);

      try {
        const { ship, sent } = client();
        await ship.ping();

        expect(sent).toEqual([
          { url: `${DEFAULT_API}/ping`, authorization: undefined, body: undefined },
        ]);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  });

  describe("a deploy's input", () => {
    /** The names the deploy sent its files under. */
    const names = (sent: Sent[]) => {
      const deploy = sent[sent.length - 1].body as FormData;
      return (deploy.getAll('files[]') as File[]).map((file) => file.name).sort();
    };

    it.each([
      ['a path', SPA_SITE, ['app.js', 'index.html']],
      ['a list of paths', [SPA_SITE, SHIP_JSON], ['app.js', 'index.html', 'ship.json']],
    ])('walks %s', async (_what, input, expected) => {
      const { ship, sent } = client();

      await ship.deploy(input);

      expect(names(sent)).toEqual(expected);
    });

    it('takes Files as every runtime does', async () => {
      const { ship, sent } = client();

      await ship.deploy([new File(['<html></html>'], 'index.html')]);

      expect(names(sent)).toEqual(['index.html']);
    });

    it.each([
      [
        "a file input's FileList",
        { 0: new File(['x'], 'index.html'), length: 1, item: () => null },
      ],
      ['a file input', { tagName: 'INPUT', type: 'file', files: null }],
      ['a list that mixes Files and paths', [new File(['x'], 'index.html'), './dist']],
      ['nothing', undefined],
    ])('refuses %s in words, with no request', async (_what, input) => {
      const { ship, sent } = client();

      await expect(ship.deploy(input as never)).rejects.toThrow(
        'A deploy takes a list of File objects, a path, or a list of paths.',
      );
      expect(sent).toEqual([]);
    });
  });
});
