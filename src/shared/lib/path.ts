/**
 * @file Path helper utilities that work in both browser and Node.js environments.
 * Provides environment-agnostic path manipulation functions.
 */

/**
 * Finds the common parent directory from an array of directory paths.
 * Simple, unified implementation for flattenDirs functionality.
 * 
 * @param dirPaths - Array of directory paths (not file paths - directories containing the files)
 * @returns The common parent directory path, or empty string if none found
 */
export function findCommonParent(dirPaths: string[]): string {
  if (!dirPaths || dirPaths.length === 0) return '';
  
  const normalizedPaths = dirPaths
    .filter(p => p && typeof p === 'string')
    .map(p => p.replace(/\\/g, '/'));
  
  if (normalizedPaths.length === 0) return '';
  if (normalizedPaths.length === 1) return normalizedPaths[0];

  const pathSegments = normalizedPaths.map(p => p.split('/').filter(Boolean));
  const commonSegments = [];
  const minLength = Math.min(...pathSegments.map(p => p.length));
  
  for (let i = 0; i < minLength; i++) {
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
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '');
}

