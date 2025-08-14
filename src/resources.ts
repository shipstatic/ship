/**
 * @file All Ship SDK resources in one place - impossibly simple.
 */
import type { Deployment, DeploymentListResponse, Alias, AliasListResponse, Account } from '@shipstatic/types';
import type { ApiHttp } from './api/http.js';
import type { StaticFile, ShipClientOptions } from './types.js';
import type { DeploymentOptions, DeployInput } from './types.js';
import { convertDeployInput } from './lib/prepare-input.js';
import { mergeDeployOptions } from './core/config.js';

// Re-export DeployInput for external use
export type { DeployInput };

// =============================================================================
// DEPLOYMENT RESOURCE
// =============================================================================

export interface DeploymentResource {
  create: (input: DeployInput, options?: DeploymentOptions) => Promise<Deployment>;
  list: () => Promise<DeploymentListResponse>;
  remove: (id: string) => Promise<void>;
  get: (id: string) => Promise<Deployment>;
}

export function createDeploymentResource(
  getApi: () => ApiHttp, 
  clientDefaults?: ShipClientOptions,
  ensureInit?: () => Promise<void>
): DeploymentResource {
  return {
    create: async (input: DeployInput, options: DeploymentOptions = {}) => {
      // Ensure full initialization before proceeding
      if (ensureInit) await ensureInit();
      
      // Merge user options with client defaults
      const mergedOptions = clientDefaults 
        ? mergeDeployOptions(options, clientDefaults)
        : options;
      
      // Convert input to StaticFile[] with automatic SPA detection
      const staticFiles: StaticFile[] = await convertDeployInput(input, mergedOptions, getApi());
      
      // Deploy using the API - now returns the full Deployment object directly
      return await getApi().deploy(staticFiles, mergedOptions);
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
// ALIAS RESOURCE
// =============================================================================

export interface AliasResource {
  set: (aliasName: string, deployment: string) => Promise<Alias>;
  get: (aliasName: string) => Promise<Alias>;
  list: () => Promise<AliasListResponse>;
  remove: (aliasName: string) => Promise<void>;
}

export function createAliasResource(getApi: () => ApiHttp, ensureInit?: () => Promise<void>): AliasResource {
  return {
    set: async (aliasName: string, deployment: string) => {
      if (ensureInit) await ensureInit();
      // Set alias and return the created/updated alias directly
      return getApi().setAlias(aliasName, deployment);
    },

    get: async (aliasName: string) => {
      if (ensureInit) await ensureInit();
      return getApi().getAlias(aliasName);
    },

    list: async () => {
      if (ensureInit) await ensureInit();
      return getApi().listAliases();
    },

    remove: async (aliasName: string) => {
      if (ensureInit) await ensureInit();
      await getApi().removeAlias(aliasName);
      // Return void for deletion operations
    }
  };
}

// =============================================================================
// ACCOUNT RESOURCE
// =============================================================================

export interface AccountResource {
  get: () => Promise<Account>;
}

export function createAccountResource(getApi: () => ApiHttp, ensureInit?: () => Promise<void>): AccountResource {
  return {
    get: async () => {
      if (ensureInit) await ensureInit();
      return getApi().getAccount();
    }
  };
}

// =============================================================================
// KEYS RESOURCE
// =============================================================================

export interface KeysResource {
  create: () => Promise<{ apiKey: string }>;
}

export function createKeysResource(getApi: () => ApiHttp, ensureInit?: () => Promise<void>): KeysResource {
  return {
    create: async () => {
      if (ensureInit) await ensureInit();
      return getApi().createApiKey();
    }
  };
}