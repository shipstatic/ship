/**
 * @file The SDK's vocabulary: every request it can make, stated once.
 *
 * A resource method IS its endpoint: the path, the verb, the body and the
 * response type. It hands that to the transport (`api/http.ts`), which knows
 * how to carry a request and nothing about what one means. The SDK mirrors
 * the wire one method per endpoint by design, so there is no layer between
 * the two that could restate either.
 *
 * The `*Resource` interfaces come from `@shipstatic/types`. They are the
 * published contract; this file is how it is met.
 */

import type {
  Account,
  AccountResource,
  DeployInput,
  Deployment,
  DeploymentCreateResponse,
  DeploymentDeleteResponse,
  DeploymentListResponse,
  DeploymentResource,
  Domain,
  DomainDeleteResponse,
  DomainDnsResponse,
  DomainListResponse,
  DomainRecordsResponse,
  DomainResource,
  DomainShareResponse,
  DomainValidateResponse,
  DomainVerifyResponse,
  ListOptions,
  StaticFile,
  Token,
  TokenCreateResponse,
  TokenDeleteResponse,
  TokenListResponse,
  TokenResource,
} from '@shipstatic/types';
import {
  API_PATHS,
  DeploymentVia,
  IDEMPOTENCY_KEY_CONSTRAINTS,
  ShipError,
  validateBuildCommand,
  validateIdempotencyKey,
  validateLabels,
  validateOutputDir,
  validatePassword,
  validateTtl,
} from '@shipstatic/types';
import type { Transport } from './api/http.js';
import {
  createDeployBody,
  createFillBody,
  deployFields,
  deployManifest,
} from './core/deploy-body.js';
import { planDeploy } from './core/deploy-plan.js';
import type { DeploymentOptions } from './types.js';

/** JSON in, JSON out: the header every body-carrying request here sends. */
const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/**
 * Serialize pagination options into a query string, or '' when there are
 * none. The paginated list endpoints accept `limit` and `cursor`.
 */
function listQuery(options?: ListOptions): string {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) params.set('limit', String(options.limit));
  if (options?.cursor !== undefined) params.set('cursor', options.cursor);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * A deploy's files, ready to send. `Ship` composes it (find the files, read
 * the limits, judge and hash), because finding is the one step a build can
 * add to.
 */
export type PrepareFiles = (
  input: DeployInput,
  options: DeploymentOptions,
) => Promise<StaticFile[]>;

/**
 * Upload deployment resource with all CRUD operations.
 *
 * There is no client-side auth branching: an upload from a credential-less
 * client simply carries no `Authorization` header, and the API grants the
 * public-account agent identity per request (claim URL + expiry on the
 * response). The SDK stays a transparent pipe either way.
 */
