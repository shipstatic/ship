/**
 * @file The wire facts ship depends on, stated ONCE.
 *
 * `tests/mocks/handler.ts` is a hand-maintained twin of `cloudflare/api`. Since
 * 2026-07-29 its response SHAPES `satisfies` the published types, so a shape
 * fiction is a compile error. Its BEHAVIOUR — which status, which typed error,
 * which guard fires first — had no such tie: the `// wire:` citations are
 * prose, and prose keeps asserting after the cited line moves.
 *
 * The e2e suite was supposed to be the detector, and its own header said it
 * "asserts the same contract points the mock encodes". Nothing checked that
 * claim. Two hand-maintained lists with nothing tying them together is the
 * exact restatement this codebase spent a week removing everywhere else.
 *
 * So the points live here, once, as data, and two runners consume them:
 *
 *   `tests/contract.test.ts`        against the MOCK — runs in CI
 *   `tests/e2e/smoke.e2e.test.ts`   against the REAL API — opt-in
 *
 * "The mock matches the API" now reduces to "both ran this table", and a
 * failure names the point rather than the symptom.
 *
 * **Both halves are observed through PUBLISHED surface**, which is what lets
 * one table drive both: a success's status arrives on the `response` event
 * (`ship.on('response', …)`), and a failure's status and type arrive on the
 * `ShipError`. Neither runner reaches inside the SDK.
 *
 * **Verified by reading `cloudflare/api` at eda61be on 2026-07-30** — every
 * point below was checked against the route that answers it, not against the
 * mock. That distinction is the whole reason to write it down: the mock half of
 * this table passes tautologically if the expectations were read off the mock,
 * which is exactly how it was first drafted. Both halves of the pair need a
 * source of truth outside themselves, and for the offline half that source is a
 * person reading the routes.
 *
 * The stamp is about ROUTES, not about that repo's HEAD: a commit touching only
 * its docs or tests cannot invalidate it, so move the sha forward when you have
 * actually re-read the routes and leave it alone otherwise. A stamp that has to
 * be refreshed on every unrelated commit is a stamp nobody keeps.
 *
 * Where the API states a status implicitly (Hono's `c.json(body)` defaults to
 * 200) the table still states it explicitly, because a client cannot tell a
 * deliberate 200 from an unconsidered one.
 *
 * **`live` states the coverage honestly.** A row marked with a string is
 * mock-only, and the string is why. That gap always existed — the e2e suite
 * has never touched domains or tokens — but it was invisible; nobody could
 * say which contract points the real API actually verifies. Now the file says
 * so, row by row.
 *
 * **`ErrorType.Maintenance` has NO row here, deliberately.** Every point in
 * this table is a per-call outcome: this request, against that route, answers
 * that status. Maintenance is a platform STATE — while it is set, every route
 * answers it, and while it is unset, no route can. Neither runner can produce
 * one honestly: the live runner would have to close the dev API mid-suite, and
 * a mock row would assert only that the mock was told to. Its end-to-end proof
 * lives where the state can actually be observed — the API repo's post-deploy
 * smoke (`cloudflare/api/smoke.mjs`), which detects a maintenance 503 and
 * verifies the gate instead of reporting it as a fault. Read the absence as a
 * decision, not as drift.
 */

import { ErrorType } from '@shipstatic/types';
import type Ship from '../src/node';

/** Fixtures a runner guarantees before the table runs. */
export interface ContractContext {
  /** A deployment that exists and is addressable. */
  deployment: string;
  /** A well-formed deployment id that does not exist. */
  missingDeployment: string;
  /** A custom domain that exists. Absent on the live runner (see `live`). */
  domain?: string;
  /** A well-formed domain that does not exist. */
  missingDomain: string;
  /** A token that exists. Absent on the live runner (see `live`). */
  token?: string;
}

export interface ContractPoint {
  /** The SDK call, in the platform's own vocabulary. */
  name: string;
  /** The HTTP status a SUCCESSFUL call answers with. */
  status?: number;
  /** The typed failure a FAILING call produces. */
  error?: { type: ErrorType; status: number };
  /** `true` when safe against the real API; a string is the reason it is not. */
  live: true | string;
  /** Anything about the resolved value worth pinning beyond its shape. */
  assert?: (result: unknown) => void;
  run: (ship: Ship, ctx: ContractContext) => Promise<unknown>;
}

const NO_DOMAINS = 'e2e creates no domains — a custom domain has billing implications';
const NO_TOKENS = 'e2e creates no tokens — they accumulate with no cleanup path';

