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

    remove: async (id: string) => {
      await ensureInit();
      await getApi().removeDeployment(id);
    },

    get: async (id: string) => {
      await ensureInit();
      return getApi().getDeployment(id);
    }
  };
}

export function createDomainResource(ctx: ResourceContext): DomainResource {
  const { getApi, ensureInit } = ctx;

  return {
    set: async (domainName: string, deployment?: string, tags?: string[]) => {
      await ensureInit();
      return getApi().setDomain(domainName, deployment, tags);
    },

    get: async (domainName: string) => {
      await ensureInit();
      return getApi().getDomain(domainName);
    },

    list: async () => {
      await ensureInit();
      return getApi().listDomains();
    },

    remove: async (domainName: string) => {
      await ensureInit();
      await getApi().removeDomain(domainName);
    },

    verify: async (domainName: string) => {
      await ensureInit();
      return getApi().verifyDomain(domainName);
    },

    dns: async (domainName: string) => {
      await ensureInit();
      return getApi().getDomainDns(domainName);
    },

    records: async (domainName: string) => {
      await ensureInit();
      return getApi().getDomainRecords(domainName);
    },

    share: async (domainName: string) => {
      await ensureInit();
      return getApi().getDomainShare(domainName);
    }
  };
}

export function createAccountResource(ctx: ResourceContext): AccountResource {
  const { getApi, ensureInit } = ctx;

  return {
    get: async () => {
      await ensureInit();
      return getApi().getAccount();
    }
  };
}

export function createTokenResource(ctx: ResourceContext): TokenResource {
  const { getApi, ensureInit } = ctx;

  return {
    create: async (ttl?: number, tags?: string[]) => {
      await ensureInit();
      return getApi().createToken(ttl, tags);
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
