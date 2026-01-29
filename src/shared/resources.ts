/**
 * Ship SDK resource factory functions.
 */
import {
  ShipError,
  type StaticFile,
  type DeployInput,
  type DeploymentResource,
  type DomainResource,
  type AccountResource,
  type TokenResource
} from '@shipstatic/types';

export type {
  StaticFile,
  DeployInput,
  DeploymentResource,
  DomainResource,
  AccountResource,
  TokenResource
};
import type { ApiHttp } from './api/http.js';
import type { ShipClientOptions, DeploymentOptions } from './types.js';
import { mergeDeployOptions } from './core/config.js';
import { detectAndConfigureSPA } from './lib/spa.js';

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
  clientDefaults?: ShipClientOptions;
  hasAuth?: () => boolean;
}

/**
 * Create deployment resource with all CRUD operations.
 */
export function createDeploymentResource(ctx: DeploymentResourceContext): DeploymentResource {
  const { getApi, ensureInit, processInput, clientDefaults, hasAuth } = ctx;

  return {
    create: async (input: DeployInput, options: DeploymentOptions = {}) => {
      await ensureInit();

      const mergedOptions = clientDefaults
        ? mergeDeployOptions(options, clientDefaults)
        : options;

      if (hasAuth && !hasAuth() && !mergedOptions.deployToken && !mergedOptions.apiKey) {
        throw ShipError.authentication(
          'Authentication credentials are required for deployment. ' +
          'Please call setDeployToken() or setApiKey() first, or pass credentials in the deployment options.'
        );
      }

      if (!processInput) {
        throw ShipError.config('processInput function is not provided.');
      }

      const apiClient = getApi();
      let staticFiles = await processInput(input, mergedOptions);
      staticFiles = await detectAndConfigureSPA(staticFiles, apiClient, mergedOptions);

      return apiClient.deploy(staticFiles, mergedOptions);
    },

    list: async () => {
      await ensureInit();
      return getApi().listDeployments();
    },

    get: async (id: string) => {
      await ensureInit();
      return getApi().getDeployment(id);
    },

    set: async (id: string, options: { tags: string[] }) => {
      await ensureInit();
      return getApi().updateDeploymentTags(id, options.tags);
    },

    remove: async (id: string) => {
      await ensureInit();
      await getApi().removeDeployment(id);
    }
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
    set: async (name: string, options: { deployment?: string; tags?: string[] } = {}) => {
      await ensureInit();
      const { deployment, tags } = options;

      // Smart routing: tags-only → PATCH; otherwise → PUT (create/link/reserve)
      if (deployment === undefined && tags && tags.length > 0) {
        return getApi().updateDomainTags(name, tags);
      }
      return getApi().setDomain(name, deployment, tags);
    },

    list: async () => {
      await ensureInit();
      return getApi().listDomains();
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
    }
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
    }
  };
}

/**
 * Create token resource for managing deploy tokens.
 */
export function createTokenResource(ctx: ResourceContext): TokenResource {
  const { getApi, ensureInit } = ctx;

  return {
    create: async (options: { ttl?: number; tags?: string[] } = {}) => {
      await ensureInit();
      return getApi().createToken(options.ttl, options.tags);
    },

    list: async () => {
      await ensureInit();
      return getApi().listTokens();
    },

    remove: async (token: string) => {
      await ensureInit();
      await getApi().removeToken(token);
    }
  };
}
