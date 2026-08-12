import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Ship } from '../../src/node/index';
import { __setTestEnvironment } from '../../src/shared/lib/env';
import { fakeTransport } from '../mocks/transport';

// Mock the ApiHttp class to prevent real network calls. Keyed by OPERATION,
// because a transport has two methods since the endpoint tier folded down —
// see `tests/mocks/transport.ts`.
const mockApiClient = fakeTransport({
  Ping: { success: true, timestamp: 1_700_000_000 },
  Deploy: { deployment: 'dep_123', url: 'https://dep_123.shipstatic.com' },
  'Get account': { email: 'test@example.com' },
  'Get limits': { maxFileSize: 10485760 },
  'SPA check': { isSPA: false },
});

// `function`, not an arrow: vitest 4 invokes constructor mocks with `new`,
// and an arrow function cannot be constructed. Returning an object from a
// constructor overrides `this`, so `new ApiHttp(...)` yields the double.
vi.mock('../../src/shared/api/http', () => ({
  ApiHttp: vi.fn(function ApiHttp() {
    return mockApiClient;
  }),
}));

// Mock Node.js file processing
vi.mock('../../src/node/core/node-files', () => ({
  processFilesForNode: vi
    .fn()
    .mockResolvedValue([
      { path: 'index.html', content: Buffer.from('<html></html>'), size: 13, md5: 'abc123' },
    ]),
}));

// Mock env-var resolution. The Node Ship reads SHIP_* env vars synchronously
// in the constructor; this mock lets tests assert what was read without
// needing to mutate process.env.
vi.mock('../../src/node/core/config', () => ({
  readEnvConfig: vi.fn(() => ({})),
}));

