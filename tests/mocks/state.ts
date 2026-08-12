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
   * Stored 201s, keyed by `Idempotency-Key`.
   *
   * wire: `api/src/middleware/idempotency.ts` — the real key is
   * `idempotency:{actor}:{sha256(key)}`, and the actor half is collapsed here
   * because one mock serves one caller. What survives is the property a
   * consumer depends on: a repeat of the same key replays the original
   * deployment instead of creating a second one.
   */
  idempotency: Map<string, DeploymentCreateResponse>;
  findDeployment(idOrHostname: string): Deployment | undefined;
  createDeployment(
    anonymous: boolean,
    fields?: {
      labels?: string[];
      via?: string;
      password?: boolean;
      ttl?: number;
      config?: boolean;
    },
  ): DeploymentCreateResponse;
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
        // A requested lifetime wins over the entitlement's answer, stamped
        // against the server's own clock — the wire carries the duration and
        // the API owns the instant. Absent, the identity decides: anonymous
        // deploys land under the public account (expiring, claimable),
        // authenticated ones never expire.
        // wire: lib/deployment-orchestrator.ts:174
        //   `expires = ttl === undefined ? capabilities.ttl : created + ttl`
        expires:
          fields.ttl !== undefined ? now + fields.ttl : anonymous ? now + PUBLIC_TTL_SECONDS : null,
      });
      state.deployments.push(deployment);
      return anonymous ? { ...deployment, claim: claimUrl() } : deployment;
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
      const available = isCustomDomain(normalized)
        ? true // any custom domain you own is addable
        : !state.domains.some((d) => d.domain === normalized);
      return { valid: true, normalized, available, reason: null };
    },
  };

  return state;
}
