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
 * **Verified by reading `cloudflare/api` at 54caef2 on 2026-10-19**: every
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
 *
 * **`ErrorType.Build` has no row either.** It is a per-call outcome, but of
 * `/upload`'s `build` flag, which this client sends only through the
 * `@internal` endpoint redirect the dashboard uses; the public contract here
 * is `/deployments`, a pure pipe that never builds. Its round-trip is held in
 * `@shipstatic/types`' own suite and its retry posture in `http-retry`.
 */

import { DEPLOY_FIELDS, ErrorType } from '@shipstatic/types';
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
  /**
   * A deployment carrying a non-null `expires`. Absent on the live runner,
   * which creates no domains and so has nothing to attempt a link with.
   */
  expiringDeployment?: string;
  /**
   * A credential-less client — the anonymous population, which is a real
   * client of this API and not an error case. Both runners guarantee it, and
   * both guarantee it is genuinely anonymous: the SDK reads `SHIP_TOKEN` from
   * the environment, so a suite that merely omits the option is anonymous
   * only on a machine that happens not to export one.
   */
  anonymous: Ship;
  /**
   * A directory this runner may deploy. A fixture like any other: the two
   * runners resolve their own, and no row hardcodes a path into this table.
   */
  sitePath: string;
  /**
   * A directory whose `index.html` is an empty application shell: a
   * single-page app, which the platform gives its routing config.
   */
  appPath: string;
  /** A directory with a page but no `index.html` at its root: not a website. */
  noHomePath: string;
  /**
   * A directory larger than one deploy request carries
   * (`writeLargeSite`), so the SDK sends it in several requests.
   */
  largeSitePath: string;
  /**
   * Told of every deployment a row creates, so the live runner can delete it
   * after the run as it deletes its own; the mock runner's state resets.
   */
  created: (deployment: string) => void;
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
const NO_ANONYMOUS_DEPLOYS =
  'e2e makes no anonymous deployment: one it cannot delete lingers for days';
const NO_TOKENS = 'e2e creates no tokens — they accumulate with no cleanup path';

/** A deployment, and the declaring request that made it. */
interface Declared {
  deployment: { deployment: string; config: boolean };
  declaration?: FormData;
}

/**
 * Run a deploy and keep its declaring request's body: the first request that
 * carries a manifest. Told to the runner, so the live half deletes it.
 */
async function declared(
  s: Ship,
  c: ContractContext,
  deploy: () => Promise<Declared['deployment']>,
): Promise<Declared> {
  let declaration: FormData | undefined;
  const sent = (_url: string, init: RequestInit) => {
    if (!declaration && init.body instanceof FormData && init.body.has(DEPLOY_FIELDS.MANIFEST)) {
      declaration = init.body;
    }
  };
  s.on('request', sent);
  try {
    const deployment = await deploy();
    c.created(deployment.deployment);
    return { deployment, declaration };
  } finally {
    s.off('request', sent);
  }
}

