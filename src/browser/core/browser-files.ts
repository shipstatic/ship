/**
 * @file The browser half of the deploy pipeline: reading paths off `File`s.
 *
 * Everything after is shared (`shared/core/deploy-files.ts`). What is the
 * browser's own is one line: a folder drop carries `webkitRelativePath`, and a
 * file picker does not. A `File` already is its size and its bytes, so there
 * is nothing to look up and nothing to open.
 */
import type { PlatformLimits } from '@shipstatic/types';
import { ShipError } from '@shipstatic/types';
import { processDeployFiles } from '../../shared/core/deploy-files.js';
import { getENV } from '../../shared/lib/env.js';
import type { DeploymentOptions, StaticFile } from '../../shared/types.js';

/**
 * The files a person picked or dropped, ready to deploy.
 *
 * @param browserFiles - The `File`s
 * @param options - Deploy options (`pathDetect`, and the build flags the
 *   platform's own apps set)
 * @param platformLimits - The limits the deploy read from `GET /limits`.
 *   Passed in, never held, so a deploy is always judged by the limits the
 *   server states now.
 */
export async function processFilesForBrowser(
  browserFiles: File[],
  options: DeploymentOptions = {},
  platformLimits?: PlatformLimits,
): Promise<StaticFile[]> {
  if (getENV() !== 'browser') {
    throw ShipError.business('processFilesForBrowser can only be called in a browser environment.');
  }

  return processDeployFiles(
    browserFiles.map((file) => ({
      // A folder drop or `<input webkitdirectory>` carries the relative path;
      // a plain file picker leaves it empty and the name is the path.
      path: file.webkitRelativePath || file.name,
      size: file.size,
      read: async () => file,
    })),
    options,
    platformLimits,
  );
}