describe('Ship - Node.js Implementation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setTestEnvironment('node'); // Ensure we're in Node.js environment for tests
  });

  describe('constructor', () => {
    it('should create Ship instance in Node.js environment', () => {
      const ship = new Ship({ token: 'test-key' });
      expect(ship).toBeInstanceOf(Ship);
    });

    it('should reject creation in non-Node.js environment', () => {
      __setTestEnvironment('browser');

      expect(() => {
        new Ship({ token: 'test-key' });
      }).toThrow('Node.js Ship class can only be used in Node.js environment.');
    });

    it('should reject creation in unknown environment', () => {
      __setTestEnvironment('unknown');

      expect(() => {
        new Ship({ token: 'test-key' });
      }).toThrow('Node.js Ship class can only be used in Node.js environment.');
    });
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

  describe('deploy functionality', () => {
    it('should process directory paths correctly', async () => {
      const ship = new Ship({ token: 'test-key' });

      // Mock the API client
      (ship as any).http = fakeTransport({
        Deploy: vi.fn().mockResolvedValue({
          id: 'dep_123',
          url: 'https://dep_123.shipstatic.com',
        }),
        'Get limits': vi.fn().mockResolvedValue({}),
        'SPA check': { isSPA: false },
      });

      const result = await ship.deploy('./dist');

      expect(result).toEqual({
        id: 'dep_123',
        url: 'https://dep_123.shipstatic.com',
      });
    });

    it('should handle file arrays', async () => {
      // Update the global mock to return the expected value for this test
      mockApiClient.answer('Deploy', {
        id: 'dep_456',
        url: 'https://dep_456.shipstatic.com',
      });

      const ship = new Ship({ token: 'test-key' });
      const result = await ship.deploy(['./index.html', './style.css']);

      expect(result).toEqual({
        id: 'dep_456',
        url: 'https://dep_456.shipstatic.com',
      });
    });
  });

  describe('exported utilities', () => {
    it('should export Node.js specific utilities', async () => {
      const nodeModule = await import('../../src/node/index');

      expect(nodeModule.processFilesForNode).toBeDefined();
      expect(nodeModule.getENV).toBeDefined();
      expect(nodeModule.__setTestEnvironment).toBeDefined();
    });
  });

  describe('resource functionality', () => {
    it('should provide access to all resources', () => {
      const ship = new Ship({ token: 'test-key' });

      expect(ship.deployments).toBeDefined();
      expect(ship.domains).toBeDefined();
      expect(ship.account).toBeDefined();
    });
  });

  describe('Node.js deployment edge cases (migrated from node-sdk.test.ts)', () => {
    it('should call processInput for string[] input (file paths)', async () => {
      const ship = new Ship({ token: 'test-key' });

      // Mock the processInput method
      const mockProcessInput = vi
        .fn()
        .mockResolvedValue([
          { path: 'file.txt', content: Buffer.from('content'), size: 7, md5: 'hash' },
        ]);

      (ship as any).processInput = mockProcessInput;
      (ship as any).http = fakeTransport({
        Deploy: vi.fn().mockResolvedValue({
          id: 'dep_paths_123',
          url: 'https://dep_paths_123.shipstatic.com',
        }),
        'Get limits': vi.fn().mockResolvedValue({}),
        'SPA check': { isSPA: false },
      });

      await ship.deploy(['./dist/index.html', './dist/style.css']);

      expect(mockProcessInput).toHaveBeenCalledWith(
        ['./dist/index.html', './dist/style.css'],
        expect.any(Object),
      );
    });

    it('should throw error for File[] input in Node.js (browser-only input)', async () => {
      const ship = new Ship({ token: 'test-key' });

      const mockFiles = [new File(['content'], 'test.txt')] as any;

      // This should fail because File[] is not supported in Node.js
      await expect(ship.deploy(mockFiles)).rejects.toThrow();
    });

    it('should throw error for FileList input in Node.js (browser-only input)', async () => {
      const ship = new Ship({ token: 'test-key' });

      const mockFileList = {
        0: new File(['content'], 'test.txt'),
        length: 1,
        item: () => null,
      } as any;

      // This should fail because FileList is not supported in Node.js
      await expect(ship.deploy(mockFileList)).rejects.toThrow();
    });

    it('should throw error for HTMLInputElement in Node.js (browser-only input)', async () => {
      const ship = new Ship({ token: 'test-key' });

      const mockInput = {
        tagName: 'INPUT',
        type: 'file',
        files: null,
      } as any;

      // This should fail because HTMLInputElement is not supported in Node.js
      await expect(ship.deploy(mockInput)).rejects.toThrow();
    });

    it('should prioritize constructor options over environment variables', async () => {
      // Set environment variables
      process.env.SHIP_API_URL = 'https://env.example.com';
      process.env.SHIP_TOKEN = 'env-token';

      const ship = new Ship({
        apiUrl: 'https://constructor.example.com',
        token: 'constructor-token',
      });

      // Constructor options should take precedence
      expect((ship as any).clientOptions.apiUrl).toBe('https://constructor.example.com');
      expect((ship as any).clientOptions.token).toBe('constructor-token');

      // Clean up
      delete process.env.SHIP_API_URL;
      delete process.env.SHIP_TOKEN;
    });

    it('should handle directory paths correctly', async () => {
      const ship = new Ship({ token: 'test-key' });

      const mockProcessInput = vi.fn().mockResolvedValue([
        { path: 'index.html', content: Buffer.from('<html></html>'), size: 13, md5: 'hash1' },
        { path: 'style.css', content: Buffer.from('body {}'), size: 7, md5: 'hash2' },
      ]);

      (ship as any).processInput = mockProcessInput;

      // Update the global mock for this test
      mockApiClient.answer('Deploy', {
        id: 'dep_dir_123',
        url: 'https://dep_dir_123.shipstatic.com',
      });

      const result = await ship.deploy('./dist');

      expect(mockProcessInput).toHaveBeenCalledWith('./dist', expect.any(Object));
      expect(result).toEqual({
        id: 'dep_dir_123',
        url: 'https://dep_dir_123.shipstatic.com',
      });
    });

    it('should pass deployment options correctly to processInput', async () => {
      const ship = new Ship({ token: 'test-key' });

      // One real file: the empty-deploy refusal lives in `upload` now, so an
      // empty processInput never reaches the transport at all.
      const mockProcessInput = vi.fn().mockResolvedValue([
        {
          path: 'index.html',
          content: Buffer.from('<html></html>'),
          size: 13,
          md5: 'a'.repeat(32),
        },
      ]);
      (ship as any).processInput = mockProcessInput;
      (ship as any).http = fakeTransport({
        Deploy: vi.fn().mockResolvedValue({
          id: 'dep_opt_123',
          url: 'https://dep_opt_123.shipstatic.com',
        }),
        'Get limits': vi.fn().mockResolvedValue({}),
        'SPA check': { isSPA: false },
      });

      const options = {
        pathDetect: false,
        spaDetect: false,
      };

      await ship.deploy(['./src/index.html'], options);

      expect(mockProcessInput).toHaveBeenCalledWith(
        ['./src/index.html'],
        expect.objectContaining(options),
      );
    });
  });

  describe('deploy option passthrough (migrated from node-sdk.test.ts)', () => {
    it('passes labels through to the wire', async () => {
      const ship = new Ship({ token: 'test-key' });

      await ship.deploy(['./dist/app.js'], { labels: ['production', 'v2.1.0'] });

      const body = mockApiClient.carriedFor('Deploy').at(-1)?.init.body as FormData;
      expect(JSON.parse(body.get('labels') as string)).toEqual(['production', 'v2.1.0']);
    });

    it('passes password through to the wire', async () => {
      const ship = new Ship({ token: 'test-key' });

      await ship.deploy(['./dist/app.js'], { password: 'secret123' });

      const body = mockApiClient.carriedFor('Deploy').at(-1)?.init.body as FormData;
      expect(body.get('password')).toBe('secret123');
    });

    it('uploads the paths the processor returned, never a host-absolute prefix', async () => {
      // The common parent is stripped during processing; nothing downstream may
      // re-prefix it back on. A regression here would leak the deploying
      // machine's directory layout into every deployed URL.
      const ship = new Ship({ token: 'test-key' });
      (ship as any).processInput = vi.fn().mockResolvedValue([
        { path: 'file1.txt', content: Buffer.from('a'), md5: 'm1', size: 1 },
        { path: 'nested/file2.txt', content: Buffer.from('b'), md5: 'm2', size: 1 },
      ]);

      await ship.deploy(['/base/folder/file1.txt', '/base/folder/nested/file2.txt'], {
        pathDetect: true,
      });

      const body = mockApiClient.carriedFor('Deploy').at(-1)?.init.body as FormData;
      const names = (body.getAll('files[]') as File[]).map((f) => f.name);
      expect(names).toEqual(['file1.txt', 'nested/file2.txt']);
    });
  });

  describe('standardized error handling', () => {
    it('should reject File[] input with consistent error message', async () => {
      const ship = new Ship({ token: 'test-key' });

      const mockFiles = [new File(['content'], 'test.txt')] as any;

      await expect(ship.deploy(mockFiles)).rejects.toThrow(
        'Invalid input type for Node.js environment. Expected string or string[].',
      );
    });

    it('should reject FileList input with consistent error message', async () => {
      const ship = new Ship({ token: 'test-key' });

      const mockFileList = {
        0: new File(['content'], 'test.txt'),
        length: 1,
        item: () => null,
      } as any;

      await expect(ship.deploy(mockFileList)).rejects.toThrow(
        'Invalid input type for Node.js environment. Expected string or string[].',
      );
    });

    it('should reject HTMLInputElement input with consistent error message', async () => {
      const ship = new Ship({ token: 'test-key' });

      const mockInput = {
        tagName: 'INPUT',
        type: 'file',
        files: null,
      } as any;

      await expect(ship.deploy(mockInput)).rejects.toThrow(
        'Invalid input type for Node.js environment. Expected string or string[].',
      );
    });

    it('should reject invalid object types with consistent error message', async () => {
      const ship = new Ship({ token: 'test-key' });

      await expect(ship.deploy({ invalid: 'object' } as any)).rejects.toThrow(
        'Invalid input type for Node.js environment. Expected string or string[].',
      );
    });

    it('should handle empty path arrays with consistent error message', async () => {
      const ship = new Ship({ token: 'test-key' });

      await expect(ship.deploy([])).rejects.toThrow('No files to deploy.');
    });

    it('should handle network errors consistently', async () => {
      // Set up the global mock to reject with network error
      mockApiClient.answer('Deploy', () => {
        throw new Error('Request timeout after 30000ms');
      });

      const ship = new Ship({ token: 'test-key' });

      await expect(ship.deploy(['./test.html'])).rejects.toThrow('Request timeout after 30000ms');
    });

    it('should handle API errors consistently', async () => {
      // Set up the global mock to reject with API error
      mockApiClient.answer('Deploy', () => {
        throw new Error('API key is invalid');
      });

      const ship = new Ship({ token: 'invalid-key' });

      await expect(ship.deploy(['./test.html'])).rejects.toThrow('API key is invalid');
    });

    it('should handle configuration errors consistently', async () => {
      // Test with missing API key - constructor should succeed
      const ship = new Ship({} as any);
      expect(ship).toBeDefined(); // Constructor allows empty config, API calls will validate
    });
  });
});
