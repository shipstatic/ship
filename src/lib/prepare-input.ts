/**
 * @file Input conversion utilities for deployment
 * Converts various input types to StaticFile[] for unified processing
 */

import type { StaticFile, DeploymentOptions, DeployInput } from '../types.js';
import { ShipError, DEPLOYMENT_CONFIG_FILENAME } from '@shipstatic/types';
import { getENV } from './env.js';
import { processFilesForNode } from './node-files.js';
import { processFilesForBrowser } from './browser-files.js';
import { getCurrentConfig } from '../core/platform-config.js';
import { calculateMD5 } from './md5.js';


/**
 * Fail-fast file validation for both Node.js and browser environments
 * Validates immediately without collecting all files first for better performance
 * @param files - Array of files to validate (can be File[] or file metadata)
 * @param options - Validation options
 * @throws {ShipError} If validation fails
 * @internal
 */
function validateFiles(files: Array<{ name: string; size: number }>, options: { skipEmptyCheck?: boolean } = {}): void {
  const config = getCurrentConfig();
  
  // Check for empty file array - fail fast
  if (!options.skipEmptyCheck && files.length === 0) {
    throw ShipError.business('No files to deploy.');
  }
  
  // Check file count limit - fail fast
  if (files.length > config.maxFilesCount) {
    throw ShipError.business(`Too many files to deploy. Maximum allowed is ${config.maxFilesCount}.`);
  }
  
  // Validate individual files and calculate total size - fail on first violation
  let totalSize = 0;
  for (const file of files) {
    // Individual file size validation - fail immediately
    if (file.size > config.maxFileSize) {
      throw ShipError.business(`File ${file.name} is too large. Maximum allowed size is ${config.maxFileSize / (1024 * 1024)}MB.`);
    }
    
    // Accumulate total size and check incrementally for early failure
    totalSize += file.size;
    if (totalSize > config.maxTotalSize) {
      throw ShipError.business(`Total deploy size is too large. Maximum allowed is ${config.maxTotalSize / (1024 * 1024)}MB.`);
    }
  }
}

/**
 * Early validation for file count and basic input
 * Used before file processing to fail fast on obvious issues
 * @param input - Input to validate
 * @param environment - Current environment (node/browser)
 * @throws {ShipError} If validation fails
 * @internal
 */
function validateInputEarly(input: any, environment: string): void {
  if (environment === 'node') {
    if (!Array.isArray(input)) {
      throw ShipError.business('Invalid input type for Node.js environment. Expected string[] file paths.');
    }
    if (input.length === 0) {
      throw ShipError.business('No files to deploy.');
    }
    if (!input.every(item => typeof item === 'string')) {
      throw ShipError.business('Invalid input type for Node.js environment. Expected string[] file paths.');
    }
  } else if (environment === 'browser') {
    if (input instanceof HTMLInputElement && !input.files) {
      throw ShipError.business('No files selected in HTMLInputElement');
    }
  }
}

/**
 * Shared post-processing logic for StaticFile arrays
 * @param files - Array of StaticFile objects to process
 * @returns Processed StaticFile array
 * @internal
 */
function postProcessFiles(files: StaticFile[]): StaticFile[] {
  // Validate processed files
  validateFiles(files, { skipEmptyCheck: true });
  
  // Normalize paths to forward slashes
  files.forEach(f => {
    if (f.path) f.path = f.path.replace(/\\/g, '/');
  });
  
  return files;
}

/**
 * Converts Node.js string[] paths to StaticFile[]
 */
export async function convertNodeInput(
  input: string[], 
  options: DeploymentOptions = {}
): Promise<StaticFile[]> {
  // Early validation - fail fast before processing
  validateInputEarly(input, 'node');

  // Pass options directly to node processor - no conflicting logic here
  const staticFiles: StaticFile[] = await processFilesForNode(input, options);
  
  // Apply shared validation and post-processing
  return postProcessFiles(staticFiles);
}

