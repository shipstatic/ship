/**
 * @file Utility for filtering out junk files and directories from file paths
 * 
 * This module provides functionality to filter out common system junk files and directories
 * from a list of file paths. It uses the 'junk' package to identify junk filenames and
 * a custom list to filter out common junk directories.
 */
import { isJunk } from 'junk';
import { ShipError, hasUnbuiltMarker } from '@shipstatic/types';

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
 * Throws if any path contains an unbuilt project marker (e.g. `node_modules`, `package.json`).
 * This check runs first because the dot-file filter below would strip paths like
 * `node_modules/.pnpm/...`, destroying the evidence.
 *
 * A path is filtered out if any of these conditions are met:
 * 1. The basename is identified as junk by the 'junk' package (e.g., .DS_Store, Thumbs.db)
 * 2. Any path segment starts with a dot (e.g., .env, .git, .htaccess)
 *    Exception: `.well-known` is allowed (RFC 8615 — ACME, security.txt, app links)
 * 3. Any path segment exceeds 255 characters (filesystem limit)
 * 4. Any directory segment in the path matches an entry in JUNK_DIRECTORIES (case-insensitive)
 *
 * All path separators are normalized to forward slashes for consistent cross-platform behavior.
 *
 * Dot files are filtered for security — they typically contain sensitive configuration
 * (.env, .git) or are not meant to be served publicly. This matches server-side filtering.
 *
 * @param filePaths - An array of file path strings to filter
 * @param options - Optional settings
 * @param options.allowUnbuilt - When true, skip the unbuilt project marker check (for server-processed uploads)
 * @returns A new array containing only non-junk file paths
 * @throws {ShipError} If any path contains an unbuilt project marker (unless allowUnbuilt is true)
 *
 * @example
 * ```typescript
 * import { filterJunk } from '@shipstatic/ship';
 *
 * // Filter an array of file paths
 * const paths = ['index.html', '.DS_Store', '.gitattributes', '__MACOSX/file.txt', 'app.js'];
 * const clean = filterJunk(paths);
 * // Result: ['index.html', 'app.js']
 * ```
 *
 * @example
 * ```typescript
 * // Use with browser File objects
 * import { filterJunk } from '@shipstatic/ship';
 *
 * const files: File[] = [...]; // From input or drag-drop
 *
 * // Extract paths from File objects
 * const filePaths = files.map(f => f.webkitRelativePath || f.name);
 *
 * // Filter out junk paths
 * const validPaths = new Set(filterJunk(filePaths));
 *
 * // Filter the original File array
 * const validFiles = files.filter(f =>
 *   validPaths.has(f.webkitRelativePath || f.name)
 * );
 * ```
 */
export function filterJunk(
  filePaths: string[],
  options?: { allowUnbuilt?: boolean }
): string[] {
  if (!filePaths || filePaths.length === 0) {
    return [];
  }

  // Reject unbuilt projects before the dot-file filter removes evidence.
  // pnpm stores files under node_modules/.pnpm/ — the dot-file filter below
  // strips .pnpm/ paths, destroying the only signal that this is an unbuilt project.
  if (!options?.allowUnbuilt) {
    const marker = filePaths.find(p => p && hasUnbuiltMarker(p));
    if (marker) {
      throw ShipError.business(
        'Unbuilt project detected — deploy your build output (dist/, build/, out/), not the project folder'
      );
    }
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

    // Filter out dot files and directories (security: prevents .env, .git, etc.)
    // .well-known is not junk — it's a standard directory (RFC 8615)
    // Path position constraints enforced at upload (buildFileKey) and serving (isBlockedDotFile)
    for (const part of parts) {
      if (part === '.well-known') continue;
      if (part.startsWith('.') || part.length > 255) {
        return false;
      }
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
