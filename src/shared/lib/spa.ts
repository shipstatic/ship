/**
 * @file SPA detection and auto-configuration — the whole concern, including
 * its one wire call.
 *
 * `checkSPA` lived on `ApiHttp` until 2026-08-12, where it was the only method
 * that read a file's CONTENT to decide what to send. Its single caller was
 * `detectAndConfigureSPA`, three lines down, so the endpoint sat one file away
 * from the only thing that ever asked for it. Bringing it here also takes it
 * off the package's public surface, which it never earned: SPA detection is
 * something the SDK does, not something a consumer calls.
 */

import {
  API_PATHS,
  DEPLOYMENT_CONFIG_FILENAME,
  SPA_CHECK_CONSTRAINTS,
  SPA_DEFAULT_CONFIG,
  type SPACheckRequest,
  type SPACheckResponse,
} from '@shipstatic/types';
import type { Transport } from '../api/http.js';
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
 * Ask the platform whether this deploy is a single-page app.
 *
 * Answers `false` without a request whenever it cannot ask honestly: no
 * `index.html` at the root, an index too large for the bound the platform
 * publishes, or content in a shape neither runtime produces. Only the file's
 * TEXT and the path list go up — never the deploy itself.
 *
 * @param files - The deploy, as it stands
 * @param transport - Carries the one request
 */
export async function checkSPA(files: StaticFile[], transport: Transport): Promise<boolean> {
  const indexFile = files.find(
    (f) =>
      f.path === SPA_CHECK_CONSTRAINTS.INDEX_FILE ||
      f.path === `/${SPA_CHECK_CONSTRAINTS.INDEX_FILE}`,
  );
  if (!indexFile || indexFile.size > SPA_CHECK_CONSTRAINTS.MAX_INDEX_BYTES) {
    return false;
  }

  let indexContent: string;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(indexFile.content)) {
    indexContent = indexFile.content.toString('utf-8');
  } else if (typeof Blob !== 'undefined' && indexFile.content instanceof Blob) {
    indexContent = await indexFile.content.text();
  } else if (typeof File !== 'undefined' && indexFile.content instanceof File) {
    indexContent = await indexFile.content.text();
  } else {
    return false;
  }

  const body: SPACheckRequest = { files: files.map((f) => f.path), index: indexContent };
  const response = await transport.request<SPACheckResponse>(
    API_PATHS.SPA_CHECK,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    'SPA check',
  );

  return response.isSPA;
}

/**
 * Detects SPA projects and auto-generates configuration.
 * This function can be used by both Node.js and browser environments.
 *
 * @param files - Array of StaticFiles to analyze
 * @param transport - Carries the detection request
 * @param options - Deployment options containing SPA detection settings
 * @returns Promise resolving to files array with optional SPA config added
 */
export async function detectAndConfigureSPA(
  files: StaticFile[],
  transport: Transport,
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
    const isSPA = await checkSPA(files, transport);

    if (isSPA) {
      const spaConfig = await createSPAConfig();
      return [...files, spaConfig];
    }
  } catch (_error) {
    // SPA detection failed, continue silently without auto-config
  }

  return files;
}
