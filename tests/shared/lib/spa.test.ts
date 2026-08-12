/**
 * @file Subject: `src/shared/lib/spa.ts` — the whole SPA concern, including
 * the one request it makes.
 *
 * `checkSPA` was a method on `ApiHttp` until 2026-08-12 and its rows lived in
 * `http.test.ts`, one file away from the only function that ever called it.
 * They moved here with it. The seam they observe moved too: a fake
 * `Transport`, which is what `checkSPA` now takes — so a row can say "it made
 * no request at all" without stubbing a global.
 */

import { API_PATHS, DEPLOYMENT_CONFIG_FILENAME } from '@shipstatic/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transport } from '../../../src/shared/api/http';
import { checkSPA, createSPAConfig, detectAndConfigureSPA } from '../../../src/shared/lib/spa';
import type { DeploymentOptions, StaticFile } from '../../../src/shared/types';

// Mock the MD5 calculation
vi.mock('../../../src/shared/lib/md5', () => ({
  calculateMD5: vi.fn().mockResolvedValue({ md5: 'mock-md5-hash' }),
}));

type FakeTransport = Transport & { request: ReturnType<typeof vi.fn> };

/**
 * A transport that carries nothing.
 *
 * `request` is the only member these rows reach, and giving it a `vi.fn` is
 * what lets them assert the shape of the one request `checkSPA` makes — and,
 * more often, that it made none.
 */
function fakeTransport(request: ReturnType<typeof vi.fn> = vi.fn()): FakeTransport {
  return {
    request,
    requestWithStatus: vi.fn(),
    deploy: { endpoint: '/deployments', timeout: 1000, buildTimeout: 2000 },
  } as unknown as FakeTransport;
}

const file = (path: string, content: StaticFile['content'], size: number): StaticFile => ({
  path,
  content,
  size,
  md5: 'abc123',
});

