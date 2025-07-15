/**
 * @file Path helper utilities that work in both browser and Node.js environments.
 * Provides environment-agnostic path manipulation functions.
 */

/**
 * Finds the common parent directory from an array of paths.
 * This function is the single shared implementation to be used by both browser and Node.js environments.
 * 
 * @param paths - Array of paths to analyze for common parent directory.
 * @param separator - Path separator character (e.g., '/' for browser, path.sep for Node.js).
 * @returns The common parent directory path, or an empty string if none is found.
 */
export function findCommonParentDirectory(paths: string[], separator: string): string {
  // Validate input
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return '';
  }
  
  // Filter out empty paths and paths without separators
  const validPaths = paths.filter(p => p && typeof p === 'string' && p.includes(separator));
  
  if (validPaths.length === 0) {
    return '';
  }

  // Special case for single path: return the directory containing this path
  if (validPaths.length === 1) {
    const path = validPaths[0];
    const lastSepIndex = path.lastIndexOf(separator);
    if (lastSepIndex > -1) {
      // Return the directory part without the file name
      return path.substring(0, lastSepIndex);
    }
    return ''; // No directory part found
  }

  // Sort paths alphabetically to easily find the common prefix
  const sortedPaths = [...validPaths].sort();
  const firstPath = sortedPaths[0];
  const lastPath = sortedPaths[sortedPaths.length - 1];
  
  // Find the length of the common prefix
  let i = 0;
  while (i < firstPath.length && i < lastPath.length && firstPath[i] === lastPath[i]) {
    i++;
  }

  const commonPrefix = firstPath.substring(0, i);

  // The prefix must be a directory. If it doesn't end with a separator,
  // find the last separator to get the parent directory.
  if (commonPrefix.endsWith(separator)) {
    // It's a full directory path that matches, so return it without the trailing slash
    return commonPrefix.slice(0, -1);
  }

  const lastSepIndex = commonPrefix.lastIndexOf(separator);
  if (lastSepIndex > -1) {
    return commonPrefix.substring(0, lastSepIndex);
  }

  return ''; // No common directory
}

/**
 * Simple helper to find common parent of absolute paths using the system path separator.
 * More declarative wrapper around findCommonParentDirectory for Node.js usage.
 * @param absolutePaths - Array of absolute file paths
 * @returns Common parent directory path or empty string if none found
 */
export function findCommonParent(absolutePaths: string[]): string {
  if (typeof require === 'undefined') {
    // Browser environment - use forward slash
    return findCommonParentDirectory(absolutePaths, '/');
  }
  
  // Node.js environment - use system separator
  const path = require('path');
  return findCommonParentDirectory(absolutePaths, path.sep);
}


/**
 * Converts backslashes to forward slashes for cross-platform compatibility.
 * Does not remove leading slashes (preserves absolute paths).
 * @param path - The path to normalize
 * @returns Path with forward slashes
 */
export function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Normalizes a path for web usage by converting backslashes to forward slashes
 * and removing leading slashes.
 * @param path - The path to normalize
 * @returns Normalized path suitable for web deployment
 */
export function normalizeWebPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Ensures a path is relative by normalizing it and removing any leading slashes.
 * @param path - The path to make relative
 * @returns Relative path suitable for web deployment
 */
export function ensureRelativePath(path: string): string {
  return normalizeWebPath(path);
}
