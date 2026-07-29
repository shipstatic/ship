/**
 * @file The mock API: ONE Web-standard handler, two transports.
 *
 * `handleApiRequest(request, state)` is a plain `Request → Response` function.
 * `mocks/server.ts` puts it on a socket for the child-process CLI tier;
 * in-process tests can also inject it straight into the SDK's `fetch` option,
 * which is a published contract, so no socket is involved at all.
 *
 * **Every route cites its wire truth** (`// wire: <file>:<line>` in
 * `cloudflare/api`). That citation is the anti-drift mechanism: when the API
 * changes, the cited lines are a mechanical checklist rather than a memory
 * exercise. This is a hand-maintained twin — `tests/e2e/smoke.e2e.test.ts`
 * pins the same contract points against the real thing.
 *
 * **And every body `satisfies` its published type**, which is the half a
 * citation cannot do. A citation is prose: it says a reader checked, and it
 * goes on saying so after the cited line changes. On 2026-07-29 this file
 * answered `POST /domains/validate` with `error: 'Domain is required'` while
 * the very line it cited (`lib/domains/validate.ts:32`) said `reason` — the
 * key the wave had renamed BECAUSE `error` collides with `ErrorType`'s. The
 * fiction was invisible because `json()` took `unknown`, so roughly 900 tests
 * ran against a shape the API cannot produce, under a citation that made it
 * look verified. The API annotates its own route literals this way; the twin
 * now keeps the same discipline, so a fiction is a compile error rather than
 * a reading exercise.
 *
 * **And its BEHAVIOUR is pinned by `tests/contract.ts`** — the statuses, the
 * typed errors and the guard ordering ship depends on, stated once and run by
 * two runners: `tests/contract.test.ts` against this handler in CI, and the
 * `wire contract` block of `tests/e2e/smoke.e2e.test.ts` against the real API.
 * A citation cannot do that half: a route flipping 202 to 200 leaves every
 * `// wire:` comment reading exactly as before.
 *
 * Verified against `cloudflare/api` on 2026-07-29.
 */

import {
  classifyToken,
  type DeploymentDeleteResponse,
  type DeploymentListResponse,
  type DomainDeleteResponse,
  type DomainDnsResponse,
  type DomainListResponse,
  type DomainRecordsResponse,
  type DomainShareResponse,
  type DomainValidateResponse,
  type DomainVerifyResponse,
  type PingResponse,
  ShipError,
  type SPACheckResponse,
  type TokenDeleteResponse,
  TokenKind,
  type TokenListResponse,
} from '@shipstatic/types';
import { isCustomDomain, makeDnsRecords, makeDomain } from '../fixtures/builders';
import type { MockState } from './state';

// =============================================================================
// RESPONSE HELPERS
// =============================================================================

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/**
 * Errors are serialized exactly as the API serializes them: the global
 * `app.onError` handler calls `err.toResponse()`, which yields
 * `{ error, message, status?, details? }`.
 * wire: cloudflare/api/src/index.ts (app.onError)
 */
const fail = (error: ShipError, headers: Record<string, string> = {}) =>
  json(error.toResponse(), error.status ?? 500, headers);

/**
 * 429s additionally carry `Retry-After`, derived from `details.resetAt`.
 * wire: cloudflare/api/src/index.ts:140-146
 */
function failRateLimit(error: ShipError, now: number): Response {
  const resetAt = (error.details as { resetAt?: string } | undefined)?.resetAt;
  const seconds = resetAt ? Math.max(1, Math.ceil((Date.parse(resetAt) - now) / 1000)) : 60;
  return fail(error, { 'Retry-After': String(seconds) });
}

// =============================================================================
// AUTH
// =============================================================================

