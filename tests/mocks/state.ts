/**
 * @file Per-instance mock state.
 *
 * A factory, not a module-level singleton. The previous mock kept `let
 * mockDeployments` at module scope behind a header comment claiming reference
 * counting that did not exist — and because `EADDRINUSE` resolved as success,
 * a second vitest run silently talked to another process's state and its
 * resets became no-ops.
 *
 * Timestamps come from `state.now`, a fixed instant, so nothing that reaches
 * an assertion depends on the wall clock.
 */

import type {
  Deployment,
  DeploymentCreateResponse,
  Domain,
  DomainValidateResponse,
  PlatformLimits,
  Token,
  TokenCreateResponse,
} from '@shipstatic/types';
import {
  claimUrl,
  deploymentId,
  deployToken,
  FREE_PLAN_LIMITS,
  isCustomDomain,
  makeDeployment,
  makeDomain,
  makeToken,
  PLATFORM_DOMAIN,
  PUBLIC_TTL_SECONDS,
  platformDomain,
  timestamps,
} from '../fixtures/builders';

export interface MockState {
  /** Fixed "current" instant, in unix seconds. */
  readonly now: number;
  limits: PlatformLimits;
  account: ReturnType<typeof import('../fixtures/builders').makeAccount>;
  deployments: Deployment[];
  domains: Domain[];
  tokens: Token[];
  verifyCooldown: Set<string>;
  /**
   * The `Idempotency-Key` each deployment was born with, by deployment.
   *
   * wire: `api/src/middleware/idempotency.ts`: the key is a column on the
   * deployment row, and a later declaration with the same key replays the
   * earliest LIVE deployment carrying it, as it stands. One mock serves one
   * account, so the account half of the lookup is the whole state; an
   * anonymous deploy stores no key, as the public account stores none.
   */
  idempotency: Map<string, string>;
  /**
   * The declaration of each deployment sent in several requests, while it is
   * pending: every path the manifest declares, and the paths that have
   * arrived. wire: `api/src/lib/declaration.ts`, where R2 holds it, and the
   * fill's completion listing (`listServedPaths`).
   */
  declarations: Map<string, { declared: Set<string>; arrived: Set<string>; ttl?: number }>;
  /**
   * What the single-page classifier answers when a declaration asks (`spa`).
   * Set by the test that needs a yes; the double decides nothing (see the
   * `/deployments` arm in `handler.ts`).
   */
  spa: boolean;
  findDeployment(idOrHostname: string): Deployment | undefined;
  createDeployment(
    anonymous: boolean,
    fields?: {
      labels?: string[];
      via?: string;
      password?: boolean;
      ttl?: number;
      config?: boolean;
      /** Born pending: the request does not complete the deployment. */
      pending?: boolean;
    },
  ): DeploymentCreateResponse;
  /** The commit: the deployment goes live, its lifetime measured from now. */
  commitDeployment(deployment: Deployment, ttl?: number): Deployment;
  createToken(body: { ttl?: number; labels?: string[] }): TokenCreateResponse;
  validateDomain(input: string): DomainValidateResponse;
}

export function createMockState(
  makeAccount: typeof import('../fixtures/builders').makeAccount,
): MockState {
  const now = timestamps.jan2024;
  let deploymentCounter = 0;
  let tokenCounter = 0;

  const state: MockState = {
    now,
    limits: { ...FREE_PLAN_LIMITS },
    account: makeAccount(),
    deployments: [makeDeployment()],
    domains: [makeDomain(platformDomain(), { deployment: deploymentId(), links: 1, linked: now })],
    tokens: [],
    verifyCooldown: new Set(),
    idempotency: new Map(),
    declarations: new Map(),
    spa: false,

    /** The API accepts a bare slug or the full hostname. wire: normalizeDeployment */
    findDeployment(idOrHostname) {
      const slug = idOrHostname.split('.')[0];
      return state.deployments.find((d) => d.deployment.split('.')[0] === slug);
    },

    createDeployment(anonymous, fields = {}) {
      deploymentCounter += 1;
      // Deterministic and shaped like the real thing: `word-word-alnum7`.
      const slug = `mock-deploy-${String(deploymentCounter).padStart(3, '0')}`;
      const deployment = makeDeployment({
        deployment: `${slug}.${PLATFORM_DOMAIN}`,
        created: now,
        // The real orchestrator persists the form's labels/via/password and
        // echoes them on the response. wire: lib/deployment-orchestrator.ts
        labels: fields.labels ?? [],
        via: fields.via ?? null,
        password: fields.password ?? false,
        // Derived from the uploaded files by the route, like the API's own.
        config: fields.config ?? false,
        // A pending deployment has no lifetime yet: the commit stamps it.
        // A requested lifetime wins over the entitlement's answer, stamped
        // against the server's own clock — the wire carries the duration and
        // the API owns the instant. Absent, the identity decides: anonymous
        // deploys land under the public account (expiring, claimable),
        // authenticated ones never expire.
        // wire: lib/deployment-orchestrator.ts, `commit`
        ...(fields.pending
          ? { status: 'pending' as const, expires: null }
          : {
              expires:
                fields.ttl !== undefined
                  ? now + fields.ttl
                  : anonymous
                    ? now + PUBLIC_TTL_SECONDS
                    : null,
            }),
      });
      state.deployments.push(deployment);
      return anonymous ? { ...deployment, claim: claimUrl() } : deployment;
    },

    commitDeployment(deployment, ttl) {
      deployment.status = 'success';
      deployment.expires = ttl !== undefined ? now + ttl : null;
      return deployment;
    },

    createToken({ ttl, labels }) {
      tokenCounter += 1;
      const id = `tok${String(tokenCounter).padStart(4, '0')}`;
      const expires = ttl ? now + ttl : null;
      // The 201 answers with the row it just stored plus the secret shown
      // once — so what a caller creates and what it later lists are the same
      // object here, exactly as `TokenCreateResponse extends Token` promises.
      const token = makeToken({ token: id, labels: labels ?? [], created: now, expires });
      state.tokens.push(token);
      return { ...token, secret: deployToken(String(tokenCounter % 10)) };
    },

    /** wire: lib/domains/validate.ts — apex inputs are auto-fixed to `www.` */
    validateDomain(input) {
      const domain = input.toLowerCase();
      if (!/^[a-z0-9.-]+$/.test(domain) || !domain.includes('.')) {
        return {
          valid: false,
          normalized: null,
          available: null,
          reason: 'That is not a valid domain name.',
        };
      }
      // Apex → `www.` (CNAME routing requires a subdomain). The CLI's auto-fix
      // flow reads `normalized`, so this is load-bearing, not cosmetic.
      const labels = domain.split('.');
      const normalized = isCustomDomain(domain) && labels.length === 2 ? `www.${domain}` : domain;
      // wire: one owner lookup, and the KIND of name decides nothing; a
      // registered name carries the platform's reason.
      //
      // This world has one account, so a registered name is always the
      // caller's own: the other-account sentence
      // ('Domain is already registered to another account') has no fixture
      // here, and the API's own suite is where that arm is covered.
      const registered = state.domains.some((d) => d.domain === normalized);
      return {
        valid: true,
        normalized,
        available: !registered,
        reason: registered ? 'This domain is already in your account' : null,
      };
    },
  };

  return state;
}