export const CONTRACT: readonly ContractPoint[] = [
  // --- reads ---------------------------------------------------------------
  { name: 'ping', status: 200, live: true, run: (s) => s.ping() },
  {
    // The blocklist is the API's and reaches clients ONLY here. If the field
    // stops arriving, `validateFiles` and the deploy pipeline silently stop
    // warning — a deploy still fails, but at the boundary after an upload
    // rather than instantly. Nothing else in this repo can observe that, which
    // is precisely why the point is stated on the LIVE half.
    name: 'getLimits',
    status: 200,
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
      // The way forward past each limit, one sentence per limit, which the
      // SDK appends to its own refusal verbatim. Without it a refusal made
      // here states a number and stops, which is the silence this field ends.
      const suggestions = (r as { suggestions?: Record<string, unknown> }).suggestions;
      for (const key of ['maxFileSize', 'maxFilesCount', 'maxTotalSize']) {
        if (typeof suggestions?.[key] !== 'string' || !suggestions[key]) {
          throw new Error(
            `GET /limits must carry suggestions.${key}, a sentence — ` +
              'wire: cloudflare/api/src/lib/entitlements.ts limitSuggestions, served by routes/limits.ts.',
          );
        }
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
  {
    // The acknowledgement states where the row IS, not what the call did, so
    // a repeat is the same 202 and the same object; nothing is flipped twice.
    name: 'deployments.delete (repeat)',
    status: 202,
    live: true,
    run: async (s, c) => {
      await s.deployments.delete(c.deployment);
      return s.deployments.delete(c.deployment);
    },
  },

  // --- deploys ----------------------------------------------------------------
  {
    // The declaration, then the files route. A deploy larger than one request
    // is declared bare (the manifest and the options), answers 202 pending,
    // and each batch of files follows to `POST /deployments/:deployment/files`
    // until one answers 201 live. The status a caller sees is the last one,
    // and the row also holds the sequence, since a deploy that answered 201
    // at the declaration would pass on the status alone.
    //
    // The files that configure a deployment ride its declaration, and the
    // API refuses one that leaves the root index.html behind (400), so the
    // row reads the declaring request's own body for it.
    // wire: routes/deployments.ts (POST / and POST /:deployment/files) →
    // lib/deployment-orchestrator.ts (createDeployment, fillDeployment, declare)
    name: 'deployments.upload (several requests)',
    status: 201,
    live: true,
    assert: (r) => {
      const { deployment, statuses } = r as { deployment: { status: string }; statuses: number[] };
      const deploys = statuses.filter((status) => status === 201 || status === 202);
      if (deploys[0] !== 202 || deploys.at(-1) !== 201 || deploys.length < 3) {
        throw new Error(
          `A deploy over one request must answer 202, then 202 or 201 per fill, ending 201; saw ${deploys.join(', ')}`,
        );
      }
      if (deployment.status !== 'success') {
        throw new Error(`The last answer must be the live deployment, got ${deployment.status}`);
      }
      const { declaration } = r as { declaration?: FormData };
      const carried = (declaration?.getAll('files[]') ?? []).map((file) => (file as File).name);
      if (!carried.includes('index.html')) {
        throw new Error(`The declaration must carry index.html; saw ${carried.join(', ')}`);
      }
    },
    run: async (s, c) => {
      const statuses: number[] = [];
      const seen = (response: Response) => statuses.push(response.status);
      s.on('response', seen);
      try {
        return { ...(await declared(s, c, () => s.deployments.upload(c.largeSitePath))), statuses };
      } finally {
        s.off('response', seen);
      }
    },
  },
  {
    // The platform asks every deploy the single-page question unless it
    // sends `spa=false`, and this client no longer writes the routing config
    // itself, so an app deployed with no option must come back configured
    // and its request must carry no `spa` field. The live half is what proves
    // the API asks by default.
    // wire: lib/upload-input.ts (`collectSpaFromFormData`) →
    // lib/platform-files.ts (`platformFiles`)
    name: 'deployments.upload (an app)',
    status: 201,
    live: true,
    assert: (r) => {
      const { deployment, declaration } = r as Declared;
      if (declaration?.has(DEPLOY_FIELDS.SPA)) {
        throw new Error('A deploy that keeps the default sends no spa field');
      }
      if (deployment.config !== true) {
        throw new Error('The platform must give an app its routing config');
      }
    },
    run: (s, c) => declared(s, c, () => s.deployments.upload(c.appPath)),
  },
  {
    // The opt-out is the one value this client sends, and the API answers it
    // with a deployment that carries no routing config of the platform's.
    // wire: lib/upload-input.ts (`collectSpaFromFormData`)
    name: 'deployments.upload (an app, spaDetect false)',
    status: 201,
    live: true,
    assert: (r) => {
      const { deployment, declaration } = r as Declared;
      if (declaration?.get(DEPLOY_FIELDS.SPA) !== 'false') {
        throw new Error('The opt-out must be sent as spa=false');
      }
      if (deployment.config !== false) {
        throw new Error('An opted-out app must get no routing config');
      }
    },
    run: (s, c) => declared(s, c, () => s.deployments.upload(c.appPath, { spaDetect: false })),
  },
  {
    // ShipStatic publishes websites, so a deployment has an index.html at its
    // root. This client refuses one without it before a byte is sent, in the
    // words the API would use (the deploy rules, `@shipstatic/types`), so the
    // live half proves the refusal reads as a validation error with no
    // request made. The API's own refusal is held by its suite and its smoke.
    // wire: lib/validation.ts (`validateUpload`) → `@shipstatic/types` SET_RULES
    name: 'deployments.upload (no index.html)',
    error: { type: ErrorType.Validation, status: 400 },
    live: true,
    run: (s, c) => s.deployments.upload(c.noHomePath),
  },
  {
    // An anonymous deploy carries a manifest like every deploy this client
    // makes, and completes in the one request it declares in: the free plan's
    // whole deployment fits one, so the SDK never splits one, and the claim
    // rides the answer. The refusal of an anonymous declaration the request
    // does not complete is unreachable through this client for that reason;
    // `cloudflare/api`'s own suite holds it. The answer arrives on the
    // anonymous client, which `observe` does not watch, so this row reads the
    // status off that client itself and states no `status` of its own.
    // wire: lib/deployment-orchestrator.ts, `declare`
    name: 'deployments.upload (anonymous)',
    live: NO_ANONYMOUS_DEPLOYS,
    assert: (r) => {
      const { deployment, status } = r as { deployment: { claim?: unknown }; status?: number };
      if (status !== 201 || typeof deployment.claim !== 'string') {
        throw new Error(`An anonymous deploy must answer 201 with its claim URL; saw ${status}`);
      }
    },
    run: async (_s, c) => {
      let status: number | undefined;
      const seen = (response: Response) => {
        status = response.status;
      };
      c.anonymous.on('response', seen);
      try {
        return { deployment: await c.anonymous.deployments.upload(c.sitePath), status };
      } finally {
        c.anonymous.off('response', seen);
      }
    },
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
    // A requested lifetime needs a deployer, and anonymity has none. The
    // platform owns the anonymous window as POLICY — the claim code's TTL is
    // pinned to `DEPLOYMENT.PUBLIC_TTL` by law — so honouring a shorter one
    // would hand out a claim link that outlives the thing it claims. That
    // makes this a coherence guard rather than a preference, and one `if` in
    // the orchestrator is all that holds it.
    //
    // LIVE, and the live half is the whole point: the mock half can only say
    // the mock matches this table, while removing the guard from the API is
    // exactly the drift nothing else here would see.
    //
    // It costs one slot of the anonymous issuance budget per run (the agent
    // budget per IP, `WRITE_BUDGETS`), because the limiter runs before the
    // orchestrator refuses. Recorded so the diagnosis is instant: many e2e
    // runs inside an hour turn this row's `Authentication` into a `RateLimit`,
    // and that is the budget talking, not the contract.
    // wire: lib/deployment-orchestrator.ts, ShipError.authentication
    name: 'deployments.upload (anonymous, with ttl)',
    error: { type: ErrorType.Authentication, status: 401 },
    live: true,
    run: (_s, c) => c.anonymous.deployments.upload(c.sitePath, { ttl: 3600 }),
  },
  {
    // A domain is a commitment; a deadline is its opposite. The API refuses to
    // link any deployment carrying a non-null `expires`, which is what keeps
    // the reaper from tearing a live domain's target away — and with the
    // refusal at the LINK door, the reaper needs no check of its own.
    //
    // The guard predates requestable lifetimes (`verifyDeploymentOwnership`
    // has always carried `AND expires IS NULL`); `--ttl` is what makes it
    // reachable by ordinary use, which is what earns it a wire row.
    // wire: lib/database/domains.ts:324 → lib/domains/upsert.ts (422)
    name: 'domains.set (expiring deployment)',
    error: { type: ErrorType.Business, status: 422 },
    live: NO_DOMAINS,
    run: (s, c) => s.domains.set(c.missingDomain, { deployment: c.expiringDeployment as string }),
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
  {
    // Guard ORDER again, one step earlier: the CREATION-only name rules run
    // before the deployment reference is verified, so an apex name fails as a
    // 400 `validation_failed` (a ZodError through the global handler) and not
    // as the 422 above. This is the failure `ship <path> --domain example.com`
    // produces AFTER a successful deploy, which is why ship pins it: the
    // platform has no CNAME to point an apex at (root CLAUDE.md, "Custom
    // Domain Model"). wire: lib/domains/upsert.ts:55 → lib/validation.ts:399
    name: 'domains.set (apex)',
    error: { type: ErrorType.Validation, status: 400 },
    live: NO_DOMAINS,
    run: (s) => s.domains.set('apex-example.com'),
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
 * The LAST `response` event is the operation's own: a deploy's `/limits` read
 * precedes it.
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
