/**
 * @file The SDK's vocabulary — every request it can make, stated once.
 *
 * A resource method IS its endpoint: the path, the verb, the body, the
 * response type. It hands that to the transport, which knows how to carry a
 * request and nothing about what one means.
 *
 * **These were two layers until 2026-08-12.** `ApiHttp` carried eighteen
 * endpoint methods and every factory below wrapped one of them 1:1 —
 * `get: async (name) => getApi().getDomain(name)` — because this SDK mirrors
 * the wire one method per endpoint BY DESIGN (see CLAUDE.md, "Recorded
 * absences"). That design is exactly what made the second layer a restatement
 * rather than an adapter: the two could not diverge without one of them being
 * wrong. Folding DOWN rather than up is what keeps the public grouping and the
 * transport separate, which was the whole point of having two files.
 *
 * The `*Resource` interfaces come from `@shipstatic/types` and did not move.
 * They are the published contract; this file is how it is met.
 */

import type { AccountResource, DeployInput, StaticFile } from '@shipstatic/types';
import {
  type AccountGetResponse,
  API_PATHS,
  type Deployment,
  type DeploymentCreateResponse,
  type DeploymentDeleteResponse,
  type DeploymentListResponse,
  type DeploymentResource,
  type Domain,
  type DomainDeleteResponse,
  type DomainDnsResponse,
  type DomainListResponse,
  type DomainRecordsResponse,
  type DomainResource,
  type DomainShareResponse,
  type DomainValidateResponse,
  type DomainVerifyResponse,
  IDEMPOTENCY_KEY_CONSTRAINTS,
  type ListOptions,
  ShipError,
  type Token,
  type TokenCreateResponse,
  type TokenDeleteResponse,
  type TokenListResponse,
  type TokenResource,
  validateIdempotencyKey,
  validateTtl,
} from '@shipstatic/types';

export type {
  AccountResource,
  DeployInput,
  DeploymentResource,
  DomainResource,
  StaticFile,
  TokenResource,
};

import type { Transport } from './api/http.js';
import { createDeployBody } from './core/deploy-body.js';
import { detectAndConfigureSPA } from './lib/spa.js';
import { validateDeployConfig, validateLabels, validatePassword } from './lib/validation.js';
import type { DeploymentOptions } from './types.js';

/** JSON in, JSON out — the header every body-carrying request here sends. */
const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/**
 * This client's identity in a deployment's `via` field.
 *
 * Every surface that deploys names itself: the CLI sends `cli`, the GitHub
 * Action `git`, the MCP server `mcp`, the VS Code extension `vsc`, the web
 * apps `web`. A direct SDK call is `sdk`.
 *
 * Applied at this one boundary, so `via` is populated on every deploy from
 * every platform: a deploy through this SDK is never unattributed.
 */
const DEPLOY_VIA = 'sdk';

/**
 * Serialize pagination options into a query string, or '' when there are
 * none — the paginated list endpoints accept `limit` and `cursor`.
 */
function listQuery(options?: ListOptions): string {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) params.set('limit', String(options.limit));
  if (options?.cursor !== undefined) params.set('cursor', options.cursor);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Shared context for all resource factories.
 *
 * A factory receives the callbacks it needs and nothing else — which is what
 * lets `getApi()` be a THUNK rather than an instance: the transport is built
 * once in the constructor, but reading it lazily is what keeps the resources
 * constructible before it exists and swappable in tests.
 */
export interface ResourceContext {
  getApi: () => Transport;
}

/**
 * Extended context for deployment resource.
 */
export interface DeploymentResourceContext extends ResourceContext {
  processInput: (input: DeployInput, options: DeploymentOptions) => Promise<StaticFile[]>;
}

/**
 * Upload deployment resource with all CRUD operations.
 *
 * There is no client-side auth branching: an upload from a credential-less
 * client simply carries no `Authorization` header, and the API grants the
 * public-account agent identity per request (claim URL + expiry on the
 * response). The SDK stays a transparent pipe either way.
 */
