/**
 * @file Typed builders — the ONLY source of fixture data.
 *
 * Every value here is a shape the real API can actually produce, checked
 * against `cloudflare/api` on 2026-07-27. That is not pedantry: the previous
 * literals used bare-label domains (`staging`) the lookup schema rejects,
 * deployment ids that fail `isDeployment`, token secrets that fail the
 * platform's own validator, and Vercel's IP for the A record — so tests
 * calibrated client behaviour against inputs no user could ever send.
 *
 * **Determinism law: no `Date.now()`.** Every timestamp is an explicit
 * argument with a fixed default, so a value that reaches an assertion is
 * always the same value.
 */

import type {
  Account,
  AccountGetResponse,
  Deployment,
  DeploymentCreateResponse,
  Domain,
  PlatformLimits,
  Token,
  TokenCreateResponse,
} from '@shipstatic/types';
import { API_KEY, DEPLOY_TOKEN } from '@shipstatic/types';

// =============================================================================
// PLATFORM CONSTANTS (wire truth)
// =============================================================================

/** The mock platform's domain. Production is the only public value. */
export const PLATFORM_DOMAIN = 'shipstatic.com';

/** `getCnameTarget(env.DOMAIN)` — wire: cloudflare/shared/domain.ts:18 */
export const CNAME_TARGET = `cname.${PLATFORM_DOMAIN}`;

/** The platform's real A record. wire: wrangler.{dev,prod}.jsonc `A_RECORD_IP` */
export const A_RECORD_IP = '15.204.149.253';

/** Public/anonymous deployment lifetime and claim window. wire: api/src/lib/config.ts */
export const PUBLIC_TTL_SECONDS = 3 * 24 * 60 * 60;

/**
 * The FREE plan's real limits — what an anonymous or free-plan caller gets
 * from `GET /limits`. wire: cloudflare/api/src/lib/config.ts
 * `ACCOUNT_LIMITS.free`, served by routes/limits.ts.
 *
 * The previous fixture used 10 MB / 1000 / 100 MB, which matches NO plan the
 * platform has ever had — so every client-side size check was calibrated
 * against a threshold no user could reach. (standard: 50 MB / 1000 / 200 MB.)
 */
export const FREE_PLAN_LIMITS: PlatformLimits = {
  maxFileSize: 20 * 1024 * 1024, // 20 MB
  maxFilesCount: 500,
  maxTotalSize: 50 * 1024 * 1024, // 50 MB
};

// =============================================================================
// FIXED TIMESTAMPS
// =============================================================================

export const timestamps = {
  /** 2022-01-01T00:00:00Z */
  jan2022: 1640995200,
  /** 2023-01-01T00:00:00Z */
  jan2023: 1672531200,
  /** 2024-01-01T00:00:00Z */
  jan2024: 1704067200,
} as const;

// =============================================================================
// IDENTIFIER SHAPES
// =============================================================================

/**
 * `isDeployment` in `@shipstatic/types` requires `word-word-alnum7`. Anything
 * else is an impossible input — `PUT /domains/:d` rejects it at the schema.
 */
export const deploymentId = (slug = 'brave-otter-a1b2c3d') => `${slug}.${PLATFORM_DOMAIN}`;

/**
 * The two prefixed credential populations, built from their own shape
 * constants. The widths are READ, never written: this file exists because
 * fixtures that fail the platform's real validators calibrate tests against
 * inputs no user can send, and a hand-typed length is the version of that
 * mistake which only appears the day the shape moves. wire: types API_KEY
 */
export const apiKey = (fill = 'a') => `${API_KEY.PREFIX}${fill.repeat(API_KEY.HEX_LENGTH)}`;

/** wire: types DEPLOY_TOKEN — same width as `apiKey` by the shape law. */
export const deployToken = (fill = 'b') =>
  `${DEPLOY_TOKEN.PREFIX}${fill.repeat(DEPLOY_TOKEN.HEX_LENGTH)}`;

/**
 * Claim URL, on the `my.` host. The code is unprefixed by the shape law — it
 * arrives at its own route, so the path is what names it — and shares the
 * platform's one entropy width. wire: deployment-orchestrator.ts
 */
export const claimUrl = (code = `claim-${'c'.repeat(API_KEY.HEX_LENGTH)}`) =>
  `https://my.${PLATFORM_DOMAIN}/claims/${code}`;