/**
 * Routes reachable without a credential — and NOTHING else.
 *
 * wire: `/ping` + `/limits` (createAuthMiddleware optional),
 * `POST /deployments` (allowPublicDeploys — routes/deployments.ts:52),
 * `POST /spa-check` (`{ deployScope: true, optional: true }` — routes/spa-check.ts:36).
 * `POST /tokens` is NOT public: routes/tokens.ts:56-58 puts auth on every
 * token route. An earlier mock let it through, so an SDK regression dropping
 * the Authorization header on `tokens.create()` was undetectable.
 */
function isPublic(method: string, path: string): boolean {
  if (path === '/ping' || path === '/limits') return true;
  if (path === '/deployments' && method === 'POST') return true;
  if (path === '/spa-check' && method === 'POST') return true;
  return false;
}

/**
 * The bearer is classified by shape with the platform's own `classifyToken`,
 * so a value like `'test-api-key'` can no longer authenticate anything.
 * wire: cloudflare/api/src/lib/auth/index.ts — an opaque bearer is refused
 * with `internal: 'credential_unrecognized'`, and `toResponse()` strips
 * `details` when an authentication error carries `internal`.
 */
function authError(header: string | null): ShipError | null {
  if (!header) {
    // wire: lib/auth/index.ts:313 — missing credential
    return ShipError.authentication('Authentication required');
  }
  const token = header.replace(/^Bearer\s+/i, '');
  if (classifyToken(token) === TokenKind.OPAQUE) {
    // wire: lib/auth/index.ts:196 — invalid credential
    return ShipError.authentication('Authentication failed', {
      internal: 'credential_unrecognized',
    });
  }
  return null;
}

// =============================================================================
// HANDLER
// =============================================================================

