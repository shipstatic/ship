/**
 * @file Ship SDK resource implementations for deployments, domains, and accounts.
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



export function createDeploymentResource(
  getApi: () => ApiHttp,
  clientDefaults?: ShipClientOptions,
  ensureInit?: () => Promise<void>,
  processInput?: (input: DeployInput, options: DeploymentOptions) => Promise<StaticFile[]>,
  hasAuth?: () => boolean
): DeploymentResource {
  return {
    create: async (input: DeployInput, options: DeploymentOptions = {}) => {
      // Ensure full initialization before proceeding (loads config from env/files)
      if (ensureInit) await ensureInit();

      // Merge user options with client defaults
      const mergedOptions = clientDefaults
        ? mergeDeployOptions(options, clientDefaults)
        : options;

      // Auth check AFTER init so env vars and config files are loaded
      // Check: instance auth OR per-deploy credentials in merged options
      if (hasAuth && !hasAuth() && !mergedOptions.deployToken && !mergedOptions.apiKey) {
        throw ShipError.authentication(
          'Authentication credentials are required for deployment. ' +
          'Please call setDeployToken() or setApiKey() first, or pass credentials in the deployment options.'
        );
      }

      // Get API client AFTER initialization is complete to avoid race conditions
      const apiClient = getApi();

      // Use environment-specific input processing
      if (!processInput) {
        throw ShipError.config('processInput function is not provided.');
      }

      // 1. Process input from the specific environment
      let staticFiles: StaticFile[] = await processInput(input, mergedOptions);

      // 2. 🆕 Apply SPA detection universally here (works for both Node.js and Browser!)
      staticFiles = await detectAndConfigureSPA(staticFiles, apiClient, mergedOptions);

      // 3. Deploy using the API - now returns the full Deployment object directly
      return await apiClient.deploy(staticFiles, mergedOptions);
    },

    list: async () => {
      if (ensureInit) await ensureInit();
      return getApi().listDeployments();
    },

    remove: async (id: string) => {
      if (ensureInit) await ensureInit();
      await getApi().removeDeployment(id);
      // Return void for deletion operations
    },

    get: async (id: string) => {
      if (ensureInit) await ensureInit();
      return getApi().getDeployment(id);
    }
  };
}

// =============================================================================
// DOMAIN RESOURCE
// =============================================================================

export function createDomainResource(getApi: () => ApiHttp, ensureInit?: () => Promise<void>): DomainResource {
  return {
    set: async (domainName: string, deployment?: string, tags?: string[]) => {
      if (ensureInit) await ensureInit();
      return getApi().setDomain(domainName, deployment, tags);
    },

    get: async (domainName: string) => {
      if (ensureInit) await ensureInit();
      return getApi().getDomain(domainName);
    },

    list: async () => {
      if (ensureInit) await ensureInit();
      return getApi().listDomains();
    },

    remove: async (domainName: string) => {
      if (ensureInit) await ensureInit();
      await getApi().removeDomain(domainName);
    },

    verify: async (domainName: string) => {
      if (ensureInit) await ensureInit();
      return getApi().verifyDomain(domainName);
    },

    dns: async (domainName: string) => {
      if (ensureInit) await ensureInit();
      return getApi().getDomainDns(domainName);
    },

    records: async (domainName: string) => {
      if (ensureInit) await ensureInit();
      return getApi().getDomainRecords(domainName);
    },

    share: async (domainName: string) => {
      if (ensureInit) await ensureInit();
      return getApi().getDomainShare(domainName);
    }
  };
}

// =============================================================================
// ACCOUNT RESOURCE
// =============================================================================

export function createAccountResource(getApi: () => ApiHttp, ensureInit?: () => Promise<void>): AccountResource {
  return {
    get: async () => {
      if (ensureInit) await ensureInit();
      return getApi().getAccount();
    }
  };
}

// =============================================================================
// TOKEN RESOURCE
// =============================================================================

export function createTokenResource(getApi: () => ApiHttp, ensureInit?: () => Promise<void>): TokenResource {
  return {
    create: async (ttl?: number, tags?: string[]) => {
      if (ensureInit) await ensureInit();
      return getApi().createToken(ttl, tags);
    },

    list: async () => {
      if (ensureInit) await ensureInit();
      return getApi().listTokens();
    },

    remove: async (token: string) => {
      if (ensureInit) await ensureInit();
      await getApi().removeToken(token);
    }
  };
}
