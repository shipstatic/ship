/**
 * @file Browser-specific file utilities for the Ship SDK.
 * Provides helpers for processing browser files into deploy-ready objects and extracting common directory info.
 */
import { getENV } from './env.js';
import { StaticFile, DeploymentOptions } from '../types.js';
import { calculateMD5 } from './md5.js';
import { ShipError } from '@shipstatic/types';
import { findCommonParent, normalizeWebPath } from './path.js';
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
 * @param options - Optional processing options (basePath for path stripping, preserveDirs).
 * @returns Promise resolving to an array of StaticFile objects.
 * @throws {ShipClientError} If called outside a browser or with invalid input.
 */
export async function processFilesForBrowser(
  browserFiles: FileList | File[],
  options: DeploymentOptions = {}
): Promise<StaticFile[]> {
  if (getENV() !== 'browser') {
    throw ShipError.business('processFilesForBrowser can only be called in a browser environment.');
  }

  const filesArray = Array.isArray(browserFiles) ? browserFiles : Array.from(browserFiles);
  
  // Determine common parent for flattening (unified logic) - now default behavior
  let commonParent = '';
  if (!options.preserveDirs) {
    // Default: flatten by finding common parent of all file directories
    const fileDirs = filesArray
      .map(file => (file as any).webkitRelativePath || file.name)
      .filter(path => path)
      .map(filePath => filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '');
    
    commonParent = findCommonParent(fileDirs);
  }

  // Prepare file information with appropriate relative paths
  const initialFileInfos: BrowserFileProcessItem[] = [];
  for (const file of filesArray) {
    let relativePath = (file as any).webkitRelativePath || file.name;
    
    // Apply flattening logic (default behavior unless preserveDirs is true)
    if (commonParent && !options.preserveDirs) {
      relativePath = normalizeWebPath(relativePath);
      const basePathWithSlash = commonParent.endsWith('/') ? commonParent : `${commonParent}/`;
      if (relativePath.startsWith(basePathWithSlash)) {
        relativePath = relativePath.substring(basePathWithSlash.length);
      } else if (relativePath === commonParent) {
        relativePath = '';
      }
    }
    
    // Always normalize to web paths (forward slashes, no leading slash)
    relativePath = normalizeWebPath(relativePath);
    
    // Security validation: Ensure no dangerous characters in paths
    if (relativePath.includes('..') || relativePath.includes('\0')) {
      throw ShipError.business(`Security error: Unsafe file path "${relativePath}" for file: ${file.name}`);
    }
    
    // Ensure path is not empty
    if (!relativePath) {
      relativePath = file.name;
    }
    
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

