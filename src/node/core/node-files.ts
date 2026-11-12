/**
 * @file The Node half of the deploy pipeline: finding files on a filesystem.
 *
 * Everything after the finding is shared (`shared/core/deploy-files.ts`).
 * What is Node's own is a walk that follows no link, a path for each file
 * relative to the path the person typed, and the fact that a person can type
 * a project folder and mean the folder its build makes.
 */

import { openAsBlob } from 'node:fs';
import { lstat, readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import type { PlatformLimits } from '@shipstatic/types';
import { ShipError, UNBUILT_PROJECT_MARKERS } from '@shipstatic/types';
import { type DeploySource, processDeployFiles, reading } from '../../shared/core/deploy-files.js';
import { getENV } from '../../shared/lib/env.js';
import type { DeploymentOptions, StaticFile } from '../../shared/types.js';

/** An entry the walk found, with the size the filesystem states for it. */
interface FoundFile {
  absPath: string;
  size: number;
  /** A link is found and never followed. */
  link: boolean;
}

/** What one typed path gives the deploy: its files, and the folder they are named from. */
interface Found {
  base: string;
  files: FoundFile[];
}

/**
 * Every file under a folder, and every link, which is found as an entry and
 * never followed. Anything else a folder can hold (a socket, a pipe) is not a
 * file and is not found.
 *
 * The walk reads no link, so it cannot leave the folder it was given and
 * cannot go round. A folder someone else made can hold a link to anywhere on
 * this computer, and following it would publish files the person never chose,
 * under a name the dot-file rule cannot see through.
 */
async function findFiles(folder: string): Promise<FoundFile[]> {
  const files: FoundFile[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const absPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await reading(absPath, () => findFiles(absPath))));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      const { size } = await reading(absPath, () => lstat(absPath));
      files.push({ absPath, size, link: entry.isSymbolicLink() });
    }
  }
  return files;
}

/** A link is refused by name where the deploy would open it. */
async function refuseLink(absPath: string): Promise<never> {
  throw ShipError.file(
    `"${absPath}" is a link, and we don't publish links. Copy what it points to into the folder, then try again.`,
    { filePath: absPath },
  );
}

/**
 * Refuse a project folder before walking it.
 *
 * Node's alone, because of the input: a person types a path and can type the
 * repository root, where the walk would read all of `node_modules` before the
 * deploy rules refused the same mistake.
 */
async function refuseUnbuiltProject(folder: string, typed: string): Promise<void> {
  const marker = (await readdir(folder)).find((entry) => UNBUILT_PROJECT_MARKERS.has(entry));
  if (marker) {
    throw ShipError.validation(
      `"${typed}" is a project that isn't built yet: it has ${marker}. Build it, then publish the folder the build makes, like dist.`,
    );
  }
}

/**
 * What one typed path holds: a folder's files, or the one file it names. A
 * typed path is taken as typed, so one that is a link is read through.
 */
async function find(typed: string): Promise<Found> {
  const absPath = path.resolve(typed);
  const stats = await reading(absPath, async () => {
    try {
      return await stat(absPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      throw ShipError.file(`We couldn't find "${typed}". Check the path, then try again.`, {
        filePath: typed,
      });
    }
  });

  if (stats.isFile()) {
    return { base: path.dirname(absPath), files: [{ absPath, size: stats.size, link: false }] };
  }
  if (!stats.isDirectory()) {
    throw ShipError.file(`"${typed}" isn't a file or a folder.`, { filePath: typed });
  }
  return reading(absPath, async () => {
    await refuseUnbuiltProject(absPath, typed);
    return { base: absPath, files: await findFiles(absPath) };
  });
}

/**
 * What the paths a person typed hold, as the shared pipeline takes it. It
 * needs no limits and makes no request, so a path that is not there, a
 * project that is not built and a folder that cannot be read are each refused
 * before the deploy asks the platform anything.
 *
 * Each typed path names its own files: a folder's are relative to the folder,
 * and a file is its own name. So `ship ./dist` publishes what is in `dist`,
 * and what a path holds never changes where another's files land. A file
 * reached by two typed paths is one source, named by the first.
 */
export async function findSources(paths: string[]): Promise<DeploySource[]> {
  const sources = new Map<string, DeploySource>();
  for (const { base, files } of await Promise.all(paths.map(find))) {
    for (const { absPath, size, link } of files) {
      if (sources.has(absPath)) continue;
      sources.set(absPath, {
        path: path.relative(base, absPath),
        size,
        // The file itself, as a `Blob`: nothing is read until it is hashed or
        // sent. A link is a source like any file, so one inside what the
        // deploy sets aside is set aside with it, and one the deploy would
        // publish is refused when the deploy opens it.
        read: link ? () => refuseLink(absPath) : () => openAsBlob(absPath),
      });
    }
  }
  return [...sources.values()];
}

/**
 * The files under the paths a person typed, ready to deploy.
 *
 * @param paths - File or folder paths
 * @param options - Deploy options (`pathDetect` and the rest)
 * @param platformLimits - The limits the deploy read from `GET /limits`.
 *   Passed in, never held, so a deploy is always judged by the limits the
 *   server states now.
 */
export async function processFilesForNode(
  paths: string[],
  options: DeploymentOptions = {},
  platformLimits?: PlatformLimits,
): Promise<StaticFile[]> {
  if (getENV() !== 'node') {
    throw ShipError.business('processFilesForNode can only be called in Node.js environment.');
  }
  return processDeployFiles(await findSources(paths), options, platformLimits);
}
