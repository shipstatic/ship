/**
 * @file Subject: `src/node/cli/formatters.ts` — every resource formatter and
 * the `formatOutput` router that dispatches to them.
 *
 * The router dispatches on the command's declared identity, so these tests
 * pass a context everywhere and there is no branch order to pin. See
 * CLAUDE.md, "formatOutput Router".
 */

import type {
  DeploymentCreateResponse,
  DeploymentDeleteResponse,
  DeploymentListResponse,
  DomainDnsResponse,
  DomainListResponse,
  DomainRecordsResponse,
  DomainShareResponse,
  DomainValidateResponse,
  DomainVerifyResponse,
  PingResponse,
  TokenListResponse,
} from '@shipstatic/types';
import { API_KEY } from '@shipstatic/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatDeployment,
  formatOutput,
  OUTPUTS,
  type OutputContext,
} from '../../../src/node/cli/formatters';
import type { CLIResult } from '../../../src/node/cli/types';
import {
  claimUrl,
  makeAccountRow,
  makeDeployment,
  makeDnsRecords,
  makeDomain,
  makeToken,
  makeTokenCreateResponse,
} from '../../fixtures/builders';

const NOW = 1_700_000_000;
const CLAIM_URL = claimUrl('a'.repeat(API_KEY.HEX_LENGTH));

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
    formatDeployment(anonymousDeployment, { noColor: true });

    const output = logs.join('\n');
    expect(output).toContain('expires in 3 days');
    expect(output).toContain(CLAIM_URL);
    // The details block never lists `claim` as a field — the CTA is its
    // one text rendering.
    expect(output).not.toMatch(/^claim:/m);
  });

  it('omits the CTA entirely for credentialed deploys', () => {
    const { claim: _claim, expires: _expires, ...kept } = anonymousDeployment;
    formatDeployment(kept as DeploymentCreateResponse, { noColor: true });

    const output = logs.join('\n');
    expect(output).not.toContain('claim');
    expect(output).not.toContain('expire');
  });

  it('keeps `claim` in --json output for scripts, while `isCreate` stays internal', () => {
    formatOutput(
      { ...anonymousDeployment, isCreate: true } as unknown as DeploymentCreateResponse,
      { operation: 'upload', resource: 'deployment' },
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

  describe('declaration decides, never the shape of the response', () => {
    // Every payload here carries a `domain` field. Under the old shape-sniffing
    // router their resolution ORDER was load-bearing — `records`, `hash` and
    // `dns` had to be probed before `domain`, or all three would have rendered
    // as a plain domain. Order is not a concept any more: the command says
    // which it is, so these cases cannot collide.
    const DOMAIN = 'www.example.com';

    it.each<[OutputContext, CLIResult, string]>([
      [
        { operation: 'records', resource: 'domain' },
        {
          domain: DOMAIN,
          apex: 'example.com',
          records: [{ type: 'CNAME', name: 'www', value: 'cname.shipstatic.com' }],
        } as never,
        'cname.shipstatic.com',
      ],
      [
        { operation: 'share', resource: 'domain' },
        { domain: DOMAIN, hash: 'abc123' } as never,
        'https://setup.shipstatic.com/abc123/www.example.com',
      ],
      [
        { operation: 'dns', resource: 'domain' },
        { domain: DOMAIN, dns: { provider: { name: 'Cloudflare' } } } as never,
        'Cloudflare',
      ],
      [
        { operation: 'get', resource: 'domain' },
        { domain: DOMAIN, url: `https://${DOMAIN}`, deployment: null } as never,
        'domain:',
      ],
    ])('%o renders its own answer', (context, result, expected) => {
      formatOutput(result, context, text);
      expect(out()).toContain(expected);
    });

    it('renders ONE payload two ways, according to the command', () => {
      // The property the old router could not have at any price: this payload
      // carries both `domain` and `hash`, so a shape-keyed chain resolved it by
      // whichever key it happened to probe first — one answer, forever. The
      // command is what differs, so the answer differs.
      const payload = { domain: DOMAIN, hash: 'abc123' } as never;

      formatOutput(payload, { operation: 'share', resource: 'domain' }, text);
      expect(out()).toContain('https://setup.shipstatic.com/abc123/www.example.com');

      logs.length = 0;
      formatOutput(payload, { operation: 'get', resource: 'domain' }, text);
      expect(out()).toContain('domain:');
      expect(out()).not.toContain('setup.shipstatic.com');
    });
  });

  describe('lists render as tables', () => {
    it('routes `deployments` to the list table', () => {
      formatOutput(
        {
          deployments: [makeDeployment({ deployment: 'brave-otter-a1b2c3d', files: 2, size: 10 })],
          cursor: null,
        } satisfies DeploymentListResponse,
        { operation: 'list', resource: 'deployment' },
        text,
      );

      expect(out()).toContain('deployment');
      expect(out()).toContain('brave-otter-a1b2c3d');
    });

    it('says so plainly when a list is empty', () => {
      const list = (r: 'deployment' | 'domain' | 'token') =>
        ({ operation: 'list', resource: r }) satisfies OutputContext;
      formatOutput(
        { deployments: [], cursor: null } satisfies DeploymentListResponse,
        list('deployment'),
        text,
      );
      formatOutput(
        { domains: [], cursor: null } satisfies DomainListResponse,
        list('domain'),
        text,
      );
      formatOutput({ tokens: [], cursor: null } satisfies TokenListResponse, list('token'), text);

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
        { operation: 'list', resource: 'domain' },
        text,
      );
      formatOutput(
        { tokens: [makeToken({ token: 'a1b2c3d' })], cursor: null } satisfies TokenListResponse,
        { operation: 'list', resource: 'token' },
        text,
      );

      expect(out()).toContain('www.example.com');
      expect(out()).toContain('a1b2c3d');
    });
  });

  describe('a command with no row', () => {
    it('renders what arrived, never the word "success"', () => {
      // The safety net, reached the day a command lands before its row does —
      // `GET /limits` and `GET /labels` are the live candidates. It printed a
      // bare "success" until 2026-07-29: an assertion that the call worked,
      // which the exit code already carried, in place of the answer. The parity
      // fence now goes red before such a command could be run, so this is a net
      // and not a plan.
      formatOutput(
        { maxFileSize: 52428800, maxFilesCount: 1000, maxTotalSize: 209715200 } as never,
        { operation: 'list', resource: 'account' },
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
        { operation: 'delete', resource: 'deployment' },
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
        { operation: 'delete', resource: 'domain' },
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
        { operation: 'delete', resource: 'domain' },
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
        { operation: 'delete', resource: 'domain' },
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
        { operation: 'validate', resource: 'domain' },
        text,
      );

      // The subject is the response's normalized name, so the sentence names
      // it and the details block no longer repeats it.
      expect(out()).toContain('www.example.com domain is valid');
      expect(out()).toContain('available');
      expect(out()).not.toContain('normalized:');
    });

    it('renders a negative verdict on stdout — a verdict is not a failure', () => {
      formatOutput(
        {
          valid: false,
          normalized: null,
          available: null,
          reason: 'Contains invalid characters',
        } satisfies DomainValidateResponse,
        { operation: 'validate', resource: 'domain' },
        text,
      );

      // The call succeeded and the answer is "no". Stderr under `[error]` said
      // the command had failed, contradicting the SDK (which resolves this
      // shape without throwing) and `--json` (which has always put the same
      // verdict on stdout). The exit code carries the machine-readable half.
      expect(out()).toContain('contains invalid characters');
      expect(errs.join('\n')).toBe('');
    });

    it('composes its own copy for the verify acknowledgement', () => {
      // The wire carries no prose, so the CLI writes the sentence. A bare
      // `{ domain }` is the acknowledgement; a Domain entity carries `url`,
      // which is the only thing separating the two shapes here.
      formatOutput(
        { domain: 'www.example.com' } satisfies DomainVerifyResponse,
        { operation: 'verify', resource: 'domain' },
        text,
      );

      expect(out()).toContain('www.example.com domain verification queued');
    });
  });

  describe('one grammar: every composed sentence opens with the key the response carries', () => {
    // The law (`npm/ship/CLAUDE.md`, "Deletions answer with an acknowledgement"):
    // a sentence about a result is `<canonical key> <resource noun> <verb or
    // wire state>`. Before 2026-07-29 there were SIX forms across eleven
    // messages — `token tok0001 created` inverted the order its own sibling
    // `tok0002 token deleted` used, deploy and `domains set` opened with the
    // URL while `verify` and `delete` opened with the key for the same
    // resource, and `domain is valid` named no subject at all. The text
    // channel disagreed with `-q`, which had always printed the key.
    const DEPLOYMENT = 'brave-otter-a1b2c3d.shipstatic.com';
    const DOMAIN = 'www.example.com';

    const GRAMMAR: Array<[string, CLIResult, OutputContext, string]> = [
      [
        'deploy',
        makeDeployment({ deployment: DEPLOYMENT }),
        { operation: 'upload', resource: 'deployment' },
        DEPLOYMENT,
      ],
      [
        'domains set (create)',
        { ...makeDomain(DOMAIN), isCreate: true },
        { operation: 'set', resource: 'domain' },
        DOMAIN,
      ],
      [
        'domains set (update)',
        { ...makeDomain(DOMAIN), isCreate: false },
        { operation: 'set', resource: 'domain' },
        DOMAIN,
      ],
      [
        'tokens create',
        makeTokenCreateResponse({ token: 'tok0001' }),
        { operation: 'create', resource: 'token' },
        'tok0001',
      ],
      [
        'deployments delete',
        { deployment: DEPLOYMENT, status: 'deleting' } satisfies DeploymentDeleteResponse,
        { operation: 'delete', resource: 'deployment' },
        DEPLOYMENT,
      ],
      ['domains delete', { domain: DOMAIN }, { operation: 'delete', resource: 'domain' }, DOMAIN],
      [
        'tokens delete',
        { token: 'tok0001' },
        { operation: 'delete', resource: 'token' },
        'tok0001',
      ],
      [
        'domains verify',
        { domain: DOMAIN } satisfies DomainVerifyResponse,
        { operation: 'verify', resource: 'domain' },
        DOMAIN,
      ],
      [
        'domains validate',
        {
          valid: true,
          normalized: DOMAIN,
          available: true,
          reason: null,
        } satisfies DomainValidateResponse,
        { operation: 'validate', resource: 'domain' },
        DOMAIN,
      ],
    ];

    it.each(GRAMMAR)('%s opens with its key', (_name, result, context, key) => {
      formatOutput(result, context, text);
      expect(out().startsWith(key), out()).toBe(true);
    });

    it('names the resource noun after the key, never before it', () => {
      formatOutput(
        makeTokenCreateResponse({ token: 'tok0001' }),
        { operation: 'create', resource: 'token' },
        text,
      );
      expect(out()).toContain('tok0001 token created');
      expect(out()).not.toContain('token tok0001 created');
    });
  });

  describe('every row of the table, in both channels', () => {
    // `-q` and text used to be two independent if/else chains over the SHAPE of
    // the response — twelve branches and eleven, same discriminants, same
    // order, nothing tying them. That is how `tokens get` and `tokens delete`
    // came to print nothing under `-q`: the shape existed in one chain and not
    // the other. One table fixed that; keying it by the command's DECLARED
    // identity then removed resolution order as a concept entirely.
    //
    // What a test can still prove is COMPLETENESS — that every command has a
    // row, in both channels — and that is what this is.
    const records = makeDnsRecords();
    const account = makeAccountRow();
    const created = makeTokenCreateResponse();
    const DOMAIN = 'www.example.com';
    const DEPLOYMENT = 'brave-otter-a1b2c3d';

    const ROWS: Array<[string, OutputContext, CLIResult, string[]]> = [
      [
        'deployment.list',
        { operation: 'list', resource: 'deployment' },
        {
          deployments: [makeDeployment({ deployment: DEPLOYMENT })],
          cursor: null,
        } satisfies DeploymentListResponse,
        [DEPLOYMENT],
      ],
      [
        'deployment.upload',
        { operation: 'upload', resource: 'deployment' },
        makeDeployment({ deployment: DEPLOYMENT }),
        [DEPLOYMENT],
      ],
      [
        'deployment.get',
        { operation: 'get', resource: 'deployment' },
        makeDeployment({ deployment: DEPLOYMENT }),
        [DEPLOYMENT],
      ],
      [
        'deployment.set',
        { operation: 'set', resource: 'deployment' },
        makeDeployment({ deployment: DEPLOYMENT }),
        [DEPLOYMENT],
      ],
      [
        'deployment.delete',
        { operation: 'delete', resource: 'deployment' },
        { deployment: DEPLOYMENT, status: 'deleting' } satisfies DeploymentDeleteResponse,
        [DEPLOYMENT],
      ],
      [
        'domain.list',
        { operation: 'list', resource: 'domain' },
        { domains: [makeDomain(DOMAIN)], cursor: null } satisfies DomainListResponse,
        [DOMAIN],
      ],
      ['domain.get', { operation: 'get', resource: 'domain' }, makeDomain(DOMAIN), [DOMAIN]],
      ['domain.set', { operation: 'set', resource: 'domain' }, makeDomain(DOMAIN), [DOMAIN]],
      [
        'domain.validate',
        { operation: 'validate', resource: 'domain' },
        {
          valid: true,
          normalized: DOMAIN,
          available: true,
          reason: null,
        } satisfies DomainValidateResponse,
        [DOMAIN],
      ],
      [
        'domain.verify',
        { operation: 'verify', resource: 'domain' },
        { domain: DOMAIN } satisfies DomainVerifyResponse,
        [DOMAIN],
      ],
      [
        'domain.records',
        { operation: 'records', resource: 'domain' },
        { domain: DOMAIN, apex: 'example.com', records } satisfies DomainRecordsResponse,
        records.map((r) => `${r.type} ${r.name} ${r.value}`),
      ],
      [
        'domain.dns',
        { operation: 'dns', resource: 'domain' },
        { domain: DOMAIN, dns: { provider: { name: 'Cloudflare' } } } as DomainDnsResponse,
        ['Cloudflare'],
      ],
      [
        'domain.share',
        { operation: 'share', resource: 'domain' },
        { domain: DOMAIN, hash: 'abc123' } satisfies DomainShareResponse,
        [`https://setup.shipstatic.com/abc123/${DOMAIN}`],
      ],
      ['domain.delete', { operation: 'delete', resource: 'domain' }, { domain: DOMAIN }, [DOMAIN]],
      [
        'token.list',
        { operation: 'list', resource: 'token' },
        { tokens: [makeToken({ token: 'tok0001' })], cursor: null } satisfies TokenListResponse,
        ['tok0001'],
      ],
      [
        // The secret, not the id — shown once and never again, which is why
        // `ship tokens create -q >> .env` exists. Under the shape-keyed router
        // this needed `secret` probed before `token`; now it is just a row.
        'token.create',
        { operation: 'create', resource: 'token' },
        created,
        [created.secret],
      ],
      [
        'token.get',
        { operation: 'get', resource: 'token' },
        makeToken({ token: 'tok0001' }),
        ['tok0001'],
      ],
      [
        'token.delete',
        { operation: 'delete', resource: 'token' },
        { token: 'tok0001' },
        ['tok0001'],
      ],
      ['account.get', { operation: 'get', resource: 'account' }, account, [account.email]],
      // A clock is not an identifier to pipe.
      ['ping', { operation: 'ping' }, { timestamp: NOW } satisfies PingResponse, []],
    ];

    it.each(ROWS)('%s', (_key, context, result, quietLines) => {
      formatOutput(result, context, { quiet: true });
      expect(logs, 'quiet channel').toEqual(quietLines);

      logs.length = 0;
      formatOutput(result, context, text);
      expect(out().trim(), 'text channel rendered nothing').not.toBe('');
    });

    it('covers every row of the table', () => {
      // Tied to PRODUCTION. This once asserted a LENGTH against this file's own
      // array — it counted itself, so a row added to the table left the suite
      // green while that command was asserted by nothing, the exact scenario it
      // claimed to prevent. A hand-written expectation checked against a
      // hand-written list is a mirror, not a fence.
      expect(ROWS.map(([key]) => key).sort()).toEqual(Object.keys(OUTPUTS).sort());
    });

    it('emits nothing under -q for a verdict with no identifier', () => {
      // An invalid name has no normalized form, so a pipeline sees empty output
      // and the exit code carries the answer.
      formatOutput(
        { valid: false, normalized: null, available: null, reason: 'bad' },
        { operation: 'validate', resource: 'domain' },
        { quiet: true },
      );
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
        { operation: 'set', resource: 'domain' },
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
        { operation: 'set', resource: 'domain' },
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
        { operation: 'set', resource: 'domain' },
        text,
      );

      expect(out()).toContain('domain updated');
    });
  });
});
