/**
 * @file Node.js-specific file utilities for the Ship SDK.
 * Provides helpers for recursively discovering, filtering, and preparing files for deploy in Node.js.
 */
import { getENV } from './env.js';
import { StaticFile, DeploymentOptions } from '../types.js';
import { calculateMD5 } from './md5.js';
import { filterJunk } from './junk.js';
import { ShipError } from '@shipstatic/types';
import { getCurrentConfig } from '../core/platform-config.js';
import { findCommonParent } from './path.js';

import * as fs from 'fs';
import * as path from 'path';


/**
 * Simple recursive function to walk directory and return all file paths.
 * More declarative and focused than the previous implementation.
 * @param dirPath - Directory path to traverse
 * @returns Array of absolute file paths in the directory
 */
function findAllFilePaths(dirPath: string): string[] {
  const results: string[] = [];
  
  try {
    const entries = fs.readdirSync(dirPath);
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      const stats = fs.statSync(fullPath);
      
      if (stats.isDirectory()) {
        const subFiles = findAllFilePaths(fullPath);
        results.push(...subFiles);
      } else if (stats.isFile()) {
        results.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
  }
  
  return results;
}

/**
 * Clean, declarative function to get files from a source path.
 * Follows the suggested architectural pattern from the feedback.
 * @param sourcePath - File or directory path to process
 * @param options - Options for processing (basePath, preserveDirs)
 * @returns Promise resolving to array of StaticFile objects
 */
export async function getFilesFromPath(
  sourcePath: string, 
  options: DeploymentOptions = {}
): Promise<StaticFile[]> {
  const absolutePath = path.resolve(sourcePath);
  
  // 1. Discover all files
  const allPaths = (() => {
    const stats = fs.statSync(absolutePath);
    if (stats.isFile()) {
      return [absolutePath];
    } else if (stats.isDirectory()) {
      return findAllFilePaths(absolutePath);
    } else {
      return [];
    }
  })();
  
  // 2. Filter out junk
  const validPaths = allPaths.filter(p => {
    const basename = path.basename(p);
    return filterJunk([basename]).length > 0; // Keep files that pass junk filter
  });
  
  // 3. Determine base for relative paths (simplified with unified logic)
  const stats = fs.statSync(absolutePath);
  let commonParent: string;
  
  if (options.preserveDirs) {
    // Preserve directory structure: use source directory
    commonParent = stats.isDirectory() ? absolutePath : path.dirname(absolutePath);
  } else {
    // Default: flatten by finding common parent of all file directories
    const fileDirs = validPaths.map(filePath => path.dirname(filePath));
    commonParent = findCommonParent(fileDirs);
  }
  
  // 4. Process into StaticFile objects
  const results: StaticFile[] = [];
  let totalSize = 0;
  
  for (const filePath of validPaths) {
    try {
      // Validate file
      const stats = fs.statSync(filePath);
      
      if (stats.size === 0) {
        console.warn(`Skipping empty file: ${filePath}`);
        continue;
      }
      
      const platformLimits = getCurrentConfig();
      if (stats.size > platformLimits.maxFileSize) {
        throw ShipError.business(`File ${filePath} is too large. Maximum allowed size is ${platformLimits.maxFileSize / (1024 * 1024)}MB.`);
      }
      
      totalSize += stats.size;
      if (totalSize > platformLimits.maxTotalSize) {
        throw ShipError.business(`Total deploy size is too large. Maximum allowed is ${platformLimits.maxTotalSize / (1024 * 1024)}MB.`);
      }
      
      // Read content and calculate metadata
      const content = fs.readFileSync(filePath);
      const { md5 } = await calculateMD5(content);
      let relativePath = path.relative(commonParent, filePath).replace(/\\/g, '/');
      
      // Security validation: Ensure no dangerous characters in paths
      if (relativePath.includes('..') || relativePath.includes('\0')) {
        // Instead of throwing an error, let's normalize the path safely
        // This handles cases where path.relative might generate .. sequences
        relativePath = path.basename(filePath);
      }
      
      // Ensure path is not empty (this can happen if file equals commonParent)
      if (!relativePath) {
        relativePath = path.basename(filePath);
      }
      
      results.push({
        path: relativePath,
        content: content,
        size: content.length,
        md5,
      });
    } catch (error) {
      if (error instanceof ShipError && error.isClientError && error.isClientError()) {
        throw error;
      }
      console.error(`Could not process file ${filePath}:`, error);
    }
  }
  
  // Validate total file count
  const platformLimits = getCurrentConfig();
  if (results.length > platformLimits.maxFilesCount) {
    throw ShipError.business(`Too many files to deploy. Maximum allowed is ${platformLimits.maxFilesCount} files.`);
  }
  
  return results;
}


/**
 * Processes Node.js file and directory paths into an array of StaticFile objects ready for deploy.
 * Now uses the simplified, declarative approach suggested in the feedback.
 * 
 * @param paths - File or directory paths to scan and process.
 * @param options - Processing options (basePath, preserveDirs).
 * @returns Promise resolving to an array of StaticFile objects.
 * @throws {ShipClientError} If called outside Node.js or if fs/path modules fail.
 */
export async function processFilesForNode(
  paths: string[],
  options: DeploymentOptions = {}
): Promise<StaticFile[]> {
  if (getENV() !== 'node') {
    throw ShipError.business('processFilesForNode can only be called in a Node.js environment.');
  }

  // Handle multiple paths
  if (paths.length > 1) {
    const allResults: StaticFile[] = [];
    for (const singlePath of paths) {
      const results = await getFilesFromPath(singlePath, options);
      allResults.push(...results);
    }
    return allResults;
  }

  // Single path - use the getFilesFromPath function
  return await getFilesFromPath(paths[0], options);
}
