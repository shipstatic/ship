/**
 * @file Browser-specific file utilities for the Ship SDK.
 * Provides helpers for processing browser files into deploy-ready objects and extracting common directory info.
 */
import { getENV } from './env.js';
import { StaticFile, DeploymentOptions } from '../types.js';
import { calculateMD5 } from './md5.js';
import { ShipError } from '@shipstatic/types';
import { filterJunk } from './junk.js';
import { optimizeDeployPaths } from './deploy-paths.js';


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
 * Calculates MD5, filters junk files, and applies automatic path optimization.
 *
 * @param browserFiles - FileList or File[] to process for deploy.
 * @param options - Processing options including pathDetect for automatic path optimization.
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
  
  // Extract file paths from browser files
  const filePaths = filesArray.map(file => (file as any).webkitRelativePath || file.name);
  
  // Optimize paths for clean deployment URLs
  const deployFiles = optimizeDeployPaths(filePaths, { 
    flatten: options.pathDetect !== false 
  });
  
  // Prepare file information with security validation
  const initialFileInfos: BrowserFileProcessItem[] = [];
  for (let i = 0; i < filesArray.length; i++) {
    const file = filesArray[i];
    const deployPath = deployFiles[i].path;
    
    // Security validation: Ensure no dangerous characters in paths
    if (deployPath.includes('..') || deployPath.includes('\0')) {
      throw ShipError.business(`Security error: Unsafe file path "${deployPath}" for file: ${file.name}`);
    }
    
    initialFileInfos.push({ file, relativePath: deployPath });
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

