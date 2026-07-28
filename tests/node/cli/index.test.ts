/**
 * @file Subject: `src/node/cli/index.ts` — the command tree, driven IN-PROCESS
 * via `buildProgram()` against the per-file mock server.
 *
 * This is the tier that makes the 917-line entry measurable: the child
 * process tier (`smoke.test.ts`) proves the same tree through the real
 * binary but is invisible to V8. Everything here observes only public
 * behaviour — argv in; stdout, stderr, exit code, and mock-server state out.
 *
 * Formatter internals (tables, CTA wording) are pinned in
 * `formatters.unit.test.ts` / `utils.unit.test.ts`; this file asserts the
 * WIRING: which command reaches which endpoint with which options, and how
 * outcomes surface across text / `--json` / `-q` modes.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { A_RECORD_IP, CNAME_TARGET, deploymentId } from '../../fixtures/builders';
import { mockState } from '../../mocks/server';
import { runProgram } from './harness';

const DEMO_SITE = path.resolve(__dirname, '../../fixtures/demo-site');

/** The seeded deployment (`tests/mocks/state.ts`) — `brave-otter-a1b2c3d.…`. */
const SEEDED = deploymentId();
const SEEDED_SLUG = SEEDED.split('.')[0];

describe('CLI command tree (in-process)', () => {
  // ---------------------------------------------------------------------------
  // Help & version
  // ---------------------------------------------------------------------------

  describe('help and version', () => {
    it('prints help and exits 0 with no arguments', async () => {
      const result = await runProgram([]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
      expect(result.stdout).toContain('ship deployments upload <path>');
    });

    it('prints the same front page for --help and -h', async () => {
      for (const args of [['--help'], ['-h']]) {
        const result = await runProgram(args);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('USAGE');
      }
    });

    it('subcommand --help renders native scoped help, not the front page', async () => {
      const result = await runProgram(['domains', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^Usage: ship domains/);
      expect(result.stdout).not.toContain('Please report any issues');
    });

    it('prints scoped help rather than a parse error when --help follows a missing argument', async () => {
      const result = await runProgram(['deployments', 'upload', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^Usage: ship deployments upload/);
      expect(result.stderr).toBe('');
    });

    it('prints the package version for --version and -V', async () => {
      for (const args of [['--version'], ['-V']]) {
        const result = await runProgram(args);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
      }
    });

    it('ship help is the same one page — it must never resolve credentials', async () => {
      // Before 2026-07-27 `ship help` fell into the deploy shortcut: it
      // loaded the config file, resolved credentials, and on a machine with
      // a legacy `.shiprc` printed a config ERROR instead of help.
      const result = await runProgram(['help'], { anonymous: true });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('USAGE');
      expect(result.stderr).toBe('');
    });

    it("ship help <command> renders that command's native scoped help", async () => {
      const result = await runProgram(['help', 'deployments']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^Usage: ship deployments/);
      expect(result.stdout).toContain('upload');
    });
  });

  // ---------------------------------------------------------------------------
  // ping / whoami / account
  // ---------------------------------------------------------------------------

  describe('ping and account', () => {
    it('ping succeeds against the mock server', async () => {
      const result = await runProgram(['ping']);
      expect(result.exitCode).toBe(0);
    });

    it('ping -q produces no stdout', async () => {
      const result = await runProgram(['-q', 'ping']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('');
    });

    it('ping exits 1 when the API answers unsuccessfully', async () => {
      // The wire-truth mock can never answer `success: false` (the real API
      // doesn't), so the defensive branch gets a bespoke non-conforming
      // upstream. The exit code IS the result — `ship ping && …` must not
      // proceed when the API is not reachable.
      const server = createServer((req, res) => {
        res.setHeader('content-type', 'application/json');
        if (req.url?.startsWith('/limits')) {
          res.end(JSON.stringify({ maxFileSize: 1, maxFilesCount: 1, maxTotalSize: 1 }));
          return;
        }
        res.end(JSON.stringify({ success: false }));
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      try {
        const result = await runProgram(['--api-url', `http://127.0.0.1:${port}`, 'ping']);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('api unreachable');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('whoami prints the account email', async () => {
      const result = await runProgram(['whoami']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('test@example.com');
    });

    it('whoami --json returns the account object', async () => {
      const result = await runProgram(['--json', 'whoami']);
      expect(result.exitCode).toBe(0);
      const account = JSON.parse(result.stdout.trim());
      expect(account.email).toBe('test@example.com');
      expect(account.plan).toBe('free');
    });

    it('account get is the same surface as whoami', async () => {
      const whoami = await runProgram(['--json', 'whoami']);
      const accountGet = await runProgram(['--json', 'account', 'get']);
      expect(accountGet.exitCode).toBe(0);
      expect(JSON.parse(accountGet.stdout.trim())).toEqual(JSON.parse(whoami.stdout.trim()));
    });

    it('anonymous whoami fails with the credential hint, exit 1', async () => {
      const result = await runProgram(['whoami'], { anonymous: true });
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toLowerCase()).toMatch(/token|authentication/);
    });
  });

  // ---------------------------------------------------------------------------
  // Deploy — shortcut and explicit command
  // ---------------------------------------------------------------------------

  describe('deploy', () => {
    it('deploys a directory via the shortcut (--json)', async () => {
      const result = await runProgram(['--json', DEMO_SITE]);
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.deployment).toMatch(/^mock-deploy-\d{3}\.shipstatic\.com$/);
      expect(output.via).toBe('cli');
      expect(output.labels).toEqual([]);
    });

    it('deploys via the explicit command with identical result shape', async () => {
      const shortcut = await runProgram(['--json', DEMO_SITE, '--label', 'parity-check']);
      const explicit = await runProgram([
        '--json',
        'deployments',
        'upload',
        DEMO_SITE,
        '--label',
        'parity-check',
      ]);
      expect(shortcut.exitCode).toBe(0);
      expect(explicit.exitCode).toBe(0);
      const a = JSON.parse(shortcut.stdout.trim());
      const b = JSON.parse(explicit.stdout.trim());
      expect(a.labels).toEqual(b.labels);
      expect(a.via).toEqual(b.via);
    });

    it('quiet mode prints exactly the deployment hostname', async () => {
      const result = await runProgram(['-q', DEMO_SITE]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^mock-deploy-\d{3}\.shipstatic\.com$/);
    });

    it('-q takes precedence over --json', async () => {
      const result = await runProgram(['-q', '--json', DEMO_SITE]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^mock-deploy-\d{3}\.shipstatic\.com$/);
      expect(result.stdout).not.toContain('{');
    });

    it('text mode reports the uploaded deployment and its details', async () => {
      const result = await runProgram([DEMO_SITE]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(
        /^https:\/\/mock-deploy-\d{3}\.shipstatic\.com deployment uploaded/,
      );
      expect(result.stdout).toContain('status:');
    });

    it('a nonexistent path that looks like a path reports "path does not exist"', async () => {
      const result = await runProgram(['./no-such-directory-here']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('path does not exist');
    });

    it('accepts --no-path-detect and --no-spa-detect', async () => {
      const result = await runProgram(['--json', DEMO_SITE, '--no-path-detect', '--no-spa-detect']);
      expect(result.exitCode).toBe(0);
    });

    it('anonymous deploy carries the claim URL (--json keeps it for scripts)', async () => {
      const result = await runProgram(['--json', DEMO_SITE], { anonymous: true });
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.claim).toMatch(/^https:\/\/my\.shipstatic\.com\/claim\/[a-f0-9]{64}$/);
      expect(output.expires).toBeGreaterThan(output.created);
    });

    it('credentialed deploy carries no claim', async () => {
      const result = await runProgram(['--json', DEMO_SITE]);
      const output = JSON.parse(result.stdout.trim());
      expect(output.claim).toBeUndefined();
      expect(output.expires).toBeNull();
    });
  });

  describe('deploy: via field', () => {
    it('defaults via to cli', async () => {
      const result = await runProgram(['--json', DEMO_SITE]);
      expect(JSON.parse(result.stdout.trim()).via).toBe('cli');
    });

    it('SHIP_VIA overrides via (subprocess integrations like the GitHub Action)', async () => {
      const result = await runProgram(['--json', DEMO_SITE], { env: { SHIP_VIA: 'git' } });
      expect(JSON.parse(result.stdout.trim()).via).toBe('git');
    });

    it('an empty SHIP_VIA falls back to cli', async () => {
      const result = await runProgram(['--json', DEMO_SITE], { env: { SHIP_VIA: '' } });
      expect(JSON.parse(result.stdout.trim()).via).toBe('cli');
    });
  });

  describe('deploy: labels', () => {
    it('sends a single --label', async () => {
      const result = await runProgram(['--json', DEMO_SITE, '--label', 'production']);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).labels).toEqual(['production']);
    });

    it('preserves order across repeated --label flags', async () => {
      const result = await runProgram([
        '--json',
        DEMO_SITE,
        '--label',
        'first',
        '--label',
        'second',
        '--label',
        'third',
      ]);
      expect(JSON.parse(result.stdout.trim()).labels).toEqual(['first', 'second', 'third']);
    });

    it('accepts separator characters the platform allows', async () => {
      const result = await runProgram([
        '--json',
        DEMO_SITE,
        '--label',
        'release-2024',
        '--label',
        'version_1.0.0',
      ]);
      expect(JSON.parse(result.stdout.trim()).labels).toEqual(['release-2024', 'version_1.0.0']);
    });

    it('filters empty strings out of a mixed label list', async () => {
      const result = await runProgram([
        '--json',
        DEMO_SITE,
        '--label',
        '',
        '--label',
        'production',
      ]);
      expect(JSON.parse(result.stdout.trim()).labels).toEqual(['production']);
    });

    it('rejects labels shorter than 3 characters before any request (SDK boundary)', async () => {
      const result = await runProgram(['--json', DEMO_SITE, '--label', 'ab']);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr.trim()).error).toContain('at least 3 characters');
    });

    it('rejects more than 10 labels before any request (SDK boundary)', async () => {
      const labels = Array.from({ length: 11 }, (_, i) => [
        '--label',
        `label${String(i + 1).padStart(2, '0')}`,
      ]).flat();
      const result = await runProgram(['--json', DEMO_SITE, ...labels]);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr.trim()).error).toContain('Maximum 10 labels');
    });
  });

  describe('deploy: password', () => {
    it('forwards an empty --password to the validator (no silent drop)', async () => {
      const result = await runProgram(['--json', DEMO_SITE, '--password', '']);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr.trim()).error).toContain('between 6 and 128 characters');
    });

    it('rejects --password shorter than 6 characters', async () => {
      const result = await runProgram(['--json', DEMO_SITE, '--password', 'short']);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr.trim()).error).toContain('between 6 and 128 characters');
    });

    it('rejects --password longer than 128 characters', async () => {
      const result = await runProgram(['--json', DEMO_SITE, '--password', 'a'.repeat(129)]);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr.trim()).error).toContain('between 6 and 128 characters');
    });

    it('accepts --password at the minimum length and the server records it', async () => {
      const result = await runProgram(['--json', DEMO_SITE, '--password', 'abcdef']);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).password).toBe(true);
    });

    it('treats an empty SHIP_PASSWORD env var as unset (CI/Docker convention)', async () => {
      const result = await runProgram(['--json', DEMO_SITE], { env: { SHIP_PASSWORD: '' } });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim()).password).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Deployments resource commands
  // ---------------------------------------------------------------------------

  describe('deployments', () => {
    it('list --json returns the seeded deployment', async () => {
      const result = await runProgram(['--json', 'deployments', 'list']);
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      // The list contract, verbatim through the CLI: the collection and its
      // cursor, nothing else.
      expect(Object.keys(output).sort()).toEqual(['cursor', 'deployments']);
      expect(output.deployments.map((d: { deployment: string }) => d.deployment)).toContain(SEEDED);
    });

    it('list paginates with --limit and --cursor through to the last page', async () => {
      // Two more deployments beside the seeded one: three rows, page size two.
      await runProgram(['--json', DEMO_SITE]);
      await runProgram(['--json', DEMO_SITE]);

      const first = await runProgram(['--json', 'deployments', 'list', '--limit', '2']);
      expect(first.exitCode).toBe(0);
      const page1 = JSON.parse(first.stdout.trim());
      expect(page1.deployments).toHaveLength(2);
      expect(page1.cursor).not.toBeNull();

      const second = await runProgram([
        '--json',
        'deployments',
        'list',
        '--limit',
        '2',
        '--cursor',
        page1.cursor,
      ]);
      const page2 = JSON.parse(second.stdout.trim());
      expect(page2.deployments).toHaveLength(1);
      expect(page2.cursor).toBeNull();

      const ids = [...page1.deployments, ...page2.deployments].map(
        (d: { deployment: string }) => d.deployment,
      );
      expect(new Set(ids).size).toBe(3);
    });

    it('text mode surfaces the continuation cursor as a rerun hint', async () => {
      await runProgram(['--json', DEMO_SITE]);
      const result = await runProgram(['deployments', 'list', '--limit', '1']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('more results available — rerun with --cursor');
    });

    it('text mode prints no hint on the last page', async () => {
      const result = await runProgram(['deployments', 'list']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain('more results available');
    });

    it('list --limit rejects a non-number before any request', async () => {
      const result = await runProgram(['deployments', 'list', '--limit', 'many']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toLowerCase()).toContain('not a number');
    });

    it('get resolves a bare slug (API accepts slug or hostname)', async () => {
      const result = await runProgram(['deployments', 'get', SEEDED_SLUG]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(SEEDED);
    });

    it('get for a missing deployment exits 1 with not-found', async () => {
      const result = await runProgram(['deployments', 'get', 'absent-otter-zzz9999']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found');
    });

    it('set updates labels through PATCH and the server state changes', async () => {
      const result = await runProgram([
        'deployments',
        'set',
        SEEDED_SLUG,
        '--label',
        'alpha',
        '--label',
        'beta',
      ]);
      expect(result.exitCode).toBe(0);
      const row = mockState().deployments.find((d) => d.deployment === SEEDED);
      expect(row?.labels).toEqual(['alpha', 'beta']);
    });

    it('set with no --label clears all labels (empty array is the clear signal)', async () => {
      await runProgram(['deployments', 'set', SEEDED_SLUG, '--label', 'to-clear']);
      const result = await runProgram(['deployments', 'set', SEEDED_SLUG]);
      expect(result.exitCode).toBe(0);
      const row = mockState().deployments.find((d) => d.deployment === SEEDED);
      expect(row?.labels).toEqual([]);
    });

    it('remove reports the async 202 outcome as a removal success', async () => {
      const result = await runProgram(['deployments', 'remove', SEEDED_SLUG]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(`${SEEDED_SLUG} deployment removed\n\n`);
    });

    it('--json errors are machine-readable', async () => {
      const result = await runProgram(['--json', 'deployments', 'get', 'absent-otter-zzz9999']);
      expect(result.exitCode).toBe(1);
      const parsed = JSON.parse(result.stderr.trim());
      expect(typeof parsed.error).toBe('string');
      expect(parsed.error).toContain('not found');
    });
  });

  // ---------------------------------------------------------------------------
  // Domains resource commands
  // ---------------------------------------------------------------------------

  describe('domains', () => {
    it('list --json returns the seeded platform domain', async () => {
      const result = await runProgram(['--json', 'domains', 'list']);
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.domains.map((d: { domain: string }) => d.domain)).toContain(
        'staging-site.shipstatic.com',
      );
    });

    it('get shows the seeded domain', async () => {
      const result = await runProgram(['domains', 'get', 'staging-site.shipstatic.com']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('staging-site.shipstatic.com');
    });

    it('get for an absent domain exits 1 with not-found', async () => {
      const result = await runProgram(['domains', 'get', 'www.absent-example.com']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found');
    });

    it('creating a custom domain enriches the output with DNS records and the setup link', async () => {
      const result = await runProgram(['domains', 'set', 'www.example.com', SEEDED_SLUG]);
      expect(result.exitCode).toBe(0);
      // A first (apex redirect), CNAME second (hosted endpoint).
      expect(result.stdout).toContain(A_RECORD_IP);
      expect(result.stdout).toContain(CNAME_TARGET);
      expect(result.stdout).toContain('https://setup.shipstatic.com/');
    });

    it('create --json strips the CLI-only enrichment fields', async () => {
      const result = await runProgram(['--json', 'domains', 'set', 'www.json-strip.com']);
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.domain).toBe('www.json-strip.com');
      expect(output._dnsRecords).toBeUndefined();
      expect(output._shareHash).toBeUndefined();
      expect(output.isCreate).toBeUndefined();
    });

    it('updating an existing domain does not re-print DNS enrichment', async () => {
      const result = await runProgram([
        'domains',
        'set',
        'staging-site.shipstatic.com',
        '--label',
        'updated',
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain(A_RECORD_IP);
    });

    it('quiet create prints exactly the domain name', async () => {
      const result = await runProgram(['-q', 'domains', 'set', 'www.quiet-create.com']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('www.quiet-create.com');
    });

    it('linking to a nonexistent deployment surfaces the 422 business error', async () => {
      const result = await runProgram([
        'domains',
        'set',
        'www.bad-link.com',
        'absent-otter-zzz9999',
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toLowerCase()).toContain('must exist');
    });

    it('reservation (no deployment) creates a pending unlinked domain', async () => {
      const result = await runProgram(['--json', 'domains', 'set', 'www.reserved-example.com']);
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.deployment).toBeNull();
      expect(output.status).toBe('pending');
    });

    it('remove deletes the row — a follow-up get is not-found', async () => {
      await runProgram(['domains', 'set', 'www.short-lived.com']);
      const removal = await runProgram(['domains', 'remove', 'www.short-lived.com']);
      expect(removal.exitCode).toBe(0);
      expect(removal.stdout).toBe('www.short-lived.com domain removed\n\n');
      const after = await runProgram(['domains', 'get', 'www.short-lived.com']);
      expect(after.exitCode).toBe(1);
    });
  });

  describe('domains sub-resources', () => {
    it('records lists the required DNS records (A first, CNAME second)', async () => {
      await runProgram(['domains', 'set', 'www.records-test.com']);
      const result = await runProgram(['--json', 'domains', 'records', 'www.records-test.com']);
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.apex).toBe('records-test.com');
      expect(output.records[0]).toEqual({ type: 'A', name: '@', value: A_RECORD_IP });
      expect(output.records[1]).toEqual({ type: 'CNAME', name: 'www', value: CNAME_TARGET });
    });

    it('records for a platform domain is refused — custom domains only', async () => {
      const result = await runProgram(['domains', 'records', 'staging-site.shipstatic.com']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('custom domains');
    });

    it('dns -q prints exactly the provider name', async () => {
      await runProgram(['domains', 'set', 'www.dns-test.com']);
      const result = await runProgram(['-q', 'domains', 'dns', 'www.dns-test.com']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('Cloudflare');
    });

    it('share prints the setup link', async () => {
      await runProgram(['domains', 'set', 'www.share-test.com']);
      const result = await runProgram(['domains', 'share', 'www.share-test.com']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('https://setup.shipstatic.com/');
    });

    it('verify queues once, then the cooldown answers a real 429', async () => {
      await runProgram(['domains', 'set', 'www.verify-test.com']);
      const first = await runProgram(['domains', 'verify', 'www.verify-test.com']);
      expect(first.exitCode).toBe(0);
      expect(first.stdout.toLowerCase()).toContain('queued');

      const second = await runProgram(['domains', 'verify', 'www.verify-test.com']);
      expect(second.exitCode).toBe(1);
      expect(second.stderr).toContain('already requested recently');
    });
  });

  describe('domains validate', () => {
    it('exits 0 for a valid domain', async () => {
      const result = await runProgram(['domains', 'validate', 'www.example.com']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('domain is valid');
    });

    it('normalizes a custom apex to www. (the auto-fix flow reads this)', async () => {
      const result = await runProgram(['-q', 'domains', 'validate', 'example.com']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('www.example.com');
    });

    it('exits 1 for an invalid domain', async () => {
      const result = await runProgram(['domains', 'validate', 'not a domain']);
      expect(result.exitCode).toBe(1);
    });

    it('quiet mode is silent for an invalid domain — the exit code is the answer', async () => {
      const result = await runProgram(['-q', 'domains', 'validate', 'not a domain']);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
    });

    it('--json reports valid: false with exit 1', async () => {
      const result = await runProgram(['--json', 'domains', 'validate', 'not a domain']);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout.trim()).valid).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Tokens resource commands
  // ---------------------------------------------------------------------------

  // Label FORMAT rules on `tokens create` are enforced server-side only (the
  // SDK validates labels client-side for deploys, not token creation), and the
  // mock does not reimplement the API's schema — so rejection tests for token
  // labels live at the API tier, not here.
  describe('tokens', () => {
    it('create returns the secret once, shaped like a deploy token', async () => {
      const result = await runProgram(['--json', 'tokens', 'create']);
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.secret).toMatch(/^deploy-[0-9a-f]{64}$/);
      expect(output.labels).toEqual([]);
    });

    it('create --ttl --label: the server derives state from both options', async () => {
      const result = await runProgram([
        '--json',
        'tokens',
        'create',
        '--ttl',
        '3600',
        '--label',
        'temporary',
        '--label',
        'test',
      ]);
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.labels).toEqual(['temporary', 'test']);

      // The options must have LEFT the process — assert the server-side row,
      // not the response echo.
      const state = mockState();
      const row = state.tokens.find((t) => t.token === output.token);
      expect(row?.labels).toEqual(['temporary', 'test']);
      expect(row?.expires).toBe(state.now + 3600);
    });

    it('create --ttl rejects a non-number before any request (was NaN on the wire)', async () => {
      const result = await runProgram(['tokens', 'create', '--ttl', 'abc']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toLowerCase()).toContain('not a number');
      expect(mockState().tokens).toHaveLength(0);
    });

    it('create -q prints exactly the secret (the value you pipe forward)', async () => {
      const result = await runProgram(['-q', 'tokens', 'create']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^deploy-[0-9a-f]{64}$/);
    });

    it('list shows created tokens', async () => {
      const created = await runProgram(['--json', 'tokens', 'create']);
      const id = JSON.parse(created.stdout.trim()).token;
      const result = await runProgram(['--json', 'tokens', 'list']);
      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.tokens.map((t: { token: string }) => t.token)).toContain(id);
    });

    it('remove deletes the token — 200 with a message, and the row is gone', async () => {
      const created = await runProgram(['--json', 'tokens', 'create']);
      const id = JSON.parse(created.stdout.trim()).token;
      const removal = await runProgram(['tokens', 'remove', id]);
      expect(removal.exitCode).toBe(0);
      expect(removal.stdout).toBe(`${id} token removed\n\n`);
      expect(mockState().tokens.find((t) => t.token === id)).toBeUndefined();
    });

    it('remove for an unknown token exits 1 with not-found', async () => {
      const result = await runProgram(['tokens', 'remove', 'absent1']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found');
    });
  });
});