export async function handleApiRequest(request: Request, state: MockState): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

  // Test-only lever for exercising the 429 path on any route.
  if (request.headers.get('x-mock-rate-limit') === 'true') {
    return failRateLimit(
      ShipError.rateLimit('Too many requests. Please try again in 1 minute.', {
        resetAt: new Date(state.now + 60_000).toISOString(),
      }),
      state.now,
    );
  }

  if (!isPublic(method, path)) {
    const error = authError(request.headers.get('Authorization'));
    if (error) return fail(error);
  }

  const segments = path.split('/').filter(Boolean);

  // --- /ping ------------------------------------------------------------
  // wire: routes/ping.ts:8
  if (path === '/ping' && method === 'GET') {
    return json({ timestamp: state.now } satisfies PingResponse);
  }

  // --- /limits ----------------------------------------------------------
  // wire: routes/limits.ts:13 — plan limits; anonymous callers get free.
  if (path === '/limits' && method === 'GET') {
    return json(state.limits);
  }

  // --- /account ---------------------------------------------------------
  // wire: routes/account.ts:61
  if (path === '/account' && method === 'GET') {
    return json(state.account);
  }

  // --- /spa-check -------------------------------------------------------
  // wire: routes/spa-check.ts:28 — optional auth, anonymous callers allowed.
  if (path === '/spa-check' && method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      files?: string[];
      index?: string;
    };
    const isSPA = Boolean(
      body.files?.includes('index.html') && /id=['"]root['"]/.test(body.index ?? ''),
    );
    return json({
      isSPA,
      debug: isSPA
        ? { tier: 'inclusions', reason: 'React mount point detected' }
        : { tier: 'fallback', reason: 'No SPA indicators found' },
    } satisfies SPACheckResponse);
  }

  // --- /deployments -----------------------------------------------------
  if (path === '/deployments') {
    // wire: routes/deployments.ts:235 — returns the list unconditionally,
    // paginated by `limit`/`cursor` query params. There is no `?populate`
    // parameter; the previous mock invented one, so every
    // `deployments.list()` against state came back empty.
    if (method === 'GET') {
      const page = paginate(state.deployments, url.searchParams);
      return json({
        deployments: page.items,
        cursor: page.cursor,
      } satisfies DeploymentListResponse);
    }
    // wire: routes/deployments.ts:52 → lib/deployment-orchestrator.ts — the
    // multipart form's `labels` (JSON array), `via`, and `password` fields are
    // persisted and echoed on the response.
    if (method === 'POST') {
      const anonymous = !request.headers.get('Authorization');
      const form = await request.formData().catch(() => null);
      const labelsField = form?.get('labels');
      let labels: string[] | undefined;
      if (typeof labelsField === 'string') {
        try {
          const parsed: unknown = JSON.parse(labelsField);
          if (Array.isArray(parsed)) labels = parsed as string[];
        } catch {}
      }
      const viaField = form?.get('via');
      const deployment = state.createDeployment(anonymous, {
        ...(labels !== undefined && { labels }),
        ...(typeof viaField === 'string' && viaField !== '' && { via: viaField }),
        password: typeof form?.get('password') === 'string',
      });
      return json(deployment, 201);
    }
    return methodNotAllowed();
  }

  if (segments[0] === 'deployments' && segments.length >= 2) {
    const id = decodeURIComponent(segments[1]);
    const found = state.findDeployment(id);

    if (method === 'GET' && segments.length === 2) {
      // wire: routes/deployments.ts:69
      if (!found) return fail(ShipError.notFound('Deployment', id));
      return json(found);
    }
    if (method === 'PATCH' && segments.length === 2) {
      // wire: routes/deployments.ts:185 — labels only, 200 with the updated row.
      if (!found) return fail(ShipError.notFound('Deployment', id));
      const body = (await request.json().catch(() => ({}))) as { labels?: string[] };
      if (!Array.isArray(body.labels)) {
        return fail(ShipError.validation('Invalid request body'));
      }
      found.labels = body.labels;
      return json(found);
    }
    if (method === 'DELETE' && segments.length === 2) {
      // wire: routes/deployments.ts:132 — 202, async cleanup. The row
      // survives its own deletion long enough to state the status it is
      // transitioning through; nothing else rides along.
      if (!found) return fail(ShipError.notFound('Deployment', id));
      return json(
        { deployment: found.deployment, status: 'deleting' } satisfies DeploymentDeleteResponse,
        202,
      );
    }
    return methodNotAllowed();
  }

  // --- /domains ---------------------------------------------------------
  if (path === '/domains' && method === 'GET') {
    // wire: routes/domains.ts:186 — same limit/cursor pagination.
    const page = paginate(state.domains, url.searchParams);
    return json({ domains: page.items, cursor: page.cursor } satisfies DomainListResponse);
  }

  if (path === '/domains/validate' && method === 'POST') {
    // wire: lib/domains/validate.ts:25-75
    const body = (await request.json().catch(() => ({}))) as { domain?: unknown };
    if (typeof body.domain !== 'string') {
      return json({
        valid: false,
        normalized: null,
        available: null,
        reason: 'Domain is required',
      } satisfies DomainValidateResponse);
    }
    return json(state.validateDomain(body.domain.trim()));
  }

  if (segments[0] === 'domains' && segments.length >= 2) {
    const name = decodeURIComponent(segments[1]);
    const sub = segments[2];

    if (sub && method === 'GET' && (sub === 'dns' || sub === 'records' || sub === 'share')) {
      return domainSubResource(sub, name, state);
    }
    if (sub === 'verify' && method === 'POST') {
      return verifyDomain(name, state);
    }
    if (sub) return methodNotAllowed();

    if (method === 'GET') {
      // wire: routes/domains.ts:174
      const found = state.domains.find((d) => d.domain === name);
      if (!found) return fail(ShipError.notFound('Domain', name));
      return json(found);
    }
    if (method === 'PUT') {
      return upsertDomain(request, name, state);
    }
    if (method === 'DELETE') {
      // wire: routes/domains.ts:203 — 200, and the row is gone, so the
      // canonical name is the whole acknowledgement.
      const index = state.domains.findIndex((d) => d.domain === name);
      if (index === -1) return fail(ShipError.notFound('Domain', name));
      state.domains.splice(index, 1);
      return json({ domain: name } satisfies DomainDeleteResponse);
    }
    return methodNotAllowed();
  }

  // --- /tokens ----------------------------------------------------------
  if (path === '/tokens') {
    // wire: routes/tokens.ts:114 — same limit/cursor pagination as the other
    // collections; every list answers exactly `{ <collection>, cursor }`.
    // `cursor: null` is the whole has-more signal, which is why there is no
    // count here: a page is not an aggregate.
    if (method === 'GET') {
      const page = paginate(state.tokens, url.searchParams);
      return json({ tokens: page.items, cursor: page.cursor } satisfies TokenListResponse);
    }
    // wire: routes/tokens.ts:66 — 201.
    if (method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as {
        ttl?: number;
        labels?: string[];
      };
      return json(state.createToken(body), 201);
    }
    return methodNotAllowed();
  }

  if (segments[0] === 'tokens' && segments.length === 2 && method === 'GET') {
    // wire: routes/tokens.ts — the same row the listing carries, built by the
    // same `toTokenResponse`, so an item and a list row are one token
    // described one way. Account-scoped: an unknown id is a 404, never a 403.
    const id = decodeURIComponent(segments[1]);
    const row = state.tokens.find((t) => t.token === id);
    if (!row) return fail(ShipError.notFound('Token'));
    return json(row);
  }

  if (segments[0] === 'tokens' && segments.length === 2 && method === 'DELETE') {
    // wire: routes/tokens.ts:161-201 — 200 `{token}`, not 202: revocation
    // is synchronous, and the identifier is all that is left to name.
    const id = decodeURIComponent(segments[1]);
    const index = state.tokens.findIndex((t) => t.token === id);
    if (index === -1) return fail(ShipError.notFound('Token'));
    state.tokens.splice(index, 1);
    return json({ token: id } satisfies TokenDeleteResponse);
  }

  // The API registers no `notFound` handler, so Hono's default answers:
  // plain text, not the ShipError envelope. wire: cloudflare/api/src/index.ts
  return new Response('404 Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
  });
}

