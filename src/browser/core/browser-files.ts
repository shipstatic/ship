/**
 * @file Browser-specific file utilities for the Ship SDK.
 * Provides helpers for processing browser files into deploy-ready objects.
 *
 * Two modes:
 * - **Deploy** (default): Full validation pipeline — security, extensions, sizes, counts.
 * - **Server-processed** (build/prerender): Source files destined for server-side build.
 *   Junk filtering and MD5 checksums only — the build service validates the output.
 *
 * Both modes share: environment check → extract paths → optimize paths → filter junk → MD5.
 */
import type { PlatformLimits } from '@shipstatic/types';
import { ShipError } from '@shipstatic/types';
import { optimizeDeployPaths } from '../../shared/lib/deploy-paths.js';
import { getENV } from '../../shared/lib/env.js';
import { filterJunk } from '../../shared/lib/junk.js';
import { calculateMD5 } from '../../shared/lib/md5.js';
import { validateDeployFile, validateDeployPath } from '../../shared/lib/security.js';
import type { DeploymentOptions, StaticFile } from '../../shared/types.js';

/**
 * Processes browser files into an array of StaticFile objects ready for deploy.
 * Calculates MD5, filters junk files, validates sizes, and applies path optimization.
 *
 * For server-processed uploads (build/prerender), client-side deploy validation is
 * skipped — the build service produces and validates the actual deployment output.
 *
 * @param browserFiles - File[] to process for deploy.
 * @param options - Processing options including pathDetect for automatic path optimization.
 * @param platformLimits - Per-instance platform limits (file-size / count / total-size caps)
 *   from the originating Ship's `GET /limits` fetch. Passed in rather than read from a
 *   module global so concurrent Ships against different API URLs cannot clobber each
 *   other's caps.
 * @returns Promise resolving to an array of StaticFile objects.
 * @throws {ShipError} If called outside a browser or with invalid input.
 */
export async function processFilesForBrowser(
  browserFiles: File[],
  options: DeploymentOptions = {},
  platformLimits?: PlatformLimits,
): Promise<StaticFile[]> {
  // 1. Environment check
  if (getENV() !== 'browser') {
    throw ShipError.business('processFilesForBrowser can only be called in a browser environment.');
  }

  // 2. Extract raw paths from File objects
  const rawPaths = browserFiles.map((file) => file.webkitRelativePath || file.name);

  // Server-processed uploads (build/prerender) send source files, not deploy output
  const isServerProcessed = options.build || options.prerender;

  // 3. Optimize paths for deployment (strip common root, flatten)
  const deployFiles = optimizeDeployPaths(rawPaths, { flatten: options.pathDetect !== false });
  const deployPaths = deployFiles.map((f) => f.path);

  // 4. Filter junk from deploy paths (allowUnbuilt for server-processed)
  const filteredSet = new Set(filterJunk(deployPaths, { allowUnbuilt: isServerProcessed }));
  const validPairs: Array<{ file: File; deployPath: string }> = [];
  for (let i = 0; i < browserFiles.length; i++) {
    if (filteredSet.has(deployPaths[i])) {
      validPairs.push({ file: browserFiles[i], deployPath: deployFiles[i].path });
    }
  }

  if (validPairs.length === 0) {
    return [];
  }

  // 5. Server-processed: skip deploy validation, just compute checksums
  if (isServerProcessed) {
    const results: StaticFile[] = [];
    for (let i = 0; i < validPairs.length; i++) {
      const { file, deployPath } = validPairs[i];
      if (file.size === 0) continue;
      const { md5 } = await calculateMD5(file);
      results.push({ path: deployPath, content: file, size: file.size, md5 });
    }
    return results;
  }

  // 6. Deploy: full validation pipeline
  if (!platformLimits) {
    throw ShipError.config(
      'Platform limits not provided. processFilesForBrowser requires the limits ' +
        'argument for deploy-mode validation — pass `ship.getLimits()` result.',
    );
  }
  const results: StaticFile[] = [];
  let totalSize = 0;

  for (let i = 0; i < validPairs.length; i++) {
    const { file, deployPath } = validPairs[i];

    // Security validation (shared with Node)
    validateDeployPath(deployPath, file.name);

    // Skip empty files — R2 cannot store zero-byte objects
    if (file.size === 0) {
      continue;
    }

    // Name, extension and both size caps — the SAME ordered table the Node
    // pipeline calls. Parity is structural now rather than a comment saying
    // "matches Node validation".
    totalSize += file.size;
    validateDeployFile({ path: deployPath, size: file.size, totalSize }, platformLimits);

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
    throw ShipError.business(
      `Too many files to deploy. Maximum allowed is ${platformLimits.maxFilesCount} files.`,
    );
  }

  return results;
}
