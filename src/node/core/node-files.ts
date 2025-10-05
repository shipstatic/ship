/**
 * @file Node.js-specific file utilities for the Ship SDK.
 * Provides helpers for recursively discovering, filtering, and preparing files for deploy in Node.js.
 */
import { getENV } from '../../shared/lib/env.js';
import type { StaticFile, DeploymentOptions } from '../../shared/types.js';
import { calculateMD5 } from '../../shared/lib/md5.js';
import { filterJunk } from '../../shared/lib/junk.js';
import { ShipError } from '@shipstatic/types';
import { getCurrentConfig } from '../../shared/core/platform-config.js';
import { optimizeDeployPaths } from '../../shared/lib/deploy-paths.js';
import { findCommonParent } from '../../shared/lib/path.js';

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
 * Processes Node.js file and directory paths into an array of StaticFile objects ready for deploy.
 * Uses corrected logic to properly handle common parent directory stripping.
 * 
 * @param paths - File or directory paths to scan and process.
 * @param options - Processing options (pathDetect, etc.).
 * @returns Promise resolving to an array of StaticFile objects.
 * @throws {ShipClientError} If called outside Node.js or if fs/path modules fail.
 */
export async function processFilesForNode(
  paths: string[],
  options: DeploymentOptions = {}
): Promise<StaticFile[]> {
  if (getENV() !== 'node') {
    throw ShipError.business('processFilesForNode can only be called in Node.js environment.');
  }

  // 1. Discover all unique, absolute file paths from the input list
  const absolutePaths = paths.flatMap(p => {
    const absPath = path.resolve(p);
    try {
      const stats = fs.statSync(absPath);
      return stats.isDirectory() ? findAllFilePaths(absPath) : [absPath];
    } catch (error) {
      throw ShipError.file(`Path does not exist: ${p}`, p);
    }
  });
  const uniquePaths = [...new Set(absolutePaths)];
  
  // 2. Filter out junk files from the final list
  const validPaths = filterJunk(uniquePaths);
  if (validPaths.length === 0) {
    return [];
  }

  // 3. Determine the base path for calculating relative paths
  // Find the common parent of the INPUT paths (not the discovered file paths)
  const inputAbsolutePaths = paths.map(p => path.resolve(p));
  const inputBasePath = findCommonParent(inputAbsolutePaths.map(p => {
    try {
      const stats = fs.statSync(p);
      return stats.isDirectory() ? p : path.dirname(p);
    } catch {
      return path.dirname(p);
    }
  }));

  // 4. Create raw relative paths for optimization
  const relativePaths = validPaths.map(filePath => {
    // If we have a meaningful common base path from inputs, use it
    if (inputBasePath && inputBasePath.length > 0) {
      const rel = path.relative(inputBasePath, filePath);
      if (rel && typeof rel === 'string' && !rel.startsWith('..')) {
        return rel.replace(/\\/g, '/');
      }
    }
    
    // Fallback: if no good common parent or relative path goes up, just use basename
    return path.basename(filePath);
  });

  // 5. Optimize paths for deployment (flattening)
  const deployFiles = optimizeDeployPaths(relativePaths, {
    flatten: options.pathDetect !== false
  });

  // 6. Process files into StaticFile objects
  const results: StaticFile[] = [];
  let totalSize = 0;
  const platformLimits = getCurrentConfig();

  for (let i = 0; i < validPaths.length; i++) {
    const filePath = validPaths[i];
    const deployPath = deployFiles[i].path;
    
    try {
      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        console.warn(`Skipping empty file: ${filePath}`);
        continue; // Skip empty files
      }

      // Validate file sizes
      if (stats.size > platformLimits.maxFileSize) {
        throw ShipError.business(`File ${filePath} is too large. Maximum allowed size is ${platformLimits.maxFileSize / (1024 * 1024)}MB.`);
      }
      totalSize += stats.size;
      if (totalSize > platformLimits.maxTotalSize) {
        throw ShipError.business(`Total deploy size is too large. Maximum allowed is ${platformLimits.maxTotalSize / (1024 * 1024)}MB.`);
      }

      const content = fs.readFileSync(filePath);
      const { md5 } = await calculateMD5(content);
      
      // Security validation: Ensure no dangerous characters in paths
      if (deployPath.includes('\0') || deployPath.includes('/../') || deployPath.startsWith('../') || deployPath.endsWith('/..')) {
        throw ShipError.business(`Security error: Unsafe file path "${deployPath}" for file: ${filePath}`);
      }
      
      results.push({
        path: deployPath,
        content,
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

  // Final validation
  if (results.length > platformLimits.maxFilesCount) {
    throw ShipError.business(`Too many files to deploy. Maximum allowed is ${platformLimits.maxFilesCount} files.`);
  }
  
  return results;
}