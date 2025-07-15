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
  api: ApiHttp, 
  initConfig?: () => Promise<void>,
  clientDefaults?: ShipClientOptions
): DeploymentResource {
  return {
    create: async (input: DeployInput, options: DeploymentOptions = {}) => {
      // Initialize config from API before validation
      if (initConfig) {
        await initConfig();
      }
      
      // Merge user options with client defaults
      const mergedOptions = clientDefaults 
        ? mergeDeployOptions(options, clientDefaults)
        : options;
      
      // Convert input to StaticFile[] using unified utility
      const staticFiles: StaticFile[] = await convertDeployInput(input, mergedOptions);
      
      // Deploy using the API - now returns the full Deployment object directly
      return await api.deploy(staticFiles, mergedOptions);
    },

    list: async () => {
      return api.listDeployments();
    },

    remove: async (id: string) => {
      await api.removeDeployment(id);
      // Return void for deletion operations
    },

    get: async (id: string) => {
      return api.getDeployment(id);
    }
  };
}

// =============================================================================
// ALIAS RESOURCE
// =============================================================================

export interface AliasResource {
  set: (aliasName: string, deploymentName: string) => Promise<Alias>;
  get: (aliasName: string) => Promise<Alias>;
  list: () => Promise<AliasListResponse>;
  remove: (aliasName: string) => Promise<void>;
}

export function createAliasResource(api: ApiHttp): AliasResource {
  return {
    set: async (aliasName: string, deploymentName: string) => {
      // Set alias and return the created/updated alias directly
      return api.setAlias(aliasName, deploymentName);
    },

    get: async (aliasName: string) => {
      return api.getAlias(aliasName);
    },

    list: async () => {
      return api.listAliases();
    },

    remove: async (aliasName: string) => {
      await api.removeAlias(aliasName);
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

export function createAccountResource(api: ApiHttp): AccountResource {
  return {
    get: async () => {
      return api.getAccount();
    }
  };
}

// =============================================================================
// KEYS RESOURCE
// =============================================================================

export interface KeysResource {
  create: () => Promise<{ apiKey: string }>;
}

export function createKeysResource(api: ApiHttp): KeysResource {
  return {
    create: async () => {
      return api.createApiKey();
    }
  };
}