export const CONTRACT: readonly ContractPoint[] = [
  // --- reads ---------------------------------------------------------------
  { name: 'ping', status: 200, live: true, run: (s) => s.ping() },
  {
    // The blocklist is the API's and reaches clients ONLY here. If the field
    // stops arriving, `validateFiles` and the deploy pipeline silently stop
    // warning — a deploy still fails, but at the boundary after an upload
    // rather than instantly. Nothing else in this repo can observe that, which
    // is precisely why the point is stated on the LIVE half.
    // No `status`, and that is a property of the call rather than an omission:
    // `/limits` is fetched once during init and `getLimits()` answers from
    // cache, so this call emits no `response` event — the runners even warm it
    // deliberately so it cannot be mistaken for another row's. Its 200 is
    // exercised by every row here, since none of them would have a client
    // otherwise. This row exists for its `assert`.
    name: 'getLimits',
    live: true,
    assert: (r) => {
      const blocked = (r as { blockedExtensions?: unknown }).blockedExtensions;
      if (!Array.isArray(blocked) || blocked.length === 0) {
        throw new Error(
          'GET /limits must carry a non-empty blockedExtensions array — ' +
            'wire: cloudflare/api/src/lib/blocklist.ts, served by routes/limits.ts. ' +
            'A Set serializes to {} and would arrive as an empty policy.',
        );
      }
      if (blocked.some((ext) => typeof ext !== 'string' || !/^[a-z0-9]+$/.test(ext))) {
        throw new Error('blockedExtensions must be lowercase, dotless extensions');
      }
    },
    run: (s) => s.getLimits(),
  },
  { name: 'account.get', status: 200, live: true, run: (s) => s.account.get() },
  { name: 'deployments.list', status: 200, live: true, run: (s) => s.deployments.list() },
  {
    name: 'deployments.get',
    status: 200,
    live: true,
    run: (s, c) => s.deployments.get(c.deployment),
  },

  // --- deployment mutations ------------------------------------------------
  {
    name: 'deployments.set',
    status: 200,
    live: true,
    run: (s, c) => s.deployments.set(c.deployment, { labels: ['contract'] }),
  },
  {
    // The headline case. 202 says the row is marked `deleting` and the files go
    // on being served until the cleanup queue drains — which is why the CLI
    // says "deleting", not "deleted".
    name: 'deployments.delete',
    status: 202,
    live: true,
    run: (s, c) => s.deployments.delete(c.deployment),
  },

  // --- domain mutations ----------------------------------------------------
  {
    // 201-vs-200 is the ONE status ship branches on: `requestWithStatus` turns
    // it into `isCreate`, which decides whether the CLI says "created" or
    // "updated". A drift here is a user-visible lie, not a cosmetic one.
    name: 'domains.set (create)',
    status: 201,
    live: NO_DOMAINS,
    assert: (r) => {
      if ((r as { isCreate?: boolean }).isCreate !== true) {
        throw new Error('201 must surface as isCreate: true');
      }
    },
    run: (s, c) => s.domains.set(c.missingDomain),
  },
  {
    name: 'domains.set (update)',
    status: 200,
    live: NO_DOMAINS,
    assert: (r) => {
      if ((r as { isCreate?: boolean }).isCreate !== false) {
        throw new Error('200 must surface as isCreate: false');
      }
    },
    run: (s, c) => s.domains.set(c.domain as string, { labels: ['contract'] }),
  },
  { name: 'domains.list', status: 200, live: NO_DOMAINS, run: (s) => s.domains.list() },
  {
    name: 'domains.get',
    status: 200,
    live: NO_DOMAINS,
    run: (s, c) => s.domains.get(c.domain as string),
  },
  {
    name: 'domains.validate',
    status: 200,
    live: NO_DOMAINS,
    run: (s, c) => s.domains.validate(c.missingDomain),
  },
  {
    // Accepted, not performed — which is why the CLI composes "verification
    // queued" rather than reporting a result.
    name: 'domains.verify',
    status: 202,
    live: NO_DOMAINS,
    run: (s, c) => s.domains.verify(c.domain as string),
  },
  {
    name: 'domains.records',
    status: 200,
    live: NO_DOMAINS,
    run: (s, c) => s.domains.records(c.domain as string),
  },
  {
    name: 'domains.dns',
    status: 200,
    live: NO_DOMAINS,
    run: (s, c) => s.domains.dns(c.domain as string),
  },
  {
    name: 'domains.share',
    status: 200,
    live: NO_DOMAINS,
    run: (s, c) => s.domains.share(c.domain as string),
  },
  {
    // 200, not 202: a domain delete is synchronous, so the acknowledgement is
    // the key alone with no state to state.
    name: 'domains.delete',
    status: 200,
    live: NO_DOMAINS,
    run: (s, c) => s.domains.delete(c.domain as string),
  },

  // --- token mutations -----------------------------------------------------
  { name: 'tokens.create', status: 201, live: NO_TOKENS, run: (s) => s.tokens.create({}) },
  { name: 'tokens.list', status: 200, live: NO_TOKENS, run: (s) => s.tokens.list() },
  {
    name: 'tokens.get',
    status: 200,
    live: NO_TOKENS,
    run: (s, c) => s.tokens.get(c.token as string),
  },
  {
    name: 'tokens.delete',
    status: 200,
    live: NO_TOKENS,
    run: (s, c) => s.tokens.delete(c.token as string),
  },

  // --- typed failures ------------------------------------------------------
  {
    name: 'deployments.get (missing)',
    error: { type: ErrorType.NotFound, status: 404 },
    live: true,
    run: (s, c) => s.deployments.get(c.missingDeployment),
  },
  {
    name: 'deployments.delete (missing)',
    error: { type: ErrorType.NotFound, status: 404 },
    live: true,
    run: (s, c) => s.deployments.delete(c.missingDeployment),
  },
  {
    name: 'domains.get (missing)',
    error: { type: ErrorType.NotFound, status: 404 },
    live: NO_DOMAINS,
    run: (s, c) => s.domains.get(c.missingDomain),
  },
  {
    // Guard ORDER, not just the code: an unknown deployment on an otherwise
    // well-formed upsert is a business-rule failure (422), never a 404 for the
    // domain that does not exist yet either.
    name: 'domains.set (unknown deployment)',
    error: { type: ErrorType.Business, status: 422 },
    live: NO_DOMAINS,
    run: (s, c) => s.domains.set(c.missingDomain, { deployment: c.missingDeployment }),
  },
  // Deliberately ABSENT: "no unlinking" (an explicit `deployment: null` on the
  // upsert, which the API rejects with a 400). `setDomain` builds its body with
  // `if (deployment)`, so a falsy value is filtered out before the request
  // exists — ship cannot express that call, and a table of the wire facts SHIP
  // depends on must not claim otherwise. The rule is real and the mock twins
  // it; it belongs to raw HTTP callers. Found by this table on its first run.
  {
    name: 'tokens.get (missing)',
    error: { type: ErrorType.NotFound, status: 404 },
    live: NO_TOKENS,
    run: (s) => s.tokens.get('nosuch1'),
  },
];

