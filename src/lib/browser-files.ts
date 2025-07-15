/**
 * @file Browser-specific file utilities for the Ship SDK.
 * Provides helpers for processing browser files into deploy-ready objects and extracting common directory info.
 */
import { getENV } from './env.js';
import { StaticFile } from '../types.js';
import { calculateMD5 } from './md5.js';
import { ShipError } from '@shipstatic/types';
import { findCommonParentDirectory, normalizeWebPath } from './path.js';
import { filterJunk } from './junk.js';


/**
 * Internal structure representing a browser file to be processed for deploy.
 * @internal
 */
interface BrowserFileProcessItem {
  file: File;
  relativePath: string;
}

/**
 * Processes browser files (FileList or File[]) into an array of StaticFile objects ready for deploy.
 * Calculates MD5, filters junk files, and determines relative paths (stripping basePath if provided).
 *
 * @param browserFiles - FileList or File[] to process for deploy.
 * @param options - Optional processing options (basePath for path stripping, stripCommonPrefix).
 * @returns Promise resolving to an array of StaticFile objects.
 * @throws {ShipClientError} If called outside a browser or with invalid input.
 */
export async function processFilesForBrowser(
  browserFiles: FileList | File[],
  options: { explicitBaseDirInput?: string; stripCommonPrefix?: boolean } = {}
): Promise<StaticFile[]> {
  if (getENV() !== 'browser') {
    throw ShipError.business('processFilesForBrowser can only be called in a browser environment.');
  }

  const { explicitBaseDirInput, stripCommonPrefix } = options;
  const initialFileInfos: BrowserFileProcessItem[] = [];
  const filesArray = Array.isArray(browserFiles) ? browserFiles : Array.from(browserFiles);
  
  // If stripCommonPrefix is true and no explicit basePath is provided,
  // Determine the parent directory for path stripping if applicable
  let parentDir = '';
  if (stripCommonPrefix) {
    parentDir = findBrowserCommonParentDirectory(browserFiles);
  } else if (explicitBaseDirInput) {
    parentDir = explicitBaseDirInput;
  }

  // Prepare the initial file information with appropriate relative paths
  for (const file of filesArray) {
    let relativePath = (file as any).webkitRelativePath || file.name;
    if (parentDir) {
      // Normalize all paths to use forward slashes
      relativePath = normalizeWebPath(relativePath);
      const basePathWithSlash = parentDir.endsWith('/') ? parentDir : `${parentDir}/`;
      // Robustly strip deeply nested basePath prefix
      if (relativePath === parentDir || relativePath === basePathWithSlash || relativePath.startsWith(basePathWithSlash)) {
        relativePath = relativePath.substring(basePathWithSlash.length);
      }
    }
    // Always normalize output path to forward slashes
    relativePath = normalizeWebPath(relativePath);
    initialFileInfos.push({ file, relativePath });
  }

  // Filter out junk files
  const allRelativePaths = initialFileInfos.map(info => info.relativePath);
  const nonJunkRelativePathsArray = filterJunk(allRelativePaths);
  const nonJunkRelativePathsSet = new Set(nonJunkRelativePathsArray);

  // Create StaticFile objects for each valid file
  const result: StaticFile[] = [];
  for (const fileInfo of initialFileInfos) {
    // Skip junk files and empty files
    if (!nonJunkRelativePathsSet.has(fileInfo.relativePath) || fileInfo.file.size === 0) {
      continue;
    }
    
    // Calculate MD5 hash
    const { md5 } = await calculateMD5(fileInfo.file);
    
    // Create and add the StaticFile
    result.push({
      content: fileInfo.file,
      path: fileInfo.relativePath,
      size: fileInfo.file.size,
      md5,
    });
  }
  
  return result;
}

/**
 * Finds the common parent directory from a FileList or File[] using webkitRelativePath.
 * Useful for stripping a common prefix if files are selected from a single folder.
 *
 * @param files - FileList or File[] to analyze.
 * @returns Common parent directory string, or empty string if not consistent.
 * @throws {ShipClientError} If called outside a browser.
 */
export function findBrowserCommonParentDirectory(files: FileList | File[]): string {
  if (getENV() !== 'browser') {
    throw ShipError.business('findBrowserCommonParentDirectory can only be called in a browser environment.');
  }
  if (!files || files.length === 0) return '';
  
  const paths: (string | null | undefined)[] = Array.from(files)
    .map(file => (file as any).webkitRelativePath);

  // If any file is missing webkitRelativePath, we can't determine a common parent.
  if (paths.some(p => !p)) {
    return '';
  }

  return findCommonParentDirectory(paths as string[], '/');
}
