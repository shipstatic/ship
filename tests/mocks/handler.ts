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
  DEPLOY_FIELDS,
  DEPLOYMENT_CONFIG_FILENAME,
  type DeploymentDeleteResponse,
  type DeploymentListResponse,
  type DomainDeleteResponse,
  type DomainDnsResponse,
  type DomainListResponse,
  type DomainRecordsResponse,
  type DomainShareResponse,
  type DomainValidateResponse,
  type DomainVerifyResponse,
  ErrorType,
  type ManifestEntry,
  type PingResponse,
  ShipError,
  type TokenDeleteResponse,
  TokenKind,
  type TokenListResponse,
  validateTtl,
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
 * `POST /deployments` (allowPublicDeploys — routes/deployments.ts:52).
 * `POST /tokens` is NOT public: routes/tokens.ts:56-58 puts auth on every
 * token route. An earlier mock let it through, so an SDK regression dropping
 * the Authorization header on `tokens.create()` was undetectable.
 */
function isPublic(method: string, path: string): boolean {
  if (path === '/ping' || path === '/limits') return true;
  if (path === '/deployments' && method === 'POST') return true;
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

  // --- /deployments -----------------------------------------------------
  if (path === '/deployments') {
    // wire: routes/deployments.ts:235 — returns the list unconditionally,
    // paginated by `limit`/`cursor` query params. There is no `?populate`
    // parameter; the previous mock invented one, so every
    // `deployments.list()` against state came back empty.
    if (method === 'GET') {
      // A pending deployment is listed nowhere (lib/database/deployments.ts,
      // listDeployments).
      const page = paginate(
        state.deployments.filter((d) => d.status !== 'pending'),
        url.searchParams,
      );
      return json({
        deployments: page.items,
        cursor: page.cursor,
      } satisfies DeploymentListResponse);
    }
    // wire: routes/deployments.ts → lib/deployment-orchestrator.ts, the
    // declaration. The multipart form's `labels` (JSON array), `via`, and
    // `password` fields are persisted and echoed on the response. Without a
    // `manifest` the files carried are the deployment (201); with one, the
    // manifest declares it and the request may carry any of its files: all
    // of them is 201, fewer is 202 and the deployment stays pending.
    if (method === 'POST') {
      const anonymous = !request.headers.get('Authorization');
      // wire: middleware/idempotency.ts: the earliest live deployment the
      // key names, answered as it stands and ahead of everything else the
      // route would do, so a retry costs nothing. An anonymous key is ignored.
      const idempotencyKey = anonymous
        ? undefined
        : request.headers.get('Idempotency-Key')?.trim() || undefined;
      const replay = idempotencyKey
        ? state.deployments.find(
            (d) => d.status === 'success' && state.idempotency.get(d.deployment) === idempotencyKey,
          )
        : undefined;
      if (replay) return json(replay, 201, { 'Idempotency-Replay': 'true' });

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
      // `config` is derived from the DECLARATION, exactly as the API derives
      // it: a `ship.json` at the deploy root (optional leading slash, no other
      // path forgiveness), or the platform's single-page config where the
      // request does not opt out (`spa=false`) and the classifier says yes. The classifier's
      // answer is `state.spa`, set by the test: the SDK's tests pin what the
      // SDK sends, never how the server decides (cloudflare/api/tests/lib/spa.test.ts).
      // That makes `config` an observation of what the client sent:
      // `--no-spa-detect` means `spa=false`, and `--no-path-detect` means a
      // nested ship.json never reaches the root.
      // wire: lib/deployment-orchestrator.ts (`declare`) and
      // lib/platform-files.ts
      const uploaded = (form?.getAll(DEPLOY_FIELDS.FILES) ?? [])
        .filter((entry): entry is File => entry instanceof File)
        .map((file) => file.name.replace(/^\//, ''));
      // A requested lifetime needs a deployer: anonymity has none, and the
      // platform owns the anonymous window as policy (the claim code is
      // measured against it). Refused before anything is created.
      // wire: lib/deployment-orchestrator.ts, ShipError.authentication
      const ttlField = form?.get(DEPLOY_FIELDS.TTL);
      const ttl = typeof ttlField === 'string' ? validateTtl(Number(ttlField)) : undefined;
      if (ttl !== undefined && anonymous) {
        return fail(
          ShipError.authentication(
            'An expiring deployment requires a credential. Anonymous deployments already expire on the platform’s own schedule.',
          ),
        );
      }
      const manifestField = form?.get(DEPLOY_FIELDS.MANIFEST);
      const declared = new Set(
        typeof manifestField === 'string'
          ? (JSON.parse(manifestField) as ManifestEntry[]).map((e) => e.path.replace(/^\//, ''))
          : uploaded,
      );
      const complete = [...declared].every((p) => uploaded.includes(p));
      // wire: lib/upload-input.ts, `collectSpaFromFormData`: absent asks.
      const spaField = form?.get(DEPLOY_FIELDS.SPA) ?? null;
      if (spaField !== null && spaField !== 'true' && spaField !== 'false') {
        return fail(ShipError.validation('The spa field must be true or false.'));
      }
      const asksSpa = spaField !== 'false';
      // wire: lib/deployment-orchestrator.ts, `declare`: the files that
      // configure a deployment ride its declaration.
      for (const path of [DEPLOYMENT_CONFIG_FILENAME, 'index.html']) {
        if (declared.has(path) && !uploaded.includes(path)) {
          return fail(
            ShipError.validation(`${path} must come in the request that sends the manifest.`),
          );
        }
      }
      // wire: lib/deployment-orchestrator.ts, `declare`: law 6, before any write.
      if (!complete && anonymous) {
        return fail(
          ShipError.authentication('A deployment sent in several requests needs a credential.'),
        );
      }
      const deployment = state.createDeployment(anonymous, {
        ...(labels !== undefined && { labels }),
        ...(typeof viaField === 'string' && viaField !== '' && { via: viaField }),
        password: typeof form?.get('password') === 'string',
        ...(ttl !== undefined && { ttl }),
        config:
          declared.has(DEPLOYMENT_CONFIG_FILENAME) ||
          (asksSpa && state.spa && declared.has('index.html')),
        pending: !complete,
      });
      if (idempotencyKey) state.idempotency.set(deployment.deployment, idempotencyKey);
      if (!complete) {
        state.declarations.set(deployment.deployment, {
          declared,
          arrived: new Set(uploaded),
          ...(ttl !== undefined && { ttl }),
        });
        return json(deployment, 202);
      }
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
    // wire: routes/deployments.ts → lib/deployment-orchestrator.ts,
    // `fillDeployment`. A live deployment answers 200 and nothing is written;
    // a pending one takes the files it is sent and commits once every declared
    // file has arrived (201), or stays pending (202); anything else is the
    // one sentence.
    if (method === 'POST' && segments.length === 3 && segments[2] === 'files') {
      if (found?.status === 'success') return json(found);
      const declaration = found ? state.declarations.get(found.deployment) : undefined;
      if (!found || !declaration) {
        return fail(
          new ShipError(
            ErrorType.NotFound,
            'This upload was cancelled or timed out. Deploy again.',
            404,
          ),
        );
      }
      const form = await request.formData().catch(() => null);
      for (const entry of form?.getAll(DEPLOY_FIELDS.FILES) ?? []) {
        if (entry instanceof File) declaration.arrived.add(entry.name.replace(/^\//, ''));
      }
      if (![...declaration.declared].every((p) => declaration.arrived.has(p))) {
        return json(found, 202);
      }
      state.declarations.delete(found.deployment);
      return json(state.commitDeployment(found, declaration.ttl), 201);
    }
    if (method === 'DELETE' && segments.length === 2) {
      // wire: routes/deployments.ts:140 — 202, async cleanup. The row
      // survives its own deletion long enough to state the status it is
      // transitioning through; nothing else rides along. A repeat finds it
      // `deleting` and answers the same object.
      if (!found) return fail(ShipError.notFound('Deployment', id));
      found.status = 'deleting';
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

  // `records` has no verified guard; `dns` and `share` do. The API's guard is
  // the `verified` INSTANT (routes/domains.ts:120, :177), and since types
  // 3.0.0 put that instant on the wire this mirrors it exactly rather than
  // standing in for it with a status word.
  if (sub !== 'records' && domain.verified !== null) {
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
  // wire: routes/domains.ts — the API answers the FINISHED link, composed
  // server-side from its own environment dimension, domain first, hash second.
  return json({
    domain: name,
    url: `https://connect.shipstatic.com/${name}/a1b2c3d4e5f6a7b8`,
  } satisfies DomainShareResponse);
}

/** wire: lib/domains/verify.ts:18-64 */
function verifyDomain(name: string, state: MockState) {
  if (!isCustomDomain(name)) {
    return fail(ShipError.business('DNS verification is only available for custom domains', 400));
  }
  const domain = state.domains.find((d) => d.domain === name);
  if (!domain) return fail(ShipError.notFound('Domain', name));
  // Same guard as the route: the `verified` instant, not a status word
  // (lib/domains/verify.ts:30).
  if (domain.verified !== null) {
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
  const target = deployment ? state.findDeployment(deployment) : undefined;
  // One query, three conditions, one 422 — the API's `verifyDeploymentOwnership`
  // asks `deployment = ? AND account = ? AND status = ? AND expires IS NULL`
  // and the route turns its boolean into this refusal. The expiry clause is
  // what keeps a domain from ever pointing at something the reaper will take.
  // 422, not 404 — the deployment reference is a business-rule failure on an
  // otherwise well-formed request.
  // wire: lib/database/domains.ts:324 → lib/domains/upsert.ts:81-86
  if (deployment && (!target || target.expires !== null)) {
    return fail(
      ShipError.business(
        'A domain can only point at a deployment of yours that succeeded and does not expire.',
        422,
      ),
    );
  }

  const labels = Array.isArray(body.labels) ? (body.labels as string[]) : undefined;
  const existing = state.domains.find((d) => d.domain === name);

  // CREATION-ONLY guards run before the deployment reference is checked, and
  // existing domains are grandfathered past them. The technical one ship can
  // reach: apex domains have no CNAME to point at, so the platform refuses to
  // host them (root CLAUDE.md, "Custom Domain Model"). It is a ZodError, which
  // the global handler turns into a 400 `validation_failed` carrying the
  // schema's own sentence. `labels.length === 2` is the same PSL proxy
  // `state.validateDomain` uses — the real check is `isApex` over the public
  // suffix list. wire: lib/domains/upsert.ts:55 → lib/validation.ts:399-407
  if (!existing && isCustomDomain(name) && name.split('.').length === 2) {
    return fail(
      ShipError.validation(
        `Apex domains are not allowed. Please use a subdomain like 'www.${name}' instead.`,
      ),
    );
  }

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
