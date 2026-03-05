/**
 * @file Node.js-specific file utilities for the Ship SDK.
 * Provides helpers for recursively discovering, filtering, and preparing files for deploy in Node.js.
 */
import { getENV } from '../../shared/lib/env.js';
import type { StaticFile, DeploymentOptions } from '../../shared/types.js';
import { calculateMD5 } from '../../shared/lib/md5.js';
import { filterJunk } from '../../shared/lib/junk.js';
import { validateDeployPath, validateDeployFile } from '../../shared/lib/security.js';
import { ShipError, isShipError, UNBUILT_PROJECT_MARKERS } from '@shipstatic/types';
import { getCurrentConfig } from '../../shared/core/platform-config.js';
import { optimizeDeployPaths } from '../../shared/lib/deploy-paths.js';
import { findCommonParent } from '../../shared/lib/path.js';

import * as fs from 'fs';
import * as path from 'path';


/**
 * Recursive function to walk directory and return all file paths.
 * Includes symlink loop protection to prevent infinite recursion.
 * @param dirPath - Directory path to traverse
 * @param visited - Set of already visited real paths (for cycle detection)
 * @returns Array of absolute file paths in the directory
 */
function findAllFilePaths(dirPath: string, visited: Set<string> = new Set()): string[] {
  const results: string[] = [];

  // Resolve the real path to detect symlink cycles
  const realPath = fs.realpathSync(dirPath);
  if (visited.has(realPath)) {
    // Already visited this directory (symlink cycle) - skip to prevent infinite loop
    return results;
  }
  visited.add(realPath);

  const entries = fs.readdirSync(dirPath);

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);
    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      const subFiles = findAllFilePaths(fullPath, visited);
      results.push(...subFiles);
    } else if (stats.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Processes Node.js file and directory paths into an array of StaticFile objects ready for deploy.
 * Computes content paths relative to the upload root before filtering, so only the deployed
 * directory structure is evaluated — not the user's filesystem above it.
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

  // Check input directories for unbuilt project markers before recursive walk
  for (const p of paths) {
    const absPath = path.resolve(p);
    try {
      if (fs.statSync(absPath).isDirectory()) {
        const marker = fs.readdirSync(absPath).find(e => UNBUILT_PROJECT_MARKERS.has(e));
        if (marker) {
          throw ShipError.business(`"${marker}" detected — deploy your build output (dist/, build/, out/), not the project folder`);
        }
      }
    } catch (e) {
      if (isShipError(e)) throw e;
      // Path errors handled in the existing flatMap below
    }
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

  // 2. Determine base path for content paths (from INPUT paths, not discovered files)
  const inputAbsolutePaths = paths.map(p => path.resolve(p));
  const inputBasePath = findCommonParent(inputAbsolutePaths.map(p => {
    try {
      const stats = fs.statSync(p);
      return stats.isDirectory() ? p : path.dirname(p);
    } catch {
      return path.dirname(p);
    }
  }));

  // 3. Compute content paths (relative to upload root) for filtering
  const contentPaths = uniquePaths.map(absPath => {
    if (inputBasePath && inputBasePath.length > 0) {
      const rel = path.relative(inputBasePath, absPath);
      if (rel && typeof rel === 'string' && !rel.startsWith('..')) {
        return rel.replace(/\\/g, '/');
      }
    }
    return path.basename(absPath);
  });

  // 4. Filter junk files from content paths
  const filteredContentSet = new Set(filterJunk(contentPaths));
  if (filteredContentSet.size === 0) {
    return [];
  }

  // 5. Collect valid file pairs (absolute path for reading, content path for deploy)
  const validAbsPaths: string[] = [];
  const validContentPaths: string[] = [];
  for (let i = 0; i < uniquePaths.length; i++) {
    if (filteredContentSet.has(contentPaths[i])) {
      validAbsPaths.push(uniquePaths[i]);
      validContentPaths.push(contentPaths[i]);
    }
  }

  // 6. Optimize paths for deployment (flattening)
  const deployFiles = optimizeDeployPaths(validContentPaths, {
    flatten: options.pathDetect !== false
  });

  // 7. Process files into StaticFile objects
  const results: StaticFile[] = [];
  let totalSize = 0;
  const platformLimits = getCurrentConfig();

  for (let i = 0; i < validAbsPaths.length; i++) {
    const filePath = validAbsPaths[i];
    const deployPath = deployFiles[i].path;
    
    try {
      // Security validation (shared with browser) — fail fast before any I/O
      validateDeployPath(deployPath, filePath);

      const stats = fs.statSync(filePath);

      // Skip empty files — R2 cannot store zero-byte objects
      if (stats.size === 0) {
        continue;
      }

      // Filename and extension validation (shared with browser)
      validateDeployFile(deployPath, filePath);

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

      results.push({
        path: deployPath,
        content,
        size: content.length,
        md5,
      });
    } catch (error) {
      // Re-throw ShipError instances directly
      if (isShipError(error)) {
        throw error;
      }
      // Convert file system errors to ShipError with clear message
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw ShipError.file(`Failed to read file "${filePath}": ${errorMessage}`, filePath);
    }
  }

  // Final validation
  if (results.length > platformLimits.maxFilesCount) {
    throw ShipError.business(`Too many files to deploy. Maximum allowed is ${platformLimits.maxFilesCount} files.`);
  }
  
  return results;
}