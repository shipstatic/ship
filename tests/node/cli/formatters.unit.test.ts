/**
 * @file Subject: `src/node/cli/formatters.ts` — every resource formatter and
 * the `formatOutput` router that dispatches to them.
 *
 * The router's branch ORDER is load-bearing and documented in
 * `npm/ship/CLAUDE.md`: `records`/`hash`/`dns` must be tested before
 * `domain`, because those payloads carry a `domain` field too and would
 * otherwise be formatted as a plain domain. Until 2026-07-27 nothing tested
 * the router at all — the module sat at 13.6% — so that documented ordering
 * was prose with no enforcement.
 */

import type {
  DeploymentCreateResponse,
  DeploymentDeleteResponse,
  DeploymentListResponse,
  DomainListResponse,
  DomainValidateResponse,
  DomainVerifyResponse,
  PingResponse,
  TokenListResponse,
} from '@shipstatic/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDeployment, formatOutput } from '../../../src/node/cli/formatters';
import { makeDeployment, makeDomain, makeToken } from '../../fixtures/builders';

const NOW = 1_700_000_000;
const CLAIM_URL = `https://my.shipstatic.com/claim/${'a'.repeat(64)}`;

const anonymousDeployment = {
  deployment: 'proud-falcon-a1b2c3',
  url: 'https://proud-falcon-a1b2c3.shipstatic.com',
  files: 1,
  size: 1024,
  status: 'success',
  created: NOW,
  expires: NOW + 3 * 24 * 60 * 60,
  claim: CLAIM_URL,
} as unknown as DeploymentCreateResponse;

describe('claim CTA', () => {
  let logs: string[];

  beforeEach(() => {
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the claim URL with the expiry window in text output', () => {
    formatDeployment(anonymousDeployment, { operation: 'upload' }, { noColor: true });

    const output = logs.join('\n');
    expect(output).toContain('expires in 3 days');
    expect(output).toContain(CLAIM_URL);
    // The details block never lists `claim` as a field — the CTA is its
    // one text rendering.
    expect(output).not.toMatch(/^claim:/m);
  });

  it('omits the CTA entirely for credentialed deploys', () => {
    const { claim: _claim, expires: _expires, ...kept } = anonymousDeployment;
    formatDeployment(kept as DeploymentCreateResponse, { operation: 'upload' }, { noColor: true });

    const output = logs.join('\n');
    expect(output).not.toContain('claim');
    expect(output).not.toContain('expire');
  });

  it('keeps `claim` in --json output for scripts, while `isCreate` stays internal', () => {
    formatOutput(
      { ...anonymousDeployment, isCreate: true } as unknown as DeploymentCreateResponse,
      {},
      { json: true },
    );

    const parsed = JSON.parse(logs[0]);
    expect(parsed.claim).toBe(CLAIM_URL);
    expect(parsed.isCreate).toBeUndefined();
  });
});

