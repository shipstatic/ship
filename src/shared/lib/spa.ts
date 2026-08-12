/**
 * @file SPA detection and auto-configuration utilities.
 *
 * Provides SPA detection and ship.json generation functionality
 * that can be used by both Node.js and browser environments.
 */

import { DEPLOYMENT_CONFIG_FILENAME, SPA_DEFAULT_CONFIG } from '@shipstatic/types';
import type { ApiHttp } from '../api/http.js';
import type { DeploymentOptions, StaticFile } from '../types.js';
import { calculateMD5 } from './md5.js';

/**
 * Creates ship.json configuration for SPA projects.
 * @returns Promise resolving to StaticFile with SPA configuration
 */
export async function createSPAConfig(): Promise<StaticFile> {
  const configString = JSON.stringify(SPA_DEFAULT_CONFIG, null, 2);

  // Create content that works in both browser and Node.js environments
  let content: Buffer | Blob;
  if (typeof Buffer !== 'undefined') {
    // Node.js environment
    content = Buffer.from(configString, 'utf-8');
  } else {
    // Browser environment
    content = new Blob([configString], { type: 'application/json' });
  }

  const { md5 } = await calculateMD5(content);

  return {
    path: DEPLOYMENT_CONFIG_FILENAME,
    content,
    size: configString.length,
    md5,
  };
}

/**
 * Detects SPA projects and auto-generates configuration.
 * This function can be used by both Node.js and browser environments.
 *
 * @param files - Array of StaticFiles to analyze
 * @param apiClient - HTTP client for API communication
 * @param options - Deployment options containing SPA detection settings
 * @returns Promise resolving to files array with optional SPA config added
 */
export async function detectAndConfigureSPA(
  files: StaticFile[],
  apiClient: ApiHttp,
  options: DeploymentOptions,
): Promise<StaticFile[]> {
  // Skip if disabled, config already exists, or server will handle detection
  if (
    options.spaDetect === false ||
    options.spa ||
    options.build ||
    options.prerender ||
    files.some((f) => f.path === DEPLOYMENT_CONFIG_FILENAME)
  ) {
    return files;
  }

  try {
    const isSPA = await apiClient.checkSPA(files);

    if (isSPA) {
      const spaConfig = await createSPAConfig();
      return [...files, spaConfig];
    }
  } catch (_error) {
    // SPA detection failed, continue silently without auto-config
  }

  return files;
}