describe('SPA Detection (spa.ts)', () => {
  describe('createSPAConfig', () => {
    it('should create a valid SPA configuration file', async () => {
      const spaConfig = await createSPAConfig();

      expect(spaConfig.path).toBe(DEPLOYMENT_CONFIG_FILENAME);
      expect(spaConfig.md5).toBe('mock-md5-hash');
      expect(spaConfig.size).toBeGreaterThan(0);

      // Parse the content to verify it's valid JSON with the right structure
      const content = JSON.parse(spaConfig.content.toString());
      expect(content).toEqual({
        rewrites: [
          {
            source: '/(.*)',
            destination: '/index.html',
          },
        ],
      });
    });
  });

  describe('checkSPA', () => {
    describe('answers false without asking', () => {
      // Each of these is a state where the platform could not give a useful
      // answer, so spending a round trip on it would be waste — and the row
      // proves the saving, not just the verdict.
      it('when there is no index.html', async () => {
        const transport = fakeTransport();

        const result = await checkSPA(
          [
            file('main.js', Buffer.from('console.log(1)'), 14),
            file('style.css', Buffer.from('a'), 1),
          ],
          transport,
        );

        expect(result).toBe(false);
        expect(transport.request).not.toHaveBeenCalled();
      });

      it('when index.html exceeds the published bound', async () => {
        const large = Buffer.alloc(150 * 1024, 'x');
        const transport = fakeTransport();

        const result = await checkSPA([file('index.html', large, large.length)], transport);

        expect(result).toBe(false);
        expect(transport.request).not.toHaveBeenCalled();
      });

      it.each([
        ['a number', 123],
        ['a plain object', { someObject: true }],
      ])('when the index content is %s — a shape no pipeline produces', async (_label, content) => {
        const transport = fakeTransport();

        const result = await checkSPA([file('index.html', content as never, 50)], transport);

        expect(result).toBe(false);
        expect(transport.request).not.toHaveBeenCalled();
      });
    });

    describe('asks, and sends only the paths and the index', () => {
      it('posts the file list and the index TEXT, never the deploy', async () => {
        const index = '<html><head><script src="app.js"></script></head></html>';
        const request = vi.fn().mockResolvedValue({ isSPA: true });

        const result = await checkSPA(
          [
            file('index.html', Buffer.from(index), index.length),
            file('app.js', Buffer.from('app code'), 8),
          ],
          fakeTransport(request),
        );

        expect(request).toHaveBeenCalledWith(
          API_PATHS.SPA_CHECK,
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: ['index.html', 'app.js'], index }),
          }),
          'SPA check',
        );
        expect(result).toBe(true);
      });

      it('accepts a leading slash on the index path', async () => {
        const index = '<html></html>';
        const request = vi.fn().mockResolvedValue({ isSPA: true });

        const result = await checkSPA(
          [file('/index.html', Buffer.from(index), index.length)],
          fakeTransport(request),
        );

        expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
          files: ['/index.html'],
          index,
        });
        expect(result).toBe(true);
      });

      it('preserves the deploy’s own file order', async () => {
        const index = '<html></html>';
        const request = vi.fn().mockResolvedValue({ isSPA: true });

        await checkSPA(
          [
            file('components/App.js', Buffer.from('app'), 3),
            file('index.html', Buffer.from(index), index.length),
            file('assets/style.css', Buffer.from('css'), 3),
          ],
          fakeTransport(request),
        );

        expect(JSON.parse(request.mock.calls[0][1].body).files).toEqual([
          'components/App.js',
          'index.html',
          'assets/style.css',
        ]);
      });

      it('reads a Blob index as text', async () => {
        // The browser pipeline's content shape; Node's is a Buffer. Both must
        // reach the same request, which is what makes one `checkSPA` correct
        // for both platforms.
        const index = '<html></html>';
        const request = vi.fn().mockResolvedValue({ isSPA: true });

        await checkSPA(
          [file('index.html', new Blob([index]), index.length)],
          fakeTransport(request),
        );

        expect(JSON.parse(request.mock.calls[0][1].body).index).toBe(index);
      });

      it('lets a transport failure through — the caller decides', async () => {
        const request = vi.fn().mockRejectedValue(new Error('Service unavailable'));

        await expect(
          checkSPA([file('index.html', Buffer.from('<html></html>'), 13)], fakeTransport(request)),
        ).rejects.toThrow('Service unavailable');
      });
    });
  });

  describe('detectAndConfigureSPA', () => {
    let transport: FakeTransport;
    let mockFiles: StaticFile[];
    let options: DeploymentOptions;

    beforeEach(() => {
      transport = fakeTransport();
      mockFiles = [file('index.html', Buffer.from('<html><body>Test</body></html>'), 100)];
      options = { spaDetect: true };
      vi.clearAllMocks();
    });

    it('should skip SPA detection when disabled', async () => {
      options.spaDetect = false;

      const result = await detectAndConfigureSPA(mockFiles, transport, options);

      expect(transport.request).not.toHaveBeenCalled();
      expect(result).toEqual(mockFiles);
    });

    it('should skip SPA detection when ship.json already exists', async () => {
      const filesWithConfig = [
        ...mockFiles,
        file(DEPLOYMENT_CONFIG_FILENAME, Buffer.from('{}'), 2),
      ];

      const result = await detectAndConfigureSPA(filesWithConfig, transport, options);

      expect(transport.request).not.toHaveBeenCalled();
      expect(result).toEqual(filesWithConfig);
    });

    it('should add SPA config when SPA is detected', async () => {
      transport.request.mockResolvedValue({ isSPA: true });

      const result = await detectAndConfigureSPA(mockFiles, transport, options);

      expect(transport.request).toHaveBeenCalledWith(
        API_PATHS.SPA_CHECK,
        expect.anything(),
        'SPA check',
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(mockFiles[0]);
      expect(result[1].path).toBe(DEPLOYMENT_CONFIG_FILENAME);
    });

    it('should not add SPA config when SPA is not detected', async () => {
      transport.request.mockResolvedValue({ isSPA: false });

      const result = await detectAndConfigureSPA(mockFiles, transport, options);

      expect(transport.request).toHaveBeenCalled();
      expect(result).toEqual(mockFiles);
    });

    it('should handle SPA detection API errors gracefully', async () => {
      transport.request.mockRejectedValue(new Error('API Error'));

      const result = await detectAndConfigureSPA(mockFiles, transport, options);

      expect(result).toEqual(mockFiles);
    });

    it.each([
      ['build=true (server builds the output)', { build: true }],
      ['prerender=true (flat HTML output)', { prerender: true }],
      ['both build and prerender', { build: true, prerender: true }],
    ])('should skip SPA detection when %s', async (_label, flags) => {
      const result = await detectAndConfigureSPA(mockFiles, transport, flags);

      expect(transport.request).not.toHaveBeenCalled();
      expect(result).toEqual(mockFiles);
    });
  });
});