export function createDeploymentResource(
  ctx: DeploymentResourceContext,
): DeploymentResource<DeploymentOptions> {
  const { getApi, processInput } = ctx;

  return {
    /**
     * The whole deploy, in the order it happens: collect the files, ask the
     * platform whether they are a SPA, validate the request boundary, build
     * the multipart body, send it.
     *
     * It read across two files until the endpoint tier folded down — the
     * collection and the SPA step here, the validators and the body in the
     * transport — for no reason a reader could see from either end.
     */
    upload: async (input: DeployInput, options: DeploymentOptions = {}) => {
      if (!processInput) {
        throw ShipError.config('processInput function is not provided.');
      }

      const http = getApi();
      const collected = await processInput(input, options);
      const files = await detectAndConfigureSPA(collected, http, options);

      if (!files.length) {
        throw ShipError.business('No files to deploy');
      }
      for (const file of files) {
        if (!file.md5) {
          throw ShipError.file(`MD5 checksum missing for file: ${file.path}`, {
            filePath: file.path,
          });
        }
      }

      // Fast-fail on definitely-invalid input before constructing a multipart body.
      validatePassword(options.password);
      const ttl = validateTtl(options.ttl);
      const idempotencyKey = validateIdempotencyKey(options.idempotencyKey);
      const labels = validateLabels(options.labels);
      await validateDeployConfig(files);

      const flags =
        options.build || options.prerender || options.spa
          ? { build: options.build, prerender: options.prerender, spa: options.spa }
          : undefined;
      const body = await createDeployBody(files, {
        labels,
        via: options.via ?? DEPLOY_VIA,
        password: options.password,
        ttl,
        flags,
        captcha: options.captcha,
      });

      // NO Content-Type here, deliberately: `fetch` derives it from the
      // `FormData` body along with the boundary, and setting one by hand would
      // name a boundary the body does not use.
      //
      // The idempotency key rides a header, not the body, because it must be
      // readable before the request is parsed — the API replays a stored 201
      // ahead of the write budget, so a retry costs nothing.
      return http.request<DeploymentCreateResponse>(
        http.deploy.endpoint,
        {
          method: 'POST',
          body,
          ...(idempotencyKey
            ? { headers: { [IDEMPOTENCY_KEY_CONSTRAINTS.HEADER]: idempotencyKey } }
            : {}),
          signal: options.signal || null,
        },
        'Deploy',
        // Only `build`/`prerender` reach the build service
        // (`api/src/lib/upload-processing.ts:35`); `spa` is local detection
        // bounded by the AI tier's own 10s, so it does not earn the longer
        // ceiling. The transport owns both budgets; this is the one place that
        // knows which applies.
        options.build || options.prerender ? http.deploy.buildTimeout : http.deploy.timeout,
      );
    },

    list: async (options?: ListOptions) =>
      getApi().request<DeploymentListResponse>(
        `${API_PATHS.DEPLOYMENTS}${listQuery(options)}`,
        { method: 'GET' },
        'List deployments',
      ),

    get: async (id: string) =>
      getApi().request<Deployment>(
        API_PATHS.DEPLOYMENT(encodeURIComponent(id)),
        { method: 'GET' },
        'Get deployment',
      ),

    set: async (id: string, options: { labels: string[] }) =>
      getApi().request<Deployment>(
        API_PATHS.DEPLOYMENT(encodeURIComponent(id)),
        {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ labels: validateLabels(options.labels) }),
        },
        'Update deployment labels',
      ),

    delete: async (id: string) =>
      getApi().request<DeploymentDeleteResponse>(
        API_PATHS.DEPLOYMENT(encodeURIComponent(id)),
        { method: 'DELETE' },
        'Delete deployment',
      ),
  };
}

/**
 * Create domain resource with all CRUD operations.
 *
 * @remarks
 * The `name` parameter in all methods is an FQDN (Fully Qualified Domain Name).
 * The SDK does not validate or normalize domain names - the API handles all domain semantics.
 */
