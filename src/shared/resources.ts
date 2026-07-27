/**
 * Ship SDK resource factory functions.
 */
import {
  type AccountResource,
  type DeployInput,
  type DeploymentResource,
  type DomainResource,
  type ListOptions,
  ShipError,
  type StaticFile,
  type TokenResource,
} from '@shipstatic/types';

export type {
  AccountResource,
  DeployInput,
  DeploymentResource,
  DomainResource,
  StaticFile,
  TokenResource,
};

import type { ApiHttp } from './api/http.js';
import { detectAndConfigureSPA } from './lib/spa.js';
import type { DeploymentOptions } from './types.js';

/**
 * Shared context for all resource factories.
 */
export interface ResourceContext {
  getApi: () => ApiHttp;
  ensureInit: () => Promise<void>;
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
  const { getApi, ensureInit, processInput } = ctx;

  return {
    upload: async (input: DeployInput, options: DeploymentOptions = {}) => {
      await ensureInit();

      if (!processInput) {
        throw ShipError.config('processInput function is not provided.');
      }

      const apiClient = getApi();
      let staticFiles = await processInput(input, options);
      staticFiles = await detectAndConfigureSPA(staticFiles, apiClient, options);

      return apiClient.deploy(staticFiles, options);
    },

    list: async (options?: ListOptions) => {
      await ensureInit();
      return getApi().listDeployments(options);
    },

    get: async (id: string) => {
      await ensureInit();
      return getApi().getDeployment(id);
    },

    set: async (id: string, options: { labels: string[] }) => {
      await ensureInit();
      return getApi().updateDeploymentLabels(id, options.labels);
    },

    remove: async (id: string) => {
      await ensureInit();
      await getApi().removeDeployment(id);
    },
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
  const { getApi, ensureInit } = ctx;

  return {
    // INTENTIONAL DESIGN: The API does NOT support unlinking domains (setting deployment to null).
    // Once a domain is linked to a deployment, it must always have a deployment.
    // Supported: reserve (omit deployment), link, switch deployments atomically, delete entirely.
    // Not supported: unlink after linking (creates ambiguous state with no clear use case).
    // See npm/ship/CLAUDE.md "Domain Write Semantics" for full rationale.
    set: async (name: string, options: { deployment?: string; labels?: string[] } = {}) => {
      await ensureInit();
      return getApi().setDomain(name, options.deployment, options.labels);
    },

    list: async (options?: ListOptions) => {
      await ensureInit();
      return getApi().listDomains(options);
    },

    get: async (name: string) => {
      await ensureInit();
      return getApi().getDomain(name);
    },

    remove: async (name: string) => {
      await ensureInit();
      await getApi().removeDomain(name);
    },

    verify: async (name: string) => {
      await ensureInit();
      return getApi().verifyDomain(name);
    },

    validate: async (name: string) => {
      await ensureInit();
      return getApi().validateDomain(name);
    },

    dns: async (name: string) => {
      await ensureInit();
      return getApi().getDomainDns(name);
    },

    records: async (name: string) => {
      await ensureInit();
      return getApi().getDomainRecords(name);
    },

    share: async (name: string) => {
      await ensureInit();
      return getApi().getDomainShare(name);
    },
  };
}

/**
 * Create account resource (whoami functionality).
 */
export function createAccountResource(ctx: ResourceContext): AccountResource {
  const { getApi, ensureInit } = ctx;

  return {
    get: async () => {
      await ensureInit();
      return getApi().getAccount();
    },
  };
}

/**
 * Create token resource for managing deploy tokens.
 */
export function createTokenResource(ctx: ResourceContext): TokenResource {
  const { getApi, ensureInit } = ctx;

  return {
    create: async (options: { ttl?: number; labels?: string[] } = {}) => {
      await ensureInit();
      return getApi().createToken(options.ttl, options.labels);
    },

    list: async () => {
      await ensureInit();
      return getApi().listTokens();
    },

    remove: async (token: string) => {
      await ensureInit();
      await getApi().removeToken(token);
    },
  };
}
