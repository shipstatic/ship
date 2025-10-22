/**
 * @file Input conversion utilities for deployment
 * Converts various input types to StaticFile[] for unified processing
 */

import type { StaticFile, DeploymentOptions, DeployInput } from '../../shared/types.js';
import { ShipError, DEPLOYMENT_CONFIG_FILENAME } from '@shipstatic/types';
import { getENV } from '../../shared/lib/env.js';
import { processFilesForNode } from './node-files.js';
import { processFilesForBrowser } from '../../browser/lib/browser-files.js';
import { calculateMD5 } from '../../shared/lib/md5.js';
import { getCurrentConfig } from '../../shared/core/platform-config.js';


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
  }
  // Browser environment validation happens in browser/index.ts
}

/**
 * Shared post-processing logic for StaticFile arrays
 * @param files - Array of StaticFile objects to process
 * @returns Processed StaticFile array
 * @internal
 */
function postProcessFiles(files: StaticFile[]): StaticFile[] {
  // Validate processed files - convert StaticFile[] to the expected format
  const validationFiles = files.map(f => ({ name: f.path, size: f.size }));
  validateFiles(validationFiles, { skipEmptyCheck: true });
  
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
 * Converts browser File[] to StaticFile[]
 */
export async function convertBrowserInput(
  input: File[],
  options: DeploymentOptions = {}
): Promise<StaticFile[]> {
  // Early validation - fail fast before processing
  validateInputEarly(input, 'browser');

  let fileArray: File[];

  if (Array.isArray(input)) {
    if (input.length > 0 && typeof input[0] === 'string') {
      throw ShipError.business('Invalid input type for browser environment. Expected File[].');
    }
    fileArray = input as File[];
  } else {
    throw ShipError.business('Invalid input type for browser environment. Expected File[].');
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
  const staticFiles: StaticFile[] = await processFilesForBrowser(fileArray, options);

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
    // Normalize string to string[] for Node.js processing
    if (typeof input === 'string') {
      files = await convertNodeInput([input], options);
    } else if (Array.isArray(input) && input.every(item => typeof item === 'string')) {
      files = await convertNodeInput(input as string[], options);
    } else {
      throw ShipError.business('Invalid input type for Node.js environment. Expected string[] file paths.');
    }
  } else {
    files = await convertBrowserInput(input as File[], options);
  }
  
  return files;
}

