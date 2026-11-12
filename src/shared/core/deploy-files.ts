/**
 * @file The deploy file pipeline: one sequence, two collectors.
 *
 * A deploy turns what a platform found into what the API receives, and only
 * the finding is platform-shaped. Node walks a filesystem; a browser is
 * handed `File` objects. Everything after is one sequence, stated here once:
 * set the junk aside and name the paths, refuse what the platform's rules
 * refuse, open and hash what is left.
 *
 * The seam is {@link DeploySource}: a path, a size, and a way to open the
 * file. The size sits beside `read()` so that every deploy rule, which reads
 * only a path and a size, is judged before anything is opened: a refused
 * deploy opens no file, however many it holds. What `read()` answers is a
 * `Blob` on every platform, and in Node that is the file on disk, so a file's
 * bytes are in memory only while they are hashed and while they are sent.
 *
 * This is the only code that reads a file before it is sent, so it is where a
 * file that cannot be read is named ({@link reading}).
 */

import type { PlatformLimits, StaticFile } from '@shipstatic/types';
import {
  assertShipJsonSyntax,
  DEPLOYMENT_CONFIG_FILENAME,
  deployRefusal,
  isPublishedFile,
  isShipError,
  ShipError,
} from '@shipstatic/types';
import { optimizeDeployPaths, sitePaths } from '../lib/deploy-paths.js';
import { calculateMD5 } from '../lib/md5.js';
import type { DeploymentOptions } from '../types.js';

/** One file a platform found, before this pipeline has decided anything about it. */
export interface DeploySource {
  /** The path as its platform names it, before the pipeline names it for the site. */
  path: string;
  /** Byte length, known without opening the file: a stat, or `File.size`. */
  size: number;
  /**
   * Opens the file, or refuses what cannot be published (in Node, a link).
   * Called only for a file the deploy would publish.
   */
  read: () => Promise<Blob>;
}

/** What a person is told when a file or a folder cannot be read. */
export function unreadable(path: string): string {
  return `We couldn't read "${path}". Make sure it's on this computer, then try again.`;
}

/**
 * Read what is at `path`, naming it when the read fails. A refusal already in
 * the platform's words passes through as it is.
 */
export async function reading<T>(path: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isShipError(error)) throw error;
    throw ShipError.file(unreadable(path), { filePath: path });
  }
}

/**
 * Turn what a platform found into the files a deploy sends.
 *
 * @param sources - What the platform found, in the platform's own order
 * @param options - Deploy options; `pathDetect` and the build flags are the
 *   ones this pipeline reads
 * @param platformLimits - The caps and the blocklist the deploy read from
 *   `GET /limits`, passed in and never held
 */
export async function processDeployFiles(
  sources: DeploySource[],
  options: DeploymentOptions = {},
  platformLimits?: PlatformLimits,
): Promise<StaticFile[]> {
  // `build` and `prerender` send a project's SOURCE for the build service to
  // compile. Which files a source holds is decided before this pipeline
  // (drop's `projectSource`), so it is carried as it is: no junk is set aside,
  // since a build reads its dot files (`.npmrc`, `.vitepress/`), no empty file
  // is skipped, since an empty module a build imports is source, and no deploy
  // rule applies, since the rules describe a build's OUTPUT.
  const built = Boolean(options.build || options.prerender);
  const flatten = options.pathDetect !== false;
  const found = sources.map((source) => source.path);
  const paths = built
    ? optimizeDeployPaths(found, { flatten }).map((file) => file.path)
    : sitePaths(found, { flatten });

  const kept = sources.flatMap((source, index) => {
    const path = paths[index];
    return path == null ? [] : [{ source, path }];
  });

  // Every rule a site is held to, from the platform's one table, over the
  // files as sent, empty ones included. All of them read paths and sizes.
  if (!built) {
    const sent = kept.map(({ source, path }) => ({ path, size: source.size }));
    const refusal = deployRefusal(sent, requireLimits(platformLimits));
    if (refusal) throw ShipError.validation(refusal);
  }

  const files: StaticFile[] = [];
  for (const { source, path } of kept) {
    // No deployment stores an empty file (`isPublishedFile`), so a site's is
    // never opened.
    if (!built && !isPublishedFile(source)) continue;
    files.push(
      await reading(source.path, async () => {
        const content = await source.read();
        // The one file whose text has a rule: the root `ship.json` must parse
        // as a JSON object. Its schema is the server's to judge.
        if (path === DEPLOYMENT_CONFIG_FILENAME) assertShipJsonSyntax(await content.text());
        // The size declared is the opened content's, so what the manifest
        // states is what the body carries.
        return { path, size: content.size, md5: await calculateMD5(content), content };
      }),
    );
  }
  return files;
}

/**
 * A site is judged by the platform's limits, so their absence is a
 * configuration error, never a pass. `ship.deploy()` always has them: it
 * reads `/limits` once its files are found. A caller of the exported
 * platform processors hands them in, and this sentence is written for them.
 */
function requireLimits(platformLimits?: PlatformLimits): PlatformLimits {
  if (!platformLimits) {
    throw ShipError.config(
      'Platform limits not provided. Deploy-mode validation requires the limits ' +
        'argument: pass the result of `ship.getLimits()`.',
    );
  }
  return platformLimits;
}
