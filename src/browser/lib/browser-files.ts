/**
 * @file Browser-specific file utilities for the Ship SDK.
 * Provides helpers for processing browser files into deploy-ready objects.
 *
 * Two modes:
 * - **Deploy** (default): Full validation pipeline — security, extensions, sizes, counts.
 * - **Server-processed** (build/prerender): Source files destined for server-side build.
 *   Junk filtering and MD5 checksums only — the build service validates the output.
 *
 * Both modes share: environment check → extract paths → filter junk → optimize paths → MD5.
 */
import type { StaticFile, DeploymentOptions } from '../../shared/types.js';
import { calculateMD5 } from '../../shared/lib/md5.js';
import { ShipError } from '@shipstatic/types';
import { getENV } from '../../shared/lib/env.js';
import { filterJunk } from '../../shared/lib/junk.js';
import { optimizeDeployPaths } from '../../shared/lib/deploy-paths.js';
import { validateDeployPath, validateDeployFile } from '../../shared/lib/security.js';
import { getCurrentConfig } from '../../shared/core/platform-config.js';

/**
 * Processes browser files into an array of StaticFile objects ready for deploy.
 * Calculates MD5, filters junk files, validates sizes, and applies path optimization.
 *
 * For server-processed uploads (build/prerender), client-side deploy validation is
 * skipped — the build service produces and validates the actual deployment output.
 *
 * @param browserFiles - File[] to process for deploy.
 * @param options - Processing options including pathDetect for automatic path optimization.
 * @returns Promise resolving to an array of StaticFile objects.
 * @throws {ShipError} If called outside a browser or with invalid input.
 */
export async function processFilesForBrowser(
  browserFiles: File[],
  options: DeploymentOptions = {}
): Promise<StaticFile[]> {
  // 1. Environment check
  if (getENV() !== 'browser') {
    throw ShipError.business('processFilesForBrowser can only be called in a browser environment.');
  }

  // 2. Extract raw paths from File objects
  const rawPaths = browserFiles.map(file => file.webkitRelativePath || file.name);

  // Server-processed uploads (build/prerender) send source files, not deploy output
  const isServerProcessed = options.build || options.prerender;

  // 3. Filter junk files (allowUnbuilt for server-processed — source projects have package.json etc.)
  const nonJunkSet = new Set(filterJunk(rawPaths, { allowUnbuilt: isServerProcessed }));
  const validPairs: Array<{ file: File; rawPath: string }> = [];
  for (let i = 0; i < browserFiles.length; i++) {
    if (nonJunkSet.has(rawPaths[i])) {
      validPairs.push({ file: browserFiles[i], rawPath: rawPaths[i] });
    }
  }

  if (validPairs.length === 0) {
    return [];
  }

  // 4. Optimize paths for clean deployment URLs
  const deployFiles = optimizeDeployPaths(
    validPairs.map(p => p.rawPath),
    { flatten: options.pathDetect !== false }
  );

  // 5. Server-processed: skip deploy validation, just compute checksums
  if (isServerProcessed) {
    const results: StaticFile[] = [];
    for (let i = 0; i < validPairs.length; i++) {
      const { file } = validPairs[i];
      if (file.size === 0) continue;
      const { md5 } = await calculateMD5(file);
      results.push({ path: deployFiles[i].path, content: file, size: file.size, md5 });
    }
    return results;
  }

  // 6. Deploy: full validation pipeline
  const platformLimits = getCurrentConfig();
  const results: StaticFile[] = [];
  let totalSize = 0;

  for (let i = 0; i < validPairs.length; i++) {
    const { file } = validPairs[i];
    const deployPath = deployFiles[i].path;

    // Security validation (shared with Node)
    validateDeployPath(deployPath, file.name);

    // Skip empty files — R2 cannot store zero-byte objects
    if (file.size === 0) {
      continue;
    }

    // Filename and extension validation (shared with Node)
    validateDeployFile(deployPath, file.name);

    // Validate file sizes (matches Node validation)
    if (file.size > platformLimits.maxFileSize) {
      throw ShipError.business(`File ${file.name} is too large. Maximum allowed size is ${platformLimits.maxFileSize / (1024 * 1024)}MB.`);
    }
    totalSize += file.size;
    if (totalSize > platformLimits.maxTotalSize) {
      throw ShipError.business(`Total deploy size is too large. Maximum allowed is ${platformLimits.maxTotalSize / (1024 * 1024)}MB.`);
    }

    // Calculate MD5 hash
    const { md5 } = await calculateMD5(file);

    results.push({
      path: deployPath,
      content: file,
      size: file.size,
      md5,
    });
  }

  // Validate file count (matches Node validation)
  if (results.length > platformLimits.maxFilesCount) {
    throw ShipError.business(`Too many files to deploy. Maximum allowed is ${platformLimits.maxFilesCount} files.`);
  }

  return results;
}