/** A platform domain label must be at least 6 chars. wire: createDomainCreateSchema */
export const platformDomain = (label = 'staging-site') => `${label}.${PLATFORM_DOMAIN}`;

/** Suffix match, exactly like `isCustomDomain` — NOT `name.includes('.')`. */
export const isCustomDomain = (domain: string) => !domain.endsWith(`.${PLATFORM_DOMAIN}`);

// =============================================================================
// BUILDERS
// =============================================================================

export function makeDeployment(overrides: Partial<Deployment> = {}): Deployment {
  const deployment = overrides.deployment ?? deploymentId();
  const slug = deployment.split('.')[0];
  return {
    deployment,
    url: `https://${deployment}`,
    files: 5,
    size: 1024000,
    status: 'success',
    config: false,
    password: false,
    labels: [],
    via: null,
    created: timestamps.jan2022,
    expires: null,
    screenshot: `https://screenshots.${PLATFORM_DOMAIN}/${slug}/0123456789abcdef`,
    ...overrides,
  } satisfies Deployment;
}

/**
 * An anonymous deploy: public-account owned, hence expiring and claimable.
 * wire: deployment-orchestrator.ts (isPublicDeploy → claim + PUBLIC_TTL).
 */
export function makePublicDeployment(
  overrides: Partial<DeploymentCreateResponse> = {},
): DeploymentCreateResponse {
  const created = overrides.created ?? timestamps.jan2022;
  return {
    ...makeDeployment({ created, expires: created + PUBLIC_TTL_SECONDS }),
    claim: claimUrl(),
    ...overrides,
  } satisfies DeploymentCreateResponse;
}

export function makeDomain(domain: string, overrides: Partial<Domain> = {}): Domain {
  return {
    domain,
    url: `https://${domain}`,
    deployment: null,
    // Custom domains wait on DNS verification; platform domains are live at once.
    status: isCustomDomain(domain) ? 'pending' : 'success',
    labels: [],
    created: timestamps.jan2022,
    linked: null,
    links: 0,
    ...overrides,
  } satisfies Domain;
}

export function makeToken(overrides: Partial<Token> = {}): Token {
  return {
    token: 'a1b2c3d',
    labels: [],
    created: timestamps.jan2022,
    expires: null,
    used: null,
    ...overrides,
  } satisfies Token;
}

/**
 * The 201 from `POST /tokens`: the entity plus the one field only a creation
 * can state. Built by spreading {@link makeToken} rather than restating its
 * fields, mirroring `TokenCreateResponse extends Token` — so a field added to
 * the entity reaches this fixture for free.
 */
export function makeTokenCreateResponse(
  overrides: Partial<TokenCreateResponse> = {},
): TokenCreateResponse {
  return {
    ...makeToken(),
    secret: deployToken(),
    ...overrides,
  } satisfies TokenCreateResponse;
}

export function makeAccount(overrides: Partial<AccountGetResponse> = {}): AccountGetResponse {
  return {
    email: 'test@example.com',
    name: 'Test User',
    picture: 'https://example.com/avatar.jpg',
    plan: 'free',
    usage: { customDomains: 0 },
    created: timestamps.jan2022,
    activated: null,
    hint: null,
    // Always emitted by GET /account, possibly null. wire: routes/account.ts:61
    used: null,
    grace: null,
    authMethod: 'apiKey',
    ...overrides,
  } satisfies AccountGetResponse;
}

/** The plain `Account` shape, for consumers that do not see `authMethod`. */
export function makeAccountRow(overrides: Partial<Account> = {}): Account {
  const { authMethod: _a, isAdmin: _i, impersonatedBy: _p, ...account } = makeAccount();
  return { ...account, ...overrides } satisfies Account;
}

/** wire: shared/dns.ts `domainRecords(domain, A_RECORD_IP, getCnameTarget(DOMAIN))` */
export function makeDnsRecords(): Array<{ type: 'A' | 'CNAME'; name: string; value: string }> {
  return [
    // A first, CNAME second — the A record is the apex redirect, the CNAME is
    // the hosted endpoint (root CLAUDE.md "Custom Domain Model").
    { type: 'A', name: '@', value: A_RECORD_IP },
    { type: 'CNAME', name: 'www', value: CNAME_TARGET },
  ];
}
