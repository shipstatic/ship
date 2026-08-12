/**
 * @file Subject: `src/shared/resources.ts` — the deployment resource.
 *
 * `upload` is the SDK's longest path: collect the files, ask the platform
 * whether they are a SPA, validate the request boundary, build the multipart
 * body, send it. It read across two files until 2026-08-12, when the endpoint
 * tier folded down out of `ApiHttp` — and these rows read across two seams to
 * match, asserting on `mockApiHttp.deploy` having *been called*.
 *
 * The seam is one now, and it is the wire: a fake `Transport` captures the
 * request the resource composed, so every row below reads the artifact the API
 * would receive — the FormData's own fields, the header, the ceiling — rather
 * than the arguments a collaborator was handed. A body that was assembled
 * correctly and one that was merely appended to correctly are different
 * things, and only the first of these can tell them apart.
 *
 * No `vi.mock` of `../../src/shared/lib/spa`, deliberately. An earlier revision
 * mocked `detectAndConfigureSPA` with a hand-written reimplementation of its
 * branching, so the "SPA detection is applied" rows asserted the fake's
 * behaviour and would have kept passing had the real function stopped
 * injecting anything. The real module runs; the transport is the only seam.
 */

import { DEPLOYMENT_CONFIG_FILENAME, IDEMPOTENCY_KEY_CONSTRAINTS } from '@shipstatic/types';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transport } from '../../src/shared/api/http';
import { createDeploymentResource, type DeploymentResource } from '../../src/shared/resources';
import type { DeployInput, DeploymentOptions } from '../../src/shared/types';
import { makeDeployment } from '../fixtures/builders';

/** What the resource asked the transport to carry. */
interface Carried {
  path: string;
  init: { method?: string; body?: FormData; headers?: Record<string, string> };
  operation: string;
  timeoutMs?: number;
}