/**
 * Cursor pagination for the list routes. The wire cursor is OPAQUE to
 * clients (they only ever echo it back), so the mock's encoding — the next
 * offset, stringified — is a private detail no test may decode.
 * wire: routes/deployments.ts:235, routes/domains.ts:186, routes/tokens.ts:114
 * (limit/cursor) — one helper because the real API drives all three through
 * one keyset engine (`api/src/lib/database/pagination.ts`).
 */
function paginate<T>(rows: T[], params: URLSearchParams): { items: T[]; cursor: string | null } {
  const offset = Number(params.get('cursor') ?? 0) || 0;
  const limitParam = params.get('limit');
  const limit = limitParam !== null ? Number(limitParam) : Number.POSITIVE_INFINITY;
  const items = rows.slice(offset, offset + limit);
  const next = offset + items.length;
  return { items, cursor: next < rows.length ? String(next) : null };
}

/**
 * A matched path with an unmatched method answers 404 like the real router.
 * The previous mock fell through without responding, so `PATCH /deployments/:id`
 * — a published SDK method — hung the socket for 30 seconds.
 */
function methodNotAllowed(): Response {
  return new Response('404 Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
  });
}

// =============================================================================
// DOMAIN SUB-RESOURCES
// =============================================================================

/** All three guards are `business_logic_error`, and say "custom domains". */
function domainSubResource(sub: 'dns' | 'records' | 'share', name: string, state: MockState) {
  const subject = sub === 'share' ? 'Setup sharing' : 'DNS information';

  // wire: routes/domains.ts:103 (dns), :129 (records), :152 (share)
  if (!isCustomDomain(name)) {
    return fail(ShipError.business(`${subject} is only available for custom domains`, 400));
  }

  const domain = state.domains.find((d) => d.domain === name);
  if (!domain) return fail(ShipError.notFound('Domain', name));

  // `records` has no verified-status guard; `dns` and `share` do.
  if (sub !== 'records' && domain.status !== 'pending') {
    return fail(ShipError.business(`${subject} is only available for unverified domains`, 400));
  }

  if (sub === 'dns') {
    return json({
      domain: name,
      dns: { provider: { name: 'Cloudflare' } },
    } satisfies DomainDnsResponse);
  }
  if (sub === 'records') {
    // wire: routes/domains.ts:135 — apex from getApexDomain()
    const apex = name.startsWith('www.') ? name.slice(4) : name;
    return json({ domain: name, apex, records: makeDnsRecords() } satisfies DomainRecordsResponse);
  }
  return json({
    domain: name,
    hash: 'abc123def456abc123def456abc123de',
  } satisfies DomainShareResponse);
}

