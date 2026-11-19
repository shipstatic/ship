/**
 * @file Subject: `src/node/index.ts`, the Node entry: what `Ship` adds where
 * there is a filesystem and a process. The `SHIP_*` variables fill what the
 * constructor left out, and a deploy takes paths as well as `File`s. What
 * the class does everywhere is `tests/shared/ship*.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findSources } from '../../src/node/core/node-files';
import NodeDefault, { Ship } from '../../src/node/index';
import { Ship as SharedShip } from '../../src/shared/ship';
import { FREE_PLAN_LIMITS } from '../fixtures/builders';
import { fakeTransport } from '../mocks/transport';

// Mock the ApiHttp class to prevent real network calls. Keyed by OPERATION,
// because a transport has two methods since the endpoint tier folded down —
// see `tests/mocks/transport.ts`.
const mockApiClient = fakeTransport({
  Deploy: { deployment: 'dep_123', url: 'https://dep_123.shipstatic.com' },
  'Get limits': FREE_PLAN_LIMITS,
});

// `function`, not an arrow: vitest 4 invokes constructor mocks with `new`,
// and an arrow function cannot be constructed. Returning an object from a
// constructor overrides `this`, so `new ApiHttp(...)` yields the double.
vi.mock('../../src/shared/api/http', () => ({
  ApiHttp: vi.fn(function ApiHttp() {
    return mockApiClient;
  }),
}));

// The filesystem walk answers one fixed file; the shared pipeline is real.
vi.mock('../../src/node/core/node-files', () => ({
  findSources: vi
    .fn()
    .mockResolvedValue([
      { path: 'index.html', size: 13, read: async () => new Blob(['<html></html>']) },
    ]),
}));

// Mock env-var resolution. The Node Ship reads SHIP_* env vars synchronously
// in the constructor; this mock lets tests assert what was read without
// needing to mutate process.env.
vi.mock('../../src/node/core/config', () => ({
  readEnvConfig: vi.fn(() => ({})),
}));

describe('the Node entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is the shared class with one method overridden, by name and as the default', () => {
    expect(NodeDefault).toBe(Ship);
    expect(Object.getPrototypeOf(Ship)).toBe(SharedShip);
    expect(Object.getOwnPropertyNames(Ship.prototype).sort()).toEqual(['constructor', 'sources']);
  });

  describe('env-var resolution', () => {
    it('reads SHIP_TOKEN and adopts it as the credential', async () => {
      const { readEnvConfig } = await import('../../src/node/core/config');
      (readEnvConfig as any).mockReturnValue({
        token: 'env-token',
        apiUrl: 'https://env.example.com',
      });

      const ship = new Ship({});

      // The credential is set synchronously from the merged constructor args.
      expect((ship as any).credential).toBe('env-token');
      expect((ship as any).clientOptions.apiUrl).toBe('https://env.example.com');
    });

    it('prefers constructor args over env vars', async () => {
      const { readEnvConfig } = await import('../../src/node/core/config');
      (readEnvConfig as any).mockReturnValue({
        token: 'env-token',
        apiUrl: 'https://env.example.com',
      });

      const ship = new Ship({ token: 'explicit-token', apiUrl: 'https://explicit.example.com' });

      expect((ship as any).credential).toBe('explicit-token');
      expect((ship as any).clientOptions.apiUrl).toBe('https://explicit.example.com');
    });

    it('session is a credential choice — the ambient token does not ride along', async () => {
      const { readEnvConfig } = await import('../../src/node/core/config');
      (readEnvConfig as any).mockReturnValue({ token: 'env-token' });

      const ship = new Ship({ session: true });

      // Cookie session: no token credential, no Authorization header.
      expect((ship as any).credential).toBeNull();
      expect(await (ship as any).getAuthHeaders()).toEqual({});
    });

    it('empty-string constructor token is absence — env supplies the credential', async () => {
      const { readEnvConfig } = await import('../../src/node/core/config');
      (readEnvConfig as any).mockReturnValue({ token: 'env-token' });

      // Shell expansion of an unset CI variable produces '' — absence of
      // intent, so the constructor is credential-less and env is the source.
      const ship = new Ship({ token: '' });

      expect((ship as any).credential).toBe('env-token');
    });

    it('fills only the field the constructor left out', async () => {
      // The two sources compose per-value rather than all-or-nothing: an
      // explicit apiUrl does not suppress the ambient token.
      const { readEnvConfig } = await import('../../src/node/core/config');
      (readEnvConfig as any).mockReturnValue({
        token: 'env-token',
        apiUrl: 'https://env.example.com',
      });

      const ship = new Ship({ apiUrl: 'https://explicit.example.com' });

      expect((ship as any).clientOptions.apiUrl).toBe('https://explicit.example.com');
      expect((ship as any).credential).toBe('env-token');
    });

    it('does not read the filesystem (no .shiprc lookup in SDK)', async () => {
      // Regression: this is the credential-isolation contract that embedded
      // consumers (MCP, n8n, GitHub Action) depend on. The SDK must never
      // reach into the host's ~/.shiprc — file resolution is the CLI's job.
      const { readEnvConfig } = await import('../../src/node/core/config');
      (readEnvConfig as any).mockReturnValue({});

      const ship = new Ship({});

      // No env, no constructor args → genuinely anonymous.
      expect((ship as any).credential).toBeNull();
    });
  });

  describe("a deploy's input", () => {
    /** The names the last deploy sent its files under. */
    const sent = () => {
      const body = mockApiClient.carriedFor('Deploy').at(-1)?.init.body as FormData;
      return (body.getAll('files[]') as File[]).map((file) => file.name);
    };

    it.each([
      ['a path', './dist', ['./dist']],
      ['a list of paths', ['./dist', './extra'], ['./dist', './extra']],
    ])('walks %s', async (_what, input, walked) => {
      await new Ship({ token: 'test-key' }).deploy(input);

      expect(findSources).toHaveBeenCalledWith(walked);
      expect(sent()).toEqual(['index.html']);
    });

    it('takes Files as every runtime does, and walks nothing', async () => {
      await new Ship({ token: 'test-key' }).deploy([new File(['<html></html>'], 'index.html')]);

      expect(findSources).not.toHaveBeenCalled();
      expect(sent()).toEqual(['index.html']);
    });

    it('publishes what a path holds under the names the pipeline gave it', async () => {
      // The folder every file shares is stripped, and nothing downstream may
      // put it back: that would show the deploying machine's layout in every
      // URL of the site.
      vi.mocked(findSources).mockResolvedValueOnce([
        { path: 'folder/index.html', size: 1, read: async () => new Blob(['a']) },
        { path: 'folder/nested/file2.txt', size: 1, read: async () => new Blob(['b']) },
      ]);

      await new Ship({ token: 'test-key' }).deploy(['/base/folder']);

      expect(sent()).toEqual(['index.html', 'nested/file2.txt']);
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
      const asked = mockApiClient.carriedFor('Get limits').length;

      await expect(new Ship({ token: 'test-key' }).deploy(input as any)).rejects.toThrow(
        'A deploy takes a list of File objects, a path, or a list of paths.',
      );
      expect(findSources).not.toHaveBeenCalled();
      expect(mockApiClient.carriedFor('Get limits')).toHaveLength(asked);
    });
  });
});