describe('Deployment Resource', () => {
  let carried: Carried[];
  let transport: Transport;
  let answer: unknown;
  let spaVerdict: unknown;
  let mockProcessInput: Mock;
  // Parameterized exactly as `base-ship` declares it — since types
  // 2.5.0-beta.0 the interface admits the SDK's extended options directly.
  let deploymentResource: DeploymentResource<DeploymentOptions>;

  /** The multipart body of the deploy, as the API would parse it. */
  const body = () => carried.find((c) => c.operation === 'Deploy')?.init.body as FormData;
  const deployCall = () => carried.find((c) => c.operation === 'Deploy') as Carried;

  beforeEach(() => {
    vi.clearAllMocks();
    carried = [];
    answer = makeDeployment();
    spaVerdict = { isSPA: false };

    const request = vi.fn(
      async (path: string, init: any, operation: string, timeoutMs?: number) => {
        carried.push({ path, init, operation, timeoutMs });
        return operation === 'SPA check' ? spaVerdict : answer;
      },
    );
    transport = {
      request,
      requestWithStatus: vi.fn(),
      deploy: { endpoint: '/deployments', timeout: 300_000, buildTimeout: 600_000 },
    } as unknown as Transport;

    // Resolved values come from the canonical builder, so this file cannot
    // drift into fictional wire shapes (the audit found an `{id, url}`
    // deployment here; the real field is `deployment`).
    mockProcessInput = vi.fn().mockResolvedValue([
      { path: 'index.html', content: Buffer.from('<html></html>'), size: 13, md5: 'a'.repeat(32) },
      { path: 'style.css', content: Buffer.from('body {}'), size: 7, md5: 'b'.repeat(32) },
    ]);

    deploymentResource = createDeploymentResource({
      getApi: () => transport,
      processInput: mockProcessInput,
    });
  });

  const upload = (options: DeploymentOptions = {}) =>
    deploymentResource.upload(['./dist'] as unknown as DeployInput, options);

  describe('upload — the pipeline', () => {
    it('collects, then sends, and resolves the wire’s own answer', async () => {
      const result = await upload();

      expect(mockProcessInput).toHaveBeenCalledWith(['./dist'], {});
      expect(deployCall().path).toBe('/deployments');
      expect(deployCall().init.method).toBe('POST');
      expect(result).toEqual(makeDeployment());
    });

    it('passes per-call options to processInput unmodified', async () => {
      const options: DeploymentOptions = { pathDetect: false, labels: ['audit'] };
      await upload(options);

      expect(mockProcessInput.mock.calls[0][1]).toEqual(options);
    });

    it('refuses without a processInput — there is nothing to collect with', async () => {
      const broken = createDeploymentResource({
        getApi: () => transport,
        processInput: undefined as never,
      });

      await expect(broken.upload(['./dist'] as unknown as DeployInput, {})).rejects.toThrow(
        'processInput function is not provided.',
      );
    });

    it('refuses an empty deploy before building a body', async () => {
      mockProcessInput.mockResolvedValue([]);

      await expect(upload()).rejects.toThrow('No files to deploy');
      expect(carried.filter((c) => c.operation === 'Deploy')).toHaveLength(0);
    });

    it('refuses a file with no checksum, naming it', async () => {
      // Built inline rather than through a defaulted helper: a `md5 = 'md5'`
      // default swallows `undefined` and makes this row assert nothing.
      mockProcessInput.mockResolvedValue([
        { path: 'index.html', content: Buffer.from('<html></html>'), size: 13 },
      ]);

      await expect(upload()).rejects.toThrow('MD5 checksum missing for file: index.html');
      expect(carried.filter((c) => c.operation === 'Deploy')).toHaveLength(0);
    });
  });

  describe('upload — SPA detection runs before the body is built', () => {
    it('injects the real ship.json when the platform says it is a SPA', async () => {
      spaVerdict = { isSPA: true };

      await upload({ spaDetect: true });

      const files = body().getAll('files[]') as File[];
      expect(files.map((f) => f.name)).toContain(DEPLOYMENT_CONFIG_FILENAME);
      const config = files.find((f) => f.name === DEPLOYMENT_CONFIG_FILENAME) as File;
      expect(JSON.parse(await config.text())).toEqual({
        rewrites: [{ source: '/(.*)', destination: '/index.html' }],
      });
    });

    it('leaves the deploy alone when it is not', async () => {
      spaVerdict = { isSPA: false };

      await upload({ spaDetect: true });

      expect((body().getAll('files[]') as File[]).map((f) => f.name)).toEqual([
        'index.html',
        'style.css',
      ]);
    });

    it('deploys anyway when the pre-flight fails', async () => {
      // A flaky pre-flight must never fail a deploy — and must not silently
      // drop files either. `spa.test.ts` proves the untouched list is
      // RETURNED; this proves the deploy still happens with it.
      (transport.request as Mock).mockImplementation(
        async (path: string, init: any, operation: string, timeoutMs?: number) => {
          if (operation === 'SPA check') throw new Error('SPA check unavailable');
          carried.push({ path, init, operation, timeoutMs });
          return answer;
        },
      );

      await upload({ spaDetect: true });

      expect((body().getAll('files[]') as File[]).map((f) => f.name)).toEqual([
        'index.html',
        'style.css',
      ]);
    });
  });

  describe('upload — what reaches the body', () => {
    it('names itself sdk when no via is given', async () => {
      await upload();
      expect(body().get('via')).toBe('sdk');
    });

    it('lets an explicit via win over the default', async () => {
      await upload({ via: 'web' });
      expect(body().get('via')).toBe('web');
    });

    it.each([
      ['one label', ['production']],
      ['several', ['production', 'v2.0.0', 'stable', 'release-2024']],
    ])('carries %s', async (_label, labels) => {
      await upload({ labels });
      expect(JSON.parse(body().get('labels') as string)).toEqual(labels);
    });

    it.each([
      ['no labels option', {}],
      ['an empty array — nothing to state', { labels: [] }],
    ])('omits the labels field for %s', async (_label, options) => {
      await upload(options);
      expect(body().get('labels')).toBeNull();
    });

    it('carries the password verbatim, whitespace included', async () => {
      await upload({ password: '  secret-123  ' });
      expect(body().get('password')).toBe('  secret-123  ');
    });

    it('carries the captcha proof for the anonymous human channel', async () => {
      await upload({ captcha: 'captcha-proof', via: 'web' });
      expect(body().get('captcha')).toBe('captcha-proof');
    });

    it('carries a ttl as SECONDS — a duration, never an instant', async () => {
      await upload({ ttl: 3600 });
      expect(body().get('ttl')).toBe('3600');
    });

    it.each([
      ['build', 'build'],
      ['prerender', 'prerender'],
      ['spa', 'spa'],
    ])('carries the @internal %s flag', async (_label, flag) => {
      await upload({ [flag]: true } as DeploymentOptions);
      expect(body().get(flag)).toBe('true');
    });
  });

  describe('upload — the request boundary refuses before the wire', () => {
    it.each([
      ['a ttl outside the shared range', { ttl: 0 }, /between/i],
      ['an over-long idempotency key', { idempotencyKey: 'x'.repeat(500) }, /idempotency/i],
      ['a password below the minimum', { password: 'a' }, /password/i],
    ])('refuses %s', async (_label, options, pattern) => {
      await expect(upload(options as DeploymentOptions)).rejects.toThrow(pattern);
      expect(carried.filter((c) => c.operation === 'Deploy')).toHaveLength(0);
    });
  });

  describe('upload — the header and the ceiling', () => {
    it('sends Idempotency-Key when given one', async () => {
      await upload({ idempotencyKey: 'run-42' });

      expect(deployCall().init.headers).toEqual({
        [IDEMPOTENCY_KEY_CONSTRAINTS.HEADER]: 'run-42',
      });
    });

    it('sends no such header when not', async () => {
      await upload();
      expect(deployCall().init.headers).toBeUndefined();
    });

    it('takes the ordinary deploy ceiling by default', async () => {
      await upload();
      expect(deployCall().timeoutMs).toBe(300_000);
    });

    it.each([['build'], ['prerender']])(
      'takes the longer ceiling for a %s deploy, which waits on the server',
      async (flag) => {
        await upload({ [flag]: true } as DeploymentOptions);
        expect(deployCall().timeoutMs).toBe(600_000);
      },
    );

    it('does NOT extend the ceiling for spa, which never reaches the build service', async () => {
      // Local detection bounded by the AI tier's own 10s. The distinction is
      // the reason the choice lives here rather than in the transport: only
      // this file knows which flags mean server-side work.
      await upload({ spa: true });
      expect(deployCall().timeoutMs).toBe(300_000);
    });
  });

  describe('the rest of the resource', () => {
    it('lists, with and without pagination', async () => {
      await deploymentResource.list();
      expect(carried.at(-1)).toMatchObject({ path: '/deployments', operation: 'List deployments' });

      await deploymentResource.list({ limit: 2, cursor: 'abc' });
      expect(carried.at(-1)?.path).toBe('/deployments?limit=2&cursor=abc');
    });

    it('gets one', async () => {
      await deploymentResource.get('dep-123');
      expect(carried.at(-1)).toMatchObject({
        path: '/deployments/dep-123',
        operation: 'Get deployment',
      });
      expect(carried.at(-1)?.init.method).toBe('GET');
    });

    it('sets labels, and validates them on the way', async () => {
      await deploymentResource.set('dep-123', { labels: ['Production'] });

      const call = carried.at(-1) as Carried;
      expect(call.init.method).toBe('PATCH');
      // Normalized by the shared rule, not by this resource — lowercased.
      expect(JSON.parse(call.init.body as unknown as string)).toEqual({ labels: ['production'] });
    });

    it('deletes one', async () => {
      await deploymentResource.delete('dep-123');
      expect(carried.at(-1)).toMatchObject({
        path: '/deployments/dep-123',
        operation: 'Delete deployment',
      });
      expect(carried.at(-1)?.init.method).toBe('DELETE');
    });
  });
});