export function createDeploymentResource(
  http: Transport,
  prepareFiles: PrepareFiles,
): DeploymentResource<DeploymentOptions> {
  return {
    /**
     * The whole deploy, in the order it happens: check the options, collect
     * the files, plan the requests, send them.
     *
     * A deploy is declared, then filled. The manifest always rides the
     * declaration: below the request ceiling the declaration carries every
     * file and answers 201, the whole deploy; above it the declaration is bare
     * (the manifest, the options, the root `ship.json` and the root
     * `index.html`), answers 202, and each batch of files follows to
     * `POST /deployments/:deployment/files`. The first 201 or 200 is the
     * deployment. Splitting is internal: the signature and the answer are the
     * same either way.
     *
     * The platform asks the single-page question of the files and writes the
     * routing config itself when the deploy asks it to: every deploy asks
     * (`spa=true`) unless `spaDetect` is `false`, which sends nothing.
     */
    upload: async (input, options = {}) => {
      // The options first: each check reads nothing but its option, so a
      // value the platform would refuse costs no request and opens no file.
      const idempotencyKey = validateIdempotencyKey(options.idempotencyKey);
      const declaration = {
        labels: validateLabels(options.labels),
        // Every surface that deploys names itself, and a direct SDK call is
        // the SDK: applied at this one boundary, so a deploy through this
        // client is never unattributed.
        via: options.via ?? DeploymentVia.SDK,
        password: validatePassword(options.password),
        ttl: validateTtl(options.ttl),
        spa: options.spaDetect !== false,
        build: options.build,
        prerender: options.prerender,
        buildCommand: validateBuildCommand(options.buildCommand),
        outputDir: validateOutputDir(options.outputDir),
        captcha: options.captcha,
      };

      const files = await prepareFiles(input, options);
      const fields = deployFields(deployManifest(files), declaration);
      const plan = planDeploy(files, fields);

      // No `Content-Type` is set: `fetch` derives it from the `FormData` body
      // along with the boundary, and one set by hand would name a boundary
      // the body does not use.
      //
      // The declaration creates a deployment, so it is sent once. Its
      // idempotency key is the caller's, for a deploy they send again: it
      // rides the header, readable before the body is parsed, and the API
      // answers it with the live deployment that key made in their account.
      // Whether a repeat would be answered or made again is the API's to
      // know, never this client's. Every fill is safe to repeat by
      // construction.
      const signal = options.signal || null;
      const declared = await http.requestWithStatus<DeploymentCreateResponse>(
        http.deploy.endpoint,
        {
          method: 'POST',
          body: createDeployBody(plan.declaration, fields),
          ...(idempotencyKey
            ? { headers: { [IDEMPOTENCY_KEY_CONSTRAINTS.HEADER]: idempotencyKey } }
            : {}),
          signal,
        },
        'Deploy',
        // A build waits on the build service after the upload lands, so it
        // has the longer ceiling. The transport owns both numbers; this is
        // the one place that knows which applies.
        declaration.build || declaration.prerender ? http.deploy.buildTimeout : http.deploy.timeout,
      );
      if (declared.status !== 202) return declared.data;

      const fillPath = API_PATHS.DEPLOYMENT_FILES(encodeURIComponent(declared.data.deployment));
      for (const batch of plan.fills) {
        const filled = await http.requestWithStatus<DeploymentCreateResponse>(
          fillPath,
          { method: 'POST', body: createFillBody(batch), signal, idempotent: true },
          'Deploy',
          http.deploy.timeout,
        );
        if (filled.status !== 202) return filled.data;
      }
      throw ShipError.api('Every file was sent, but the deployment did not go live. Deploy again.');
    },

    list: async (options?: ListOptions) =>
      http.request<DeploymentListResponse>(
        `${API_PATHS.DEPLOYMENTS}${listQuery(options)}`,
        { method: 'GET' },
        'List deployments',
      ),

    get: async (id: string) =>
      http.request<Deployment>(
        API_PATHS.DEPLOYMENT(encodeURIComponent(id)),
        { method: 'GET' },
        'Get deployment',
      ),

    set: async (id, options) =>
      http.request<Deployment>(
        API_PATHS.DEPLOYMENT(encodeURIComponent(id)),
        {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ labels: validateLabels(options.labels) }),
        },
        'Update deployment labels',
      ),

    delete: async (id: string) =>
      http.request<DeploymentDeleteResponse>(
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
export function createDomainResource(http: Transport): DomainResource {
  return {
    // INTENTIONAL DESIGN: The API does NOT support unlinking domains (setting deployment to null).
    // Once a domain is linked to a deployment, it must always have a deployment.
    // Supported: reserve (omit deployment), link, switch deployments atomically, delete entirely.
    // Not supported: unlink after linking (creates ambiguous state with no clear use case).
    // See npm/ship/CLAUDE.md "Domain Write Semantics" for full rationale.
    set: async (name, options = {}) => {
      // What the caller left out is left out of the body, and what they gave
      // is sent as given: an empty deployment is the API's to refuse, never
      // a reservation they did not ask for.
      const body = { deployment: options.deployment, labels: validateLabels(options.labels) };

      // The one operation whose STATUS is part of its answer: 201 means the
      // domain was created, 200 that it was repointed, and the body says the
      // same thing either way.
      const { data, status } = await http.requestWithStatus<Domain>(
        API_PATHS.DOMAIN(encodeURIComponent(name)),
        { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) },
        'Set domain',
      );
      return { ...data, isCreate: status === 201 };
    },

    list: async (options?: ListOptions) =>
      http.request<DomainListResponse>(
        `${API_PATHS.DOMAINS}${listQuery(options)}`,
        { method: 'GET' },
        'List domains',
      ),

    get: async (name: string) =>
      http.request<Domain>(
        API_PATHS.DOMAIN(encodeURIComponent(name)),
        { method: 'GET' },
        'Get domain',
      ),

    delete: async (name: string) =>
      http.request<DomainDeleteResponse>(
        API_PATHS.DOMAIN(encodeURIComponent(name)),
        { method: 'DELETE' },
        'Delete domain',
      ),

    verify: async (name: string) =>
      http.request<DomainVerifyResponse>(
        API_PATHS.DOMAIN_VERIFY(encodeURIComponent(name)),
        { method: 'POST' },
        'Verify domain',
      ),

    // The name rides the JSON BODY, not the path: this is a pre-flight check on
    // a string that may not be a legal path segment yet.
    validate: async (name: string) =>
      http.request<DomainValidateResponse>(
        API_PATHS.DOMAINS_VALIDATE,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ domain: name }) },
        'Validate domain',
      ),

    dns: async (name: string) =>
      http.request<DomainDnsResponse>(
        API_PATHS.DOMAIN_DNS(encodeURIComponent(name)),
        { method: 'GET' },
        'Get domain DNS',
      ),

    records: async (name: string) =>
      http.request<DomainRecordsResponse>(
        API_PATHS.DOMAIN_RECORDS(encodeURIComponent(name)),
        { method: 'GET' },
        'Get domain records',
      ),

    share: async (name: string) =>
      http.request<DomainShareResponse>(
        API_PATHS.DOMAIN_SHARE(encodeURIComponent(name)),
        { method: 'GET' },
        'Get domain share',
      ),
  };
}

/**
 * Create account resource (whoami functionality).
 */
export function createAccountResource(http: Transport): AccountResource {
  return {
    get: async () => http.request<Account>(API_PATHS.ACCOUNT, { method: 'GET' }, 'Get account'),
  };
}

/**
 * Create token resource for managing deploy tokens.
 */
export function createTokenResource(http: Transport): TokenResource {
  return {
    create: async (options = {}) => {
      // Checked before the request, as a deploy's options are: the rules are
      // `@shipstatic/types`' own, so a bad value costs no round trip.
      const body = { ttl: validateTtl(options.ttl), labels: validateLabels(options.labels) };

      return http.request<TokenCreateResponse>(
        API_PATHS.TOKENS,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
        'Create token',
      );
    },

    list: async (options?: ListOptions) =>
      http.request<TokenListResponse>(
        `${API_PATHS.TOKENS}${listQuery(options)}`,
        { method: 'GET' },
        'List tokens',
      ),

    get: async (token: string) =>
      http.request<Token>(
        API_PATHS.TOKEN(encodeURIComponent(token)),
        { method: 'GET' },
        'Get token',
      ),

    delete: async (token: string) =>
      http.request<TokenDeleteResponse>(
        API_PATHS.TOKEN(encodeURIComponent(token)),
        { method: 'DELETE' },
        'Delete token',
      ),
  };
}
