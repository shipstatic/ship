/**
 * @file Input conversion utilities for deployment
 * Converts various input types to StaticFile[] for unified processing
 */

import type { StaticFile, DeploymentOptions, DeployInput } from '../types.js';
import { ShipError } from '@shipstatic/types';
import { getENV } from './env.js';
import { processFilesForNode } from './node-files.js';
import { processFilesForBrowser } from './browser-files.js';
import { getCurrentConfig } from '../core/platform-config.js';

/**
 * Unified validation for file count and size limits
 * @param fileCount - Number of files 
 * @param totalSize - Total size in bytes (optional, for size validation)
 * @throws {ShipError} If limits are exceeded
 * @internal
 */
function validateLimits(fileCount: number, totalSize?: number): void {
  const config = getCurrentConfig();
  
  if (fileCount === 0) {
    throw ShipError.business('No files to deploy.');
  }
  
  if (fileCount > config.maxFilesCount) {
    throw ShipError.business(`Too many files to deploy. Maximum allowed is ${config.maxFilesCount}.`);
  }
  
  if (totalSize !== undefined && totalSize > config.maxTotalSize) {
    throw ShipError.business(`Total deploy size is too large. Maximum allowed is ${config.maxTotalSize / (1024 * 1024)}MB.`);
  }
}

/**
 * Validates individual file size against platform limits
 * @param fileName - Name of the file for error messages
 * @param fileSize - Size of the file in bytes
 * @throws {ShipError} If file is too large
 * @internal
 */
function validateFileSize(fileName: string, fileSize: number): void {
  const config = getCurrentConfig();
  
  if (fileSize > config.maxFileSize) {
    throw ShipError.business(`File ${fileName} is too large. Maximum allowed size is ${config.maxFileSize / (1024 * 1024)}MB.`);
  }
}

/**
 * Comprehensive file validation for both Node.js and browser environments
 * @param files - Array of files to validate (can be File[] or file metadata)
 * @param options - Validation options
 * @throws {ShipError} If validation fails
 * @internal
 */
function validateFiles(files: Array<{ name: string; size: number }>, options: { skipEmptyCheck?: boolean } = {}): void {
  const config = getCurrentConfig();
  
  // Check for empty file array
  if (!options.skipEmptyCheck && files.length === 0) {
    throw ShipError.business('No files to deploy.');
  }
  
  // Check file count limit
  if (files.length > config.maxFilesCount) {
    throw ShipError.business(`Too many files to deploy. Maximum allowed is ${config.maxFilesCount}.`);
  }
  
  // Validate individual files and calculate total size
  let totalSize = 0;
  for (const file of files) {
    // Individual file size validation
    if (file.size > config.maxFileSize) {
      throw ShipError.business(`File ${file.name} is too large. Maximum allowed size is ${config.maxFileSize / (1024 * 1024)}MB.`);
    }
    totalSize += file.size;
  }
  
  // Total size validation
  if (totalSize > config.maxTotalSize) {
    throw ShipError.business(`Total deploy size is too large. Maximum allowed is ${config.maxTotalSize / (1024 * 1024)}MB.`);
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
  if (!Array.isArray(input) || !input.every(item => typeof item === 'string')) {
    throw ShipError.business('Invalid input type for Node.js environment. Expected string[] file paths.');
  }
  
  // Initial validation - just check input count
  if (input.length === 0) {
    throw ShipError.business('No files to deploy.');
  }

  // Process files for Node.js
  const processingOptions: { basePath?: string; stripCommonPrefix?: boolean } = {};
  
  if (options.stripCommonPrefix !== undefined) {
    processingOptions.stripCommonPrefix = options.stripCommonPrefix;
    if (options.stripCommonPrefix) {
      const path = require('path');
      const cwd = typeof process !== 'undefined' ? process.cwd() : '/';
      const resolvedPaths = input.map((inputPath: string) => path.resolve(cwd, inputPath));
      const { findCommonParent } = await import('./path.js');
      const commonParent = findCommonParent(resolvedPaths);
      if (commonParent) {
        processingOptions.basePath = commonParent;
      }
    }
  }

  const staticFiles: StaticFile[] = await processFilesForNode(input, processingOptions);
  
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
  let fileArray: File[];
  
  if (input instanceof HTMLInputElement) {
    if (!input.files) throw ShipError.business('No files selected in HTMLInputElement');
    fileArray = Array.from(input.files);
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

  // Early validation using shared logic
  validateFiles(fileArray);

  // Process files for browser
  const processingOptions: { stripCommonPrefix?: boolean; basePath?: string } = {};

  if (options.stripCommonPrefix !== undefined) {
    processingOptions.stripCommonPrefix = options.stripCommonPrefix;
    if (options.stripCommonPrefix) {
      const { findBrowserCommonParentDirectory } = await import('./browser-files.js');
      const commonParent = findBrowserCommonParentDirectory(
        input instanceof HTMLInputElement ? input.files! : input
      );
      if (commonParent) {
        processingOptions.basePath = commonParent;
      }
    }
  }

  const staticFiles: StaticFile[] = await processFilesForBrowser(fileArray as File[], processingOptions);
  
  // Apply shared validation and post-processing
  return postProcessFiles(staticFiles);
}

/**
 * Unified input conversion function
 * Converts any DeployInput to StaticFile[] based on environment
 */
export async function convertDeployInput(
  input: DeployInput,
  options: DeploymentOptions = {}
): Promise<StaticFile[]> {
  const environment = getENV();
  
  if (environment === 'node') {
    if (!Array.isArray(input) || !input.every(item => typeof item === 'string')) {
      throw ShipError.business('Invalid input type for Node.js environment. Expected string[] file paths.');
    }
    return convertNodeInput(input as string[], options);
  } else if (environment === 'browser') {
    if (!(input instanceof HTMLInputElement || Array.isArray(input) || 
          (typeof FileList !== 'undefined' && input instanceof FileList))) {
      throw ShipError.business('In browser, input must be FileList, File[], or HTMLInputElement.');
    }
    return convertBrowserInput(input as FileList | File[] | HTMLInputElement, options);
  } else {
    throw ShipError.business('Unsupported execution environment.');
  }
}