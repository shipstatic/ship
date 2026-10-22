/**
 * @file Subject: `src/shared/resources.ts` — the deployment resource.
 *
 * `upload` is the SDK's longest path: collect the files, validate the request
 * boundary, plan the requests, send them: one declaration, then a fill per
 * batch when the deploy does not fit one request. The single-page question
 * rides the declaration as a field; the platform answers it. It read across two files until 2026-08-12, when the endpoint
 * tier folded down out of `ApiHttp` — and these rows read across two seams to
 * match, asserting on `mockApiHttp.deploy` having *been called*.
 *
 * The seam is one now, and it is the wire: a fake `Transport` captures the
 * request the resource composed, so every row below reads the artifact the API
 * would receive — the FormData's own fields, the header, the ceiling — rather
 * than the arguments a collaborator was handed. A body that was assembled
 * correctly and one that was merely appended to correctly are different
 * things, and only the first of these can tell them apart.
 */

import { IDEMPOTENCY_KEY_CONSTRAINTS } from '@shipstatic/types';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transport } from '../../src/shared/api/http';
import { createDeploymentResource, type DeploymentResource } from '../../src/shared/resources';
import type { DeployInput, DeploymentOptions } from '../../src/shared/types';
import { makeDeployment } from '../fixtures/builders';

/** What the resource asked the transport to carry. */
interface Carried {
  path: string;
  init: {
    method?: string;
    body?: FormData;
    headers?: Record<string, string>;
    idempotent?: boolean;
  };
  operation: string;
  timeoutMs?: number;
}

const MiB = 1024 * 1024;