export function createDomainResource(ctx: ResourceContext): DomainResource {
  const { getApi } = ctx;

  return {
    // INTENTIONAL DESIGN: The API does NOT support unlinking domains (setting deployment to null).
    // Once a domain is linked to a deployment, it must always have a deployment.
    // Supported: reserve (omit deployment), link, switch deployments atomically, delete entirely.
    // Not supported: unlink after linking (creates ambiguous state with no clear use case).
    // See npm/ship/CLAUDE.md "Domain Write Semantics" for full rationale.
    set: async (name: string, options: { deployment?: string; labels?: string[] } = {}) => {
      const labels = validateLabels(options.labels);
      const body: { deployment?: string; labels?: string[] } = {};
      if (options.deployment) body.deployment = options.deployment;
      if (labels !== undefined) body.labels = labels;

      // The one operation whose STATUS is part of its answer: 201 means the
      // domain was created, 200 that it was repointed, and the body says the
      // same thing either way.
      const { data, status } = await getApi().requestWithStatus<Domain>(
        API_PATHS.DOMAIN(encodeURIComponent(name)),
        { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) },
        'Set domain',
      );
      return { ...data, isCreate: status === 201 };
    },

    list: async (options?: ListOptions) =>
      getApi().request<DomainListResponse>(
        `${API_PATHS.DOMAINS}${listQuery(options)}`,
        { method: 'GET' },
        'List domains',
      ),

    get: async (name: string) =>
      getApi().request<Domain>(
        API_PATHS.DOMAIN(encodeURIComponent(name)),
        { method: 'GET' },
        'Get domain',
      ),

    delete: async (name: string) =>
      getApi().request<DomainDeleteResponse>(
        API_PATHS.DOMAIN(encodeURIComponent(name)),
        { method: 'DELETE' },
        'Delete domain',
      ),

    verify: async (name: string) =>
      getApi().request<DomainVerifyResponse>(
        API_PATHS.DOMAIN_VERIFY(encodeURIComponent(name)),
        { method: 'POST' },
        'Verify domain',
      ),

    // The name rides the JSON BODY, not the path: this is a pre-flight check on
    // a string that may not be a legal path segment yet.
    validate: async (name: string) =>
      getApi().request<DomainValidateResponse>(
        API_PATHS.DOMAINS_VALIDATE,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ domain: name }) },
        'Validate domain',
      ),

    dns: async (name: string) =>
      getApi().request<DomainDnsResponse>(
        API_PATHS.DOMAIN_DNS(encodeURIComponent(name)),
        { method: 'GET' },
        'Get domain DNS',
      ),

    records: async (name: string) =>
      getApi().request<DomainRecordsResponse>(
        API_PATHS.DOMAIN_RECORDS(encodeURIComponent(name)),
        { method: 'GET' },
        'Get domain records',
      ),

    share: async (name: string) =>
      getApi().request<DomainShareResponse>(
        API_PATHS.DOMAIN_SHARE(encodeURIComponent(name)),
        { method: 'GET' },
        'Get domain share',
      ),
  };
}

/**
 * Create account resource (whoami functionality).
 */
export function createAccountResource(ctx: ResourceContext): AccountResource {
  const { getApi } = ctx;

  return {
    get: async () =>
      getApi().request<AccountGetResponse>(API_PATHS.ACCOUNT, { method: 'GET' }, 'Get account'),
  };
}

/**
 * Create token resource for managing deploy tokens.
 */
export function createTokenResource(ctx: ResourceContext): TokenResource {
  const { getApi } = ctx;

  return {
    create: async (options: { ttl?: number; labels?: string[] } = {}) => {
      // Fast-fail on definitely-invalid input, exactly as the deploy boundary
      // does. This is the half the ttl rule's promotion into `@shipstatic/types`
      // was FOR: the envelope lived only in the API route until 2026-08-12, so
      // this call sent whatever it was handed and a bad duration cost a round
      // trip. Validating here is what makes that claim true rather than a
      // sentence in a doc.
      const ttl = validateTtl(options.ttl);
      const labels = validateLabels(options.labels);
      const body: { ttl?: number; labels?: string[] } = {};
      if (ttl !== undefined) body.ttl = ttl;
      if (labels !== undefined) body.labels = labels;

      return getApi().request<TokenCreateResponse>(
        API_PATHS.TOKENS,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
        'Create token',
      );
    },

    list: async (options?: ListOptions) =>
      getApi().request<TokenListResponse>(
        `${API_PATHS.TOKENS}${listQuery(options)}`,
        { method: 'GET' },
        'List tokens',
      ),

    get: async (token: string) =>
      getApi().request<Token>(
        API_PATHS.TOKEN(encodeURIComponent(token)),
        { method: 'GET' },
        'Get token',
      ),

    delete: async (token: string) =>
      getApi().request<TokenDeleteResponse>(
        API_PATHS.TOKEN(encodeURIComponent(token)),
        { method: 'DELETE' },
        'Delete token',
      ),
  };
}