describe('formatOutput router', () => {
  let logs: string[];
  let errs: string[];

  beforeEach(() => {
    logs = [];
    errs = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => logs.push(a.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => errs.push(a.join(' ')));
  });

  afterEach(() => vi.restoreAllMocks());

  const out = () => logs.join('\n');
  const text = { noColor: true };

  describe('order-critical dispatch (payloads that also carry `domain`)', () => {
    // Each of these has a `domain` field. If the router checked `domain`
    // first, all three would render as a plain domain — which is exactly the
    // regression the documented ordering exists to prevent.
    it('routes `records` to the DNS-records table, not to formatDomain', () => {
      formatOutput(
        {
          domain: 'www.example.com',
          apex: 'example.com',
          records: [{ type: 'CNAME', name: 'www', value: 'cname.shipstatic.com' }],
        } as never,
        {},
        text,
      );

      expect(out()).toContain('type');
      expect(out()).toContain('CNAME');
      expect(out()).toContain('cname.shipstatic.com');
    });

    it('routes `hash` to the setup URL, not to formatDomain', () => {
      formatOutput({ domain: 'www.example.com', hash: 'abc123' } as never, {}, text);

      expect(out()).toContain('https://setup.shipstatic.com/abc123/www.example.com');
    });

    it('routes `dns` to the provider view, not to formatDomain', () => {
      formatOutput(
        { domain: 'www.example.com', dns: { provider: { name: 'Cloudflare' } } } as never,
        {},
        text,
      );

      expect(out()).toContain('provider');
      expect(out()).toContain('Cloudflare');
    });

    it('routes a plain domain to formatDomain once the three above are ruled out', () => {
      formatOutput(
        { domain: 'www.example.com', url: 'https://www.example.com', deployment: null } as never,
        {},
        text,
      );

      expect(out()).toContain('domain:');
      expect(out()).toContain('www.example.com');
    });
  });

  describe('list shapes precede singular shapes', () => {
    it('routes `deployments` to the list table', () => {
      formatOutput(
        {
          deployments: [makeDeployment({ deployment: 'brave-otter-a1b2c3d', files: 2, size: 10 })],
          cursor: null,
        } satisfies DeploymentListResponse,
        {},
        text,
      );

      expect(out()).toContain('deployment');
      expect(out()).toContain('brave-otter-a1b2c3d');
    });

    it('says so plainly when a list is empty', () => {
      formatOutput({ deployments: [], cursor: null } satisfies DeploymentListResponse, {}, text);
      formatOutput({ domains: [], cursor: null } satisfies DomainListResponse, {}, text);
      formatOutput({ tokens: [], cursor: null } satisfies TokenListResponse, {}, text);

      expect(out()).toContain('no deployments found');
      expect(out()).toContain('no domains found');
      expect(out()).toContain('no tokens found');
    });

    it('routes `domains` and `tokens` to their tables', () => {
      formatOutput(
        {
          domains: [makeDomain('www.example.com', { deployment: null })],
          cursor: null,
        } satisfies DomainListResponse,
        {},
        text,
      );
      formatOutput(
        { tokens: [makeToken({ token: 'a1b2c3d' })], cursor: null } satisfies TokenListResponse,
        {},
        text,
      );

      expect(out()).toContain('www.example.com');
      expect(out()).toContain('a1b2c3d');
    });
  });

  describe('a shape with no formatter', () => {
    it('renders what arrived, never the word "success"', () => {
      // Reached the day a command returns a shape the router does not name —
      // `GET /limits` and `GET /labels` are the live candidates. This printed
      // a bare "success" until 2026-07-29: an assertion that the call worked,
      // which the exit code already carried, in place of the answer.
      formatOutput(
        { maxFileSize: 52428800, maxFilesCount: 1000, maxTotalSize: 209715200 } as never,
        {},
        text,
      );

      expect(out()).toContain('maxFileSize');
      expect(out()).toContain('52428800');
      expect(out()).not.toMatch(/^success$/m);
    });
  });

  describe('ping and void results', () => {
    it('answers a reached ping as reachable — arriving here IS the answer', () => {
      formatOutput({ timestamp: NOW } satisfies PingResponse, { operation: 'ping' }, text);
      expect(out()).toContain('api reachable');
    });

    it('transmits the ping response in --json rather than a sentence', () => {
      // This emitted `{ success: "api reachable" }` until 2026-07-29 — prose in
      // the data channel, under a key the wire then also used as a boolean. The
      // wire has since dropped `success` entirely, so the collision it caused
      // cannot recur — and this fixture carried that dead key for another day,
      // because `as never` let it.
      formatOutput(
        { timestamp: NOW } satisfies PingResponse,
        { operation: 'ping' },
        {
          json: true,
          noColor: true,
        },
      );
      expect(JSON.parse(logs[0])).toEqual({ timestamp: NOW });
    });

    it('states the transitional status a deployment deletion acknowledged', () => {
      // 202, not 200: the row is marked `deleting` and the files go on being
      // served until the cleanup queue drains. Saying "deleted" here denied
      // exactly that, to the one caller who most needs to know it.
      formatOutput(
        {
          deployment: 'happy-cat-abc1234.shipstatic.com',
          status: 'deleting',
        } satisfies DeploymentDeleteResponse,
        { operation: 'delete', resourceType: 'Deployment' },
        text,
      );

      expect(out()).toContain(
        'happy-cat-abc1234.shipstatic.com deployment deleting — served until cleanup completes',
      );
      expect(out()).not.toContain('deployment deleted');
    });

    it("never reads an entity's own status as a deletion state", () => {
      // `Domain.status` is `pending`/`success` — a fact about DNS, not about
      // this deletion. Gating on the transitional-state map rather than on the
      // presence of a `status` is what keeps "domain pending" unsayable here.
      formatOutput(
        makeDomain('www.example.com', { status: 'pending' }),
        { operation: 'delete', resourceType: 'Domain' },
        text,
      );

      expect(out()).toContain('www.example.com domain deleted');
      expect(out()).not.toContain('pending');
    });

    it('says "deleted" for a hard delete, which carries no state to state', () => {
      // A domain acknowledgement is the key alone — the row is gone, so the
      // past tense is the whole truth. The tense follows the wire either way.
      formatOutput(
        { domain: 'www.example.com' },
        { operation: 'delete', resourceType: 'Domain' },
        text,
      );

      expect(out()).toContain('www.example.com domain deleted');
    });

    it('reads the key the resource names, so a domain is not read as a deployment', () => {
      // A domain acknowledgement is `{domain}`; were the field chosen by shape
      // rather than by the command's own resource, an entity carrying both
      // nouns would resolve to the wrong one.
      // Deliberately a shape the API cannot send — no acknowledgement carries
      // two resource nouns — because that is the only way to exercise the
      // selection rule at all. The cast is the assertion: this is impossible
      // input, and the formatter still resolves it by the command's resource
      // rather than by whichever key it happens to meet first.
      formatOutput(
        { domain: 'www.example.com', deployment: 'happy-cat-abc1234.shipstatic.com' } as never,
        { operation: 'delete', resourceType: 'Domain' },
        text,
      );

      expect(out()).toContain('www.example.com domain deleted');
    });
  });

  describe('validate and acknowledgement shapes', () => {
    it('reports a valid domain with its normalized form and availability', () => {
      formatOutput(
        {
          valid: true,
          normalized: 'www.example.com',
          available: true,
          reason: null,
        } satisfies DomainValidateResponse,
        {},
        text,
      );

      expect(out()).toContain('domain is valid');
      expect(out()).toContain('normalized: www.example.com');
      expect(out()).toContain('available');
    });

    it('reports an invalid domain through the error channel', () => {
      formatOutput(
        {
          valid: false,
          normalized: null,
          available: null,
          reason: 'Contains invalid characters',
        } satisfies DomainValidateResponse,
        {},
        text,
      );

      expect(errs.join('\n')).toContain('contains invalid characters');
    });

    it('composes its own copy for the verify acknowledgement', () => {
      // The wire carries no prose, so the CLI writes the sentence. A bare
      // `{ domain }` is the acknowledgement; a Domain entity carries `url`,
      // which is the only thing separating the two shapes here.
      formatOutput({ domain: 'www.example.com' } satisfies DomainVerifyResponse, {}, text);

      expect(out()).toContain('www.example.com dns verification queued');
    });

    it('routes a full Domain entity to the entity formatter, not the ack', () => {
      formatOutput(
        { domain: 'www.example.com', url: 'https://www.example.com', links: 1 } as never,
        {},
        text,
      );

      expect(out()).not.toContain('dns verification queued');
      expect(out()).toContain('https://www.example.com');
    });
  });

  describe('quiet mode emits only the pipeable identifier', () => {
    const quiet = { quiet: true };

    it.each([
      [
        'deployments',
        { deployments: [{ deployment: 'brave-otter-a1b2c3d' }] },
        'brave-otter-a1b2c3d',
      ],
      ['domains', { domains: [{ domain: 'www.example.com' }] }, 'www.example.com'],
      ['tokens', { tokens: [{ token: 'a1b2c3d' }] }, 'a1b2c3d'],
      ['single domain', { domain: 'www.example.com' }, 'www.example.com'],
      ['single deployment', { deployment: 'brave-otter-a1b2c3d' }, 'brave-otter-a1b2c3d'],
      ['account', { email: 'test@example.com' }, 'test@example.com'],
      ['token secret', { secret: 'deploy-abc' }, 'deploy-abc'],
    ])('%s', (_name, result, expected) => {
      formatOutput(result as never, {}, quiet);
      expect(logs).toEqual([expected]);
    });

    it('emits the setup URL for a share hash', () => {
      formatOutput({ domain: 'www.example.com', hash: 'abc123' } as never, {}, quiet);
      expect(logs).toEqual(['https://setup.shipstatic.com/abc123/www.example.com']);
    });

    it('emits nothing for a ping — a clock is not an identifier to pipe', () => {
      formatOutput({ timestamp: NOW } satisfies PingResponse, {}, quiet);
      expect(logs).toEqual([]);
    });

    it('emits the key a deletion acknowledged, not nothing', () => {
      // Quiet prints the key on every shape that has one, deletions included —
      // that is what makes `ship deployments delete x -q` composable. This
      // asserted silence while deletions still resolved void.
      formatOutput(
        {
          deployment: 'happy-cat-abc1234.shipstatic.com',
          status: 'deleting',
        } satisfies DeploymentDeleteResponse,
        { operation: 'delete', resourceType: 'Deployment' },
        quiet,
      );
      expect(logs).toEqual(['happy-cat-abc1234.shipstatic.com']);
    });

    it('emits nothing for an invalid domain, so a pipeline sees empty output', () => {
      formatOutput({ valid: false, normalized: null } as never, {}, quiet);
      expect(logs).toEqual([]);
    });
  });

  describe('--json strips internal fields', () => {
    it('removes _dnsRecords, _shareHash and isCreate', () => {
      formatOutput(
        {
          domain: 'www.example.com',
          isCreate: true,
          _dnsRecords: [{ type: 'A', name: '@', value: '1.2.3.4' }],
          _shareHash: 'abc',
        } as never,
        {},
        { json: true },
      );

      const parsed = JSON.parse(logs[0]);
      expect(parsed).toEqual({ domain: 'www.example.com' });
    });
  });

  describe('DNS enrichment on domain create', () => {
    it('prints the records and the setup link the CLI pre-fetched', () => {
      formatOutput(
        {
          domain: 'www.example.com',
          url: 'https://www.example.com',
          isCreate: true,
          _dnsRecords: [{ type: 'CNAME', name: 'www', value: 'cname.shipstatic.com' }],
          _shareHash: 'abc123',
        } as never,
        { operation: 'set' },
        text,
      );

      const output = out();
      expect(output).toContain('domain created');
      expect(output).toContain('CNAME: www → cname.shipstatic.com');
      expect(output).toContain('https://setup.shipstatic.com/abc123/www.example.com');
      // The enrichment fields are display-only and never rendered as data rows.
      expect(output).not.toContain('_dnsRecords');
      expect(output).not.toContain('_shareHash');
    });

    it('says "updated" when the upsert was not a create', () => {
      formatOutput(
        { domain: 'www.example.com', url: 'https://www.example.com', isCreate: false } as never,
        { operation: 'set' },
        text,
      );

      expect(out()).toContain('domain updated');
    });
  });
});