/**
 * Converts browser FileList/File[]/HTMLInputElement to StaticFile[]
 */
export async function convertBrowserInput(
  input: FileList | File[] | HTMLInputElement,
  options: DeploymentOptions = {}
): Promise<StaticFile[]> {
  // Early validation - fail fast before processing
  validateInputEarly(input, 'browser');

  let fileArray: File[];
  
  if (input instanceof HTMLInputElement) {
    fileArray = Array.from(input.files!);
  } else if (
    typeof input === 'object' &&
    input !== null &&
    typeof (input as any).length === 'number' &&
    typeof (input as any).item === 'function'
  ) {
    fileArray = Array.from(input as FileList);
  } else if (Array.isArray(input)) {
    if (input.length > 0 && typeof input[0] === 'string') {
      throw ShipError.business('Invalid input type for browser environment. Expected File[], FileList, or HTMLInputElement.');
    }
    fileArray = input as File[];
  } else {
    throw ShipError.business('Invalid input type for browser environment. Expected File[], FileList, or HTMLInputElement.');
  }

  // Filter out empty files first
  fileArray = fileArray.filter(file => {
    if (file.size === 0) {
      console.warn(`Skipping empty file: ${file.name}`);
      return false;
    }
    return true;
  });

  // Early validation using shared logic - fail fast before heavy processing
  validateFiles(fileArray);

  // Pass options directly to browser processor - no conflicting logic here
  const staticFiles: StaticFile[] = await processFilesForBrowser(fileArray as File[], options);
  
  // Apply shared validation and post-processing
  return postProcessFiles(staticFiles);
}

/**
 * Unified input conversion function with automatic SPA detection
 * Converts any DeployInput to StaticFile[] and auto-generates ship.json for SPAs
 */
export async function convertDeployInput(
  input: DeployInput,
  options: DeploymentOptions = {},
  apiClient?: any
): Promise<StaticFile[]> {
  const environment = getENV();
  
  // Early validation at the unified level - fail immediately on environment issues
  if (environment !== 'node' && environment !== 'browser') {
    throw ShipError.business('Unsupported execution environment.');
  }
  
  // Convert input to StaticFile[] based on environment
  let files: StaticFile[];
  if (environment === 'node') {
    files = await convertNodeInput(input as string[], options);
  } else {
    files = await convertBrowserInput(input as FileList | File[] | HTMLInputElement, options);
  }
  
  // Auto-detect and configure SPA projects
  if (apiClient) {
    files = await detectAndConfigureSPA(files, apiClient, options);
  }
  
  return files;
}

/**
 * Creates ship.json configuration for SPA projects
 * @private
 */
async function createSPAConfig(): Promise<StaticFile> {
  const config = {
    "rewrites": [{
      "source": "/(.*)",
      "destination": "/index.html"
    }]
  };
  
  const content = Buffer.from(JSON.stringify(config, null, 2), 'utf-8');
  const { md5 } = await calculateMD5(content);
  
  return {
    path: DEPLOYMENT_CONFIG_FILENAME,
    content,
    size: content.length,
    md5
  };
}

/**
 * Detects SPA projects and auto-generates configuration
 * @private
 */
async function detectAndConfigureSPA(files: StaticFile[], apiClient: any, options: DeploymentOptions): Promise<StaticFile[]> {
  // Skip if disabled or config already exists
  if (options.spaDetect === false || files.some(f => f.path === DEPLOYMENT_CONFIG_FILENAME)) {
    return files;
  }
  
  try {
    const filePaths = files.map(f => f.path);
    const isSPA = await apiClient.checkSPA(filePaths);
    
    if (isSPA) {
      const spaConfig = await createSPAConfig();
      console.log(`SPA detected - generated ${DEPLOYMENT_CONFIG_FILENAME}`);
      return [...files, spaConfig];
    }
  } catch (error) {
    console.warn('SPA detection failed, continuing without auto-config');
  }
  
  return files;
}