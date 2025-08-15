/**
 * @file Deploy path optimization - the core logic that makes Ship deployments clean and intuitive.
 * Automatically strips common parent directories to create clean deployment URLs.
 */

import { normalizeWebPath } from './path.js';

/**
 * Represents a file ready for deployment with its optimized path
 */
export interface DeployFile {
  /** The clean deployment path (e.g., "assets/style.css") */
  path: string;
  /** Original filename */
  name: string;
}

/**
 * Core path optimization logic.
 * Transforms messy local paths into clean deployment paths.
 * 
 * @example
 * Input:  ["dist/index.html", "dist/assets/app.js"]
 * Output: ["index.html", "assets/app.js"]
 * 
 * @param filePaths - Raw file paths from the local filesystem
 * @param options - Path processing options
 */
export function optimizeDeployPaths(
  filePaths: string[], 
  options: { flatten?: boolean } = {}
): DeployFile[] {
  // When flattening is disabled, keep original structure
  if (options.flatten === false) {
    return filePaths.map(path => ({
      path: normalizeWebPath(path),
      name: extractFileName(path)
    }));
  }

  // Find the common directory prefix to strip
  const commonPrefix = findCommonDirectory(filePaths);
  
  return filePaths.map(filePath => {
    let deployPath = normalizeWebPath(filePath);
    
    // Strip the common prefix to create clean deployment paths
    if (commonPrefix) {
      const prefixToRemove = commonPrefix.endsWith('/') ? commonPrefix : `${commonPrefix}/`;
      if (deployPath.startsWith(prefixToRemove)) {
        deployPath = deployPath.substring(prefixToRemove.length);
      }
    }
    
    // Fallback to filename if path becomes empty
    if (!deployPath) {
      deployPath = extractFileName(filePath);
    }
    
    return {
      path: deployPath,
      name: extractFileName(filePath)
    };
  });
}

/**
 * Finds the common directory shared by all file paths.
 * This is what gets stripped to create clean deployment URLs.
 * 
 * @example
 * ["dist/index.html", "dist/assets/app.js"] → "dist"
 * ["src/components/A.tsx", "src/utils/B.ts"] → "src"
 * ["file1.txt", "file2.txt", "subdir/file3.txt"] → "" (no common directory)
 */
function findCommonDirectory(filePaths: string[]): string {
  if (!filePaths.length) return '';
  
  // Normalize all paths first
  const normalizedPaths = filePaths.map(path => normalizeWebPath(path));
  
  // Find the common prefix among all file paths (not just directories)
  const pathSegments = normalizedPaths.map(path => path.split('/'));
  const commonSegments: string[] = [];
  const minLength = Math.min(...pathSegments.map(segments => segments.length));
  
  // Check each segment level to find the longest common prefix
  for (let i = 0; i < minLength - 1; i++) { // -1 because we don't want to include the filename
    const segment = pathSegments[0][i];
    if (pathSegments.every(segments => segments[i] === segment)) {
      commonSegments.push(segment);
    } else {
      break;
    }
  }
  
  return commonSegments.join('/');
}

/**
 * Extracts just the filename from a file path
 */
function extractFileName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}