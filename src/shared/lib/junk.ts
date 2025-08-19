/**
 * @file Utility for filtering out junk files and directories from file paths
 * 
 * This module provides functionality to filter out common system junk files and directories
 * from a list of file paths. It uses the 'junk' package to identify junk filenames and
 * a custom list to filter out common junk directories.
 */
import { isJunk } from 'junk';

/**
 * List of directory names considered as junk
 * 
 * Files within these directories (at any level in the path hierarchy) will be excluded.
 * The comparison is case-insensitive for cross-platform compatibility.
 * 
 * @internal
 */
export const JUNK_DIRECTORIES = [
  '__MACOSX',
  '.Trashes',
  '.fseventsd',
  '.Spotlight-V100',
] as const;

/**
 * Filters an array of file paths, removing those considered junk
 * 
 * A path is filtered out if either:
 * 1. The basename is identified as junk by the 'junk' package (e.g., .DS_Store, Thumbs.db)
 * 2. Any directory segment in the path matches an entry in JUNK_DIRECTORIES (case-insensitive)
 *
 * All path separators are normalized to forward slashes for consistent cross-platform behavior.
 * 
 * @param filePaths - An array of file path strings to filter
 * @returns A new array containing only non-junk file paths
 */
export function filterJunk(filePaths: string[]): string[] {
  if (!filePaths || filePaths.length === 0) {
    return [];
  }

  return filePaths.filter(filePath => {
    if (!filePath) {
      return false; // Exclude null or undefined paths
    }

    // Normalize path separators to forward slashes and split into segments
    const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length === 0) return true;
    
    // Check if the basename is a junk file (using junk package)
    const basename = parts[parts.length - 1];
    if (isJunk(basename)) {
      return false;
    }

    // Check if any directory segment is in our junk directories list
    const directorySegments = parts.slice(0, -1);
    for (const segment of directorySegments) {
      if (JUNK_DIRECTORIES.some(junkDir => 
          segment.toLowerCase() === junkDir.toLowerCase())) {
        return false;
      }
    }

    return true;
  });
}
