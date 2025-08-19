/**
 * @file All Ship SDK resources in one place - impossibly simple.
 */
import type { 
  Deployment, 
  DeploymentListResponse, 
  Alias, 
  AliasListResponse, 
  Account,
  StaticFile,
  DeployInput,
  DeploymentResource,
  AliasResource,
  AccountResource,
  KeysResource
} from '@shipstatic/types';
import type { ApiHttp } from './api/http.js';
import type { ShipClientOptions, DeploymentOptions } from './types.js';
import { mergeDeployOptions } from './core/config.js';
import { detectAndConfigureSPA } from './lib/prepare-input.js';

// Re-export DeployInput for external use
export type { DeployInput };

export function createDeploymentResource(
  getApi: () => ApiHttp, 
  clientDefaults?: ShipClientOptions,
  ensureInit?: () => Promise<void>,
  processInput?: (input: DeployInput, options: DeploymentOptions) => Promise<StaticFile[]>
): DeploymentResource {
  return {
    create: async (input: DeployInput, options: DeploymentOptions = {}) => {
      // Ensure full initialization before proceeding
      if (ensureInit) await ensureInit();
      
      // Merge user options with client defaults
      const mergedOptions = clientDefaults 
        ? mergeDeployOptions(options, clientDefaults)
        : options;
      
      // Get API client AFTER initialization is complete to avoid race conditions
      const apiClient = getApi();
      
      // Use environment-specific input processing
      if (!processInput) {
        throw new Error('processInput function is not provided.');
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
// ALIAS RESOURCE
// =============================================================================

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
    },

    check: async (aliasName: string) => {
      if (ensureInit) await ensureInit();
      return getApi().checkAlias(aliasName);
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
// KEYS RESOURCE
// =============================================================================

export function createKeysResource(getApi: () => ApiHttp, ensureInit?: () => Promise<void>): KeysResource {
  return {
    create: async () => {
      if (ensureInit) await ensureInit();
      return getApi().createApiKey();
    }
  };
}