describe('Deployment Resource', () => {
  let carried: Carried[];
  let transport: Transport;
  let answer: unknown;
  /** The status each deploy request answers, in order; 201 once the list runs out. */
  let statuses: number[];
  let mockProcessInput: Mock;
  // Parameterized exactly as `base-ship` declares it — since types
  // 2.5.0-beta.0 the interface admits the SDK's extended options directly.
  let deploymentResource: DeploymentResource<DeploymentOptions>;

  /** The multipart body of the declaration, as the API would parse it. */
  const body = () => carried.find((c) => c.operation === 'Deploy')?.init.body as FormData;
  const deployCall = () => carried.find((c) => c.operation === 'Deploy') as Carried;
  const deployCalls = () => carried.filter((c) => c.operation === 'Deploy');

  beforeEach(() => {
    vi.clearAllMocks();
    carried = [];
    answer = makeDeployment();
    statuses = [];

    const request = vi.fn(
      async (path: string, init: any, operation: string, timeoutMs?: number) => {
        carried.push({ path, init, operation, timeoutMs });
        return answer;
      },
    );
    const requestWithStatus = vi.fn(
      async (path: string, init: any, operation: string, timeoutMs?: number) => {
        carried.push({ path, init, operation, timeoutMs });
        return { data: answer, status: statuses.shift() ?? 201 };
      },
    );
    transport = {
      request,
      requestWithStatus,
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

    it('refuses a file with no MD5, naming it', async () => {
      // Built inline rather than through a defaulted helper: a `md5 = 'md5'`
      // default swallows `undefined` and makes this row assert nothing.
      mockProcessInput.mockResolvedValue([
        { path: 'index.html', content: Buffer.from('<html></html>'), size: 13 },
      ]);

      await expect(upload()).rejects.toThrow('MD5 missing for file: index.html');
      expect(carried.filter((c) => c.operation === 'Deploy')).toHaveLength(0);
    });
  });

  describe('upload — the single-page question is the platform’s', () => {
    it('leaves it to the platform by default: no field, and no other request', async () => {
      await upload();

      expect(body().has('spa')).toBe(false);
      expect((body().getAll('files[]') as File[]).map((f) => f.name)).toEqual([
        'index.html',
        'style.css',
      ]);
      expect(carried.map((c) => c.operation)).toEqual(['Deploy']);
    });

    it('sends the opt-out when spaDetect is false', async () => {
      await upload({ spaDetect: false });

      expect(body().get('spa')).toBe('false');
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

    it('carries the build settings trimmed, beside the build flag they qualify', async () => {
      await upload({ build: true, buildCommand: ' npm run build:site ', outputDir: 'dist/site/' });
      expect(body().get('build')).toBe('true');
      expect(body().get('buildCommand')).toBe('npm run build:site');
      expect(body().get('outputDir')).toBe('dist/site');
    });

    it('carries the password the rule judged: trimmed, as the API trims it', async () => {
      await upload({ password: '  secret-123  ' });
      expect(body().get('password')).toBe('secret-123');
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
      [
        'an output folder outside the project',
        { build: true, outputDir: '../etc' },
        /inside the project/,
      ],
      ['a two-line build command', { build: true, buildCommand: 'a\nb' }, /single line/],
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

    it('does NOT extend the ceiling for the single-page question, which never reaches the build service', async () => {
      // A pure function of one page on the server. The distinction is the
      // reason the choice lives here rather than in the transport: only this
      // file knows which flags mean server-side work.
      await upload({ spaDetect: true });
      expect(body().has('spa')).toBe(false);
      expect(deployCall().timeoutMs).toBe(300_000);
    });
  });

  describe('upload: a deploy larger than one request', () => {
    /** A deploy over the request ceiling: two 40 MiB images, a page and a config. */
    const large = () => [
      { path: 'index.html', content: Buffer.from('<p>'), size: 3, md5: 'a'.repeat(32) },
      { path: 'a.png', content: Buffer.from('a'), size: 40 * MiB, md5: 'b'.repeat(32) },
      { path: 'ship.json', content: Buffer.from('{}'), size: 2, md5: 'c'.repeat(32) },
      { path: 'b.png', content: Buffer.from('b'), size: 40 * MiB, md5: 'd'.repeat(32) },
    ];
    const fills = () => deployCalls().slice(1);
    const names = (call: Carried) =>
      ((call.init.body as FormData).getAll('files[]') as File[]).map((f) => f.name);

    beforeEach(() => mockProcessInput.mockResolvedValue(large()));

    it('declares bare, then sends each batch to the files route, and answers the 201', async () => {
      statuses = [202, 202, 201];

      const result = await upload();

      expect(deployCalls().map((c) => c.path)).toEqual([
        '/deployments',
        `/deployments/${encodeURIComponent(makeDeployment().deployment)}/files`,
        `/deployments/${encodeURIComponent(makeDeployment().deployment)}/files`,
      ]);
      // The declaration: the manifest, every file declared, and only the root
      // page and config carried: the files that configure the deployment.
      expect(names(deployCall())).toEqual(['index.html', 'ship.json']);
      expect(
        JSON.parse(body().get('manifest') as string).map((e: { path: string }) => e.path),
      ).toEqual(['index.html', 'a.png', 'ship.json', 'b.png']);
      expect(fills().map(names)).toEqual([['a.png'], ['b.png']]);
      // A fill carries files and nothing else.
      expect(fills().every((c) => !c.init.body?.has('manifest'))).toBe(true);
      expect(result).toEqual(makeDeployment());
    });

    it('stops at the first fill that answers the deployment, a 200 included', async () => {
      statuses = [202, 200];

      await upload();

      expect(deployCalls()).toHaveLength(2);
    });

    it('marks every fill safe to repeat, and the declaration only when it carries a key', async () => {
      statuses = [202, 202, 201];
      await upload();
      expect(deployCalls().map((c) => c.init.idempotent)).toEqual([false, true, true]);

      carried = [];
      statuses = [202, 202, 201];
      await upload({ idempotencyKey: 'run-42' });
      expect(deployCalls().map((c) => c.init.idempotent)).toEqual([true, true, true]);
      expect(fills().every((c) => c.init.headers === undefined)).toBe(true);
    });

    it('refuses a deployment still pending after its last batch, rather than report a success', async () => {
      statuses = [202, 202, 202];

      await expect(upload()).rejects.toThrow(
        'Every file was sent, but the deployment did not go live. Deploy again.',
      );
    });

    it('carries the page in the declaration whether or not the question is asked', async () => {
      statuses = [202, 202, 201];

      await upload({ spaDetect: false });

      expect(body().get('spa')).toBe('false');
      expect(names(deployCall())).toEqual(['index.html', 'ship.json']);
      expect(fills().map(names)).toEqual([['a.png'], ['b.png']]);
    });

    it('refuses a build that does not fit one request, sending nothing', async () => {
      await expect(upload({ build: true })).rejects.toThrow(
        'We can build projects up to 64 MB. Build this one on your computer and upload the built folder instead.',
      );
      expect(deployCalls()).toHaveLength(0);
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