/** What a runner observed for one point, through published SDK surface only. */
export interface Observation {
  status?: number;
  errorType?: string;
  errorStatus?: number;
}

/**
 * Run one point and report what the wire said.
 *
 * The LAST `response` event is the operation's own: the lazy `/limits` fetch
 * and any pre-flight (`/spa-check` on a deploy) precede it. Runners warm the
 * client first so that ordering is not load-bearing for the common case.
 *
 * **`assert` runs OUTSIDE the catch, and that placement is load-bearing.**
 * Inside it, a failing assert was reported as though the WIRE had errored —
 * and for a point declaring neither `status` nor `error`, the resulting
 * all-`undefined` observation `toEqual`-matches the all-`undefined`
 * expectation, because `toEqual` treats an undefined property as absent. Such
 * a point's assert could therefore never fail the suite. Found by drilling the
 * `getLimits` row on the day it was written, which is the whole argument for
 * drilling one: it had been green against a mock serving no blocklist at all.
 * An assert failure is a broken EXPECTATION, not an observation of the wire,
 * so it now propagates with its own authored message.
 */
export async function observe(
  ship: Ship,
  point: ContractPoint,
  ctx: ContractContext,
): Promise<Observation> {
  const statuses: number[] = [];
  const onResponse = (response: Response) => statuses.push(response.status);
  ship.on('response', onResponse);

  let result: unknown;
  try {
    result = await point.run(ship, ctx);
  } catch (err) {
    const shipError = err as { type?: string; status?: number };
    return { errorType: shipError.type, errorStatus: shipError.status };
  } finally {
    ship.off('response', onResponse);
  }

  point.assert?.(result);
  return { status: statuses.at(-1) };
}

/** The expectation a point declares, in the same shape `observe` reports. */
export function expected(point: ContractPoint): Observation {
  return point.error
    ? { errorType: point.error.type, errorStatus: point.error.status }
    : { status: point.status };
}
