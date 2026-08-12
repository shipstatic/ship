/**
 * @file The Node half of the deploy pipeline: finding files on a filesystem.
 *
 * Everything after the finding is shared (`shared/core/deploy-files.ts`) —
 * path optimization, junk filtering, the platform's rules, the checksums.
 * What is genuinely Node here is a directory walk with symlink-cycle
 * protection, a content path computed against the upload root, and the fact
 * that a Node user can point at a project folder and mean `dist/`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PlatformLimits } from '@shipstatic/types';
import { isShipError, ShipError, UNBUILT_PROJECT_MARKERS } from '@shipstatic/types';
import { type DeploySource, processDeployFiles } from '../../shared/core/deploy-files.js';
import { getENV } from '../../shared/lib/env.js';
import { findCommonParent } from '../../shared/lib/path.js';
import type { DeploymentOptions, StaticFile } from '../../shared/types.js';

/** A file the walk found, carrying the size the walk already had to ask for. */
interface FoundFile {
  absPath: string;
  size: number;
}

/**
 * Walk a directory and return every file under it.
 *
 * Sizes come from the `statSync` this walk performs anyway to tell a
 * directory from a file, which is what lets the shared processor skip empty
 * files without opening one. The pipeline used to stat every file a SECOND
 * time to learn the same number.
 *
 * @param dirPath - Directory to traverse
 * @param visited - Real paths already walked, so a symlink cycle terminates
 */
function findAllFiles(dirPath: string, visited: Set<string> = new Set()): FoundFile[] {
  const results: FoundFile[] = [];

  // Resolve the real path to detect symlink cycles.
  const realPath = fs.realpathSync(dirPath);
  if (visited.has(realPath)) return results;
  visited.add(realPath);

  for (const entry of fs.readdirSync(dirPath)) {
    const fullPath = path.join(dirPath, entry);
    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) results.push(...findAllFiles(fullPath, visited));
    else if (stats.isFile()) results.push({ absPath: fullPath, size: stats.size });
  }

  return results;
}

/**
 * Read a file's bytes, naming it if the filesystem refuses.
 *
 * The wrap spans the filesystem call and nothing else. It used to span the
 * whole per-file body, which meant it caught the typed refusals too and had to
 * re-raise them — an `isShipError(error)` line whose only job was to undo the
 * catch's own overreach. A local read that failed is `ShipError.file` by
 * definition: no request was made and no server rule was being mirrored, so
 * there is no status to report (see CLAUDE.md, "What a status means").
 */
async function readContent(filePath: string): Promise<Buffer> {
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw ShipError.file(`Failed to read file "${filePath}": ${message}`, { filePath });
  }
}

/**
 * Refuse a project folder before walking it.
 *
 * Node-only, and the reason is the input: a Node user types a path and can
 * plausibly type the repository root, where the walk would then enumerate
 * `node_modules`. A browser user picks files. The junk filter refuses the same
 * mistake one step later for the paths it can see; this catches it at the
 * cheapest possible moment, which for a large monorepo is the difference
 * between an immediate answer and a long one.
 */
function refuseUnbuiltProjects(paths: string[]): void {
  for (const p of paths) {
    const absPath = path.resolve(p);
    try {
      if (fs.statSync(absPath).isDirectory()) {
        const marker = fs.readdirSync(absPath).find((e) => UNBUILT_PROJECT_MARKERS.has(e));
        if (marker) {
          throw ShipError.business(
            `"${marker}" detected — deploy your build output (dist/, build/, out/), not the project folder`,
          );
        }
      }
    } catch (e) {
      if (isShipError(e)) throw e;
      // Path errors are reported by the discovery walk below, which names the
      // input the user actually typed.
    }
  }
}

/**
 * Processes Node.js file and directory paths into an array of StaticFile objects ready for deploy.
 * Computes content paths relative to the upload root before filtering, so only the deployed
 * directory structure is evaluated — not the user's filesystem above it.
 *
 * @param paths - File or directory paths to scan and process.
 * @param options - Processing options (pathDetect, etc.).
 * @param platformLimits - Per-instance platform limits (file-size / count /
 *   total-size caps) from the originating Ship's `GET /limits` fetch. Passed
 *   in rather than read from a module global so concurrent Ships against
 *   different API URLs cannot clobber each other's caps.
 * @returns Promise resolving to an array of StaticFile objects.
 * @throws {ShipError} If called outside Node.js or if fs/path modules fail.
 */
export async function processFilesForNode(
  paths: string[],
  options: DeploymentOptions = {},
  platformLimits?: PlatformLimits,
): Promise<StaticFile[]> {
  if (getENV() !== 'node') {
    throw ShipError.business('processFilesForNode can only be called in Node.js environment.');
  }

  refuseUnbuiltProjects(paths);

  // 1. Discover every file under the inputs, deduplicated by absolute path
  //    (two inputs may overlap, and two symlinks may reach one target).
  const found = paths.flatMap((p) => {
    const absPath = path.resolve(p);
    try {
      const stats = fs.statSync(absPath);
      return stats.isDirectory() ? findAllFiles(absPath) : [{ absPath, size: stats.size }];
    } catch (_error) {
      throw ShipError.file(`Path does not exist: ${p}`, { filePath: p });
    }
  });
  const unique = new Map(found.map((file) => [file.absPath, file.size]));

  // 2. The upload root comes from the INPUT paths, not the discovered files:
  //    `ship ./dist` deploys the contents of `dist`, whatever it happens to
  //    contain, so a tree with one deep branch does not strip that branch.
  const inputBasePath = findCommonParent(
    paths
      .map((p) => path.resolve(p))
      .map((p) => {
        try {
          return fs.statSync(p).isDirectory() ? p : path.dirname(p);
        } catch {
          return path.dirname(p);
        }
      }),
  );

  // 3. Hand the shared processor a source per file. Sizes ride along from the
  //    walk; the bytes are read only if the file survives that far.
  const sources: DeploySource[] = [...unique].map(([absPath, size]) => ({
    path: contentPath(absPath, inputBasePath),
    origin: absPath,
    size,
    read: () => readContent(absPath),
  }));

  return processDeployFiles(sources, options, platformLimits);
}

/**
 * The path a file should have relative to the upload root, in web form.
 * Anything the root does not contain falls back to its basename — a file
 * reached through a symlink that points outside the deploy is still deployed,
 * just flat.
 */
function contentPath(absPath: string, inputBasePath: string): string {
  if (inputBasePath && inputBasePath.length > 0) {
    const rel = path.relative(inputBasePath, absPath);
    if (rel && typeof rel === 'string' && !rel.startsWith('..')) {
      return rel.replace(/\\/g, '/');
    }
  }
  return path.basename(absPath);
}