/** wire: lib/domains/verify.ts:18-64 */
function verifyDomain(name: string, state: MockState) {
  if (!isCustomDomain(name)) {
    return fail(ShipError.business('DNS verification is only available for custom domains', 400));
  }
  const domain = state.domains.find((d) => d.domain === name);
  if (!domain) return fail(ShipError.notFound('Domain', name));
  if (domain.status !== 'pending') {
    return fail(
      ShipError.business('DNS verification is only available for unverified domains', 400),
    );
  }

  // The cooldown is a real 429 with a real body — the previous mock sent a
  // `validation_failed`/`status: 400` body under a 429 head, and no
  // `Retry-After`. wire: verify.ts:46-49
  if (state.verifyCooldown.has(name)) {
    const resetAt = new Date(state.now + 60_000).toISOString();
    return failRateLimit(
      ShipError.rateLimit(
        'DNS verification was already requested recently. Please try again in 1 minute.',
        { resetAt },
      ),
      state.now,
    );
  }
  state.verifyCooldown.add(name);
  // 202: queued, not performed. wire: lib/domains/verify.ts:63
  return json({ domain: name } satisfies DomainVerifyResponse, 202);
}

/** wire: lib/domains/upsert.ts — merge-upsert, 201 on create / 200 on update. */
async function upsertDomain(request: Request, name: string, state: MockState) {
  let body: { deployment?: unknown; labels?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail(ShipError.validation('Invalid JSON in request body'));
  }

  // `deployment` is `z.string().min(1).optional()` — NOT nullable. An explicit
  // null fails the schema, which is how "no unlinking" is enforced. The
  // previous mock answered 200 and unlinked, certifying behaviour the product
  // forbids. wire: lib/validation.ts:498-512
  if (body.deployment === null) {
    return fail(ShipError.validation('Deployment cannot be empty'));
  }
  if (body.deployment !== undefined && typeof body.deployment !== 'string') {
    return fail(ShipError.validation('Deployment cannot be empty'));
  }

  const deployment = body.deployment as string | undefined;
  if (deployment && !state.findDeployment(deployment)) {
    // 422, not 404 — the deployment reference is a business-rule failure on an
    // otherwise well-formed request. wire: lib/domains/upsert.ts:69-74
    return fail(
      ShipError.business(
        'Deployment must exist, have success status, and never expire to create domain',
        422,
      ),
    );
  }

  const labels = Array.isArray(body.labels) ? (body.labels as string[]) : undefined;
  const existing = state.domains.find((d) => d.domain === name);

  if (existing) {
    // Merge: omitted fields keep their current value, and `created`/`linked`/
    // `links` are properties of the ROW — an update must not regenerate them.
    if (deployment !== undefined) {
      existing.deployment = state.findDeployment(deployment)?.deployment ?? deployment;
      existing.linked = state.now;
      existing.links += 1;
    }
    if (labels !== undefined) existing.labels = labels;
    return json(existing);
  }

  const created = makeDomain(name, {
    deployment: deployment ? (state.findDeployment(deployment)?.deployment ?? deployment) : null,
    labels: labels ?? [],
    created: state.now,
    linked: deployment ? state.now : null,
    links: deployment ? 1 : 0,
  });
  state.domains.push(created);
  return json(created, 201);
}
