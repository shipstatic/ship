/**
 * @file The browser half of the deploy pipeline: reading paths off `File`s.
 *
 * Everything after is shared (`shared/core/deploy-files.ts`) — path
 * optimization, junk filtering, the platform's rules, the checksums. What is
 * genuinely browser here is one line: a directory drop carries
 * `webkitRelativePath`, a file picker does not.
 *
 * There is no size to look up and no content to fetch, because a `File`
 * already is both. That is the whole of this platform's collection step, and
 * it is why the seam the Node side needs (`size` before `read()`) costs
 * nothing on this one.
 */
import type { PlatformLimits } from '@shipstatic/types';
import { ShipError } from '@shipstatic/types';
import { processDeployFiles } from '../../shared/core/deploy-files.js';
import { getENV } from '../../shared/lib/env.js';
import type { DeploymentOptions, StaticFile } from '../../shared/types.js';

/**
 * Processes browser files into an array of StaticFile objects ready for deploy.
 *
 * For server-processed uploads (`build`/`prerender`), the shared processor
 * skips deploy validation — the build service produces and validates the
 * actual deployment output. Those flags are `@internal` and this is their only
 * platform: `web/my` and `web/www` set them through `/upload`.
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
  if (getENV() !== 'browser') {
    throw ShipError.business('processFilesForBrowser can only be called in a browser environment.');
  }

  return processDeployFiles(
    browserFiles.map((file) => ({
      // A directory drop or `<input webkitdirectory>` carries the relative
      // path; a plain file picker leaves it empty and the name is the path.
      path: file.webkitRelativePath || file.name,
      origin: file.name,
      size: file.size,
      // Already in hand — a `File` IS the bytes, and a lazy read here would be
      // a promise wrapping a value the browser handed us at drop time.
      read: async () => file,
    })),
    options,
    platformLimits,
  );
}
