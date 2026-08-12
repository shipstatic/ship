/**
 * @file The deploy file pipeline — one processor, two collectors.
 *
 * A deploy turns *what a platform found* into *what the API receives*, and
 * only the first half of that sentence is platform-shaped. Node walks a
 * filesystem; a browser is handed `File` objects. Everything after — optimize
 * the paths, drop the junk, refuse what the platform's rules refuse, checksum
 * what survives — is one sequence, stated here once.
 *
 * The seam is {@link DeploySource}: a path, where it came from, its size, and
 * a way to read it. That shape is what lets Node answer "how big is this?"
 * from the stat its directory walk already performed, which is how the empty-
 * file skip stays free — and it is why `read()` is a FUNCTION rather than a
 * field. The processor calls it for files that survive filtering and
 * validation and for no others, so a deploy refused at file three never opens
 * files four through nine hundred.
 */

import type { PlatformLimits, StaticFile } from '@shipstatic/types';
import { ShipError } from '@shipstatic/types';
import { optimizeDeployPaths } from '../lib/deploy-paths.js';
import { filterJunk } from '../lib/junk.js';
import { calculateMD5 } from '../lib/md5.js';
import { validateDeployFile, validateDeployPath } from '../lib/security.js';
import type { DeploymentOptions } from '../types.js';

/**
 * One file a platform found, before this pipeline has decided anything about
 * it. The only thing a collector owes beyond the bytes is where they came
 * from and how many there are.
 */
export interface DeploySource {
  /** The path this file wants, as its platform names it — pre-optimization. */
  path: string;
  /**
   * Where the file came from, named in the security refusal: an absolute
   * filesystem path in Node, a `File.name` in the browser. It is what makes
   * an unsafe deploy path traceable back to the thing that produced it.
   */
  origin: string;
  /** Byte length, known WITHOUT reading — a stat, or `File.size`. */
  size: number;
  /** Reads the content. Called only for files that survive to the checksum. */
  read: () => Promise<StaticFile['content']>;
}

/**
 * Turn collected sources into the `StaticFile[]` a deploy body is built from.
 *
 * @param sources - What the platform found, in the platform's own order
 * @param options - Deploy options; `pathDetect` and the server-processed flags
 *   are the two this pipeline reads
 * @param platformLimits - The caps and the delivered blocklist from
 *   `GET /limits`. Per-instance rather than a module global, so two Ships
 *   against different API URLs cannot clobber each other's rules.
 */
export async function processDeployFiles(
  sources: DeploySource[],
  options: DeploymentOptions = {},
  platformLimits?: PlatformLimits,
): Promise<StaticFile[]> {
  // `build` / `prerender` upload SOURCE files for the build service to
  // compile. The deploy rules describe its OUTPUT, so they are not this
  // pipeline's to apply — and the unbuilt-project refusal would reject
  // precisely the input the flags exist to accept. Both flags are `@internal`
  // and set only by `web/my` and `web/www`, which are browser apps; there is
  // no Node caller. That asymmetry lives in the callers, which is why it needs
  // no second copy of the loop here.
  const serverProcessed = !!(options.build || options.prerender);

  const deployPaths = optimizeDeployPaths(
    sources.map((source) => source.path),
    { flatten: options.pathDetect !== false },
  ).map((file) => file.path);

  const surviving = new Set(filterJunk(deployPaths, { allowUnbuilt: serverProcessed }));
  const kept = sources
    .map((source, index) => ({ source, deployPath: deployPaths[index] }))
    .filter(({ deployPath }) => surviving.has(deployPath));

  // Nothing to deploy is not a failure, and it is answered before the rules
  // are demanded: a directory of pure junk resolves empty rather than
  // complaining about limits it was never going to consult.
  if (kept.length === 0) return [];

  // The rules, or none. `null` is server-processed mode — the one state where
  // this pipeline judges nothing — so every check below reads as what it is:
  // we validate when we have something to validate against.
  const rules = serverProcessed ? null : requireLimits(platformLimits);

  const files: StaticFile[] = [];
  let totalSize = 0;

  for (const { source, deployPath } of kept) {
    // Fail fast, before any I/O: an unsafe path is refused on the strength of
    // the path alone.
    if (rules) validateDeployPath(deployPath, source.origin);

    // R2 cannot store zero-byte objects. The size is already in hand, so this
    // costs nothing and reads nothing.
    if (source.size === 0) continue;

    if (rules) {
      // Name, extension and both size caps — ONE ordered table
      // (`shared/lib/file-rules.ts`), shared with the collecting renderer the
      // UI tier uses. `totalSize` INCLUDES this file, which the total-size
      // rule relies on.
      totalSize += source.size;
      validateDeployFile({ path: deployPath, size: source.size, totalSize }, rules);
    }

    const content = await source.read();
    const { md5 } = await calculateMD5(content);
    files.push({ path: deployPath, content, size: source.size, md5 });
  }

  // Counted over RESULTS, not over candidates: empty files were skipped above
  // and a deploy is not over the cap for files it will not send.
  if (rules && files.length > rules.maxFilesCount) {
    throw ShipError.business(
      `Too many files to deploy. Maximum allowed is ${rules.maxFilesCount} files.`,
    );
  }

  return files;
}

/**
 * Deploy-mode validation is only as real as the rules behind it, so their
 * absence is a configuration error rather than a silently permissive pass.
 * Unreachable through `ship.deploy()` — the deploy pipeline awaits the
 * `/limits` fetch before it collects a file — and reachable by a consumer
 * calling the exported platform processors directly, which is who the
 * sentence is written for.
 */
function requireLimits(platformLimits?: PlatformLimits): PlatformLimits {
  if (!platformLimits) {
    throw ShipError.config(
      'Platform limits not provided. Deploy-mode validation requires the limits ' +
        'argument — pass `ship.getLimits()` result.',
    );
  }
  return platformLimits;
}
