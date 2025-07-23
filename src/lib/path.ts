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
  
  // Filter out empty paths
  const validPaths = paths.filter(p => p && typeof p === 'string');
  
  if (validPaths.length === 0) {
    return '';
  }

  // Normalize paths to ensure consistent handling across environments
  // Convert all paths to use forward slashes regardless of input format
  const normalizedPaths = validPaths.map(p => {
    // Use the existing path normalization function to handle Windows and Unix paths
    const normalized = p.replace(/\\/g, '/').replace(/^\/+/, '');
    // Add trailing slash for consistent segment comparison
    return normalized.endsWith('/') ? normalized : normalized + '/';
  });
  
  // Special case for single path: return the directory itself
  // This ensures we strip the directory name for single directory inputs
  if (normalizedPaths.length === 1) {
    const path = normalizedPaths[0];
    // For a single path, return the path itself (without trailing slash)
    return path.slice(0, -1); // Remove trailing slash
  }

  // For multiple paths: find the common prefix across all paths using segments
  // Split all paths into segments for proper path component comparison
  const pathSegments = normalizedPaths.map(p => p.split('/').filter(Boolean));
  
  // Find the common path segments across all paths
  const commonSegments = [];
  const firstPathSegments = pathSegments[0];
  
  for (let i = 0; i < firstPathSegments.length; i++) {
    const segment = firstPathSegments[i];
    // Check if this segment is common across all paths
    const isCommonSegment = pathSegments.every(segments => 
      segments.length > i && segments[i] === segment
    );
    
    if (isCommonSegment) {
      commonSegments.push(segment);
    } else {
      break; // Stop at first non-matching segment
    }
  }
  
  // Reconstruct the common path
  if (commonSegments.length === 0) {
    return ''; // No common segments
  }
  
  // Return the common path (using the correct separator for the environment)
  return commonSegments.join('/');
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
