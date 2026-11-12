/**
 * @file The paths a deployment's files are published at: web form, with the
 * folder they all share stripped, so the deployment's root is the site's root.
 */

import { filterJunk } from './junk.js';
import { normalizeWebPath } from './path.js';

/** A file's deploy path, beside its own name. */
export interface DeployFile {
  /** The path the file is published at, for example `assets/style.css`. */
  path: string;
  /** The file's own name, the last segment of its path. */
  name: string;
}

/**
 * Each path in web form, with the folder every path shares stripped:
 * `dist/index.html` and `dist/assets/app.js` become `index.html` and
 * `assets/app.js`. `flatten: false` strips nothing.
 */
export function optimizeDeployPaths(
  filePaths: string[],
  options: { flatten?: boolean } = {},
): DeployFile[] {
  const paths = filePaths.map(normalizeWebPath);
  const shared = options.flatten === false ? '' : sharedFolder(paths);
  return paths.map((path) => {
    const name = path.split('/').pop() ?? path;
    const stripped = shared && path.startsWith(`${shared}/`) ? path.slice(shared.length + 1) : path;
    return { path: stripped || name, name };
  });
}

/**
 * Where each file of a site is published: one answer per path, in order, and
 * `null` for a file that is junk (`filterJunk`).
 *
 * Three steps, in the one order that names a site the same way wherever its
 * files came from. The folder every path shares is stripped first, so the
 * folder a person picked is never judged as part of a path. Junk is set aside
 * next. Then the folder the remaining paths share is stripped, because junk
 * beside a site's folder (an unpacked archive's `__MACOSX`, a `.DS_Store`) is
 * what kept that folder from being stripped the first time.
 *
 * `flatten: false` strips nothing: paths are published as they are, and junk
 * is still set aside.
 */
export function sitePaths(paths: string[], options: { flatten?: boolean } = {}): (string | null)[] {
  const named = optimizeDeployPaths(paths, options).map((file) => file.path);
  const site = [...new Set(filterJunk(named))];
  const published = new Map(
    optimizeDeployPaths(site, options).map((file, index) => [site[index], file.path]),
  );
  return named.map((path) => published.get(path) ?? null);
}

/**
 * The deepest folder every path is inside, or `''` when they share none. A
 * path's last segment is its file, never a folder, so one file alone shares
 * its whole folder.
 */
function sharedFolder(paths: string[]): string {
  if (paths.length === 0) return '';
  const folders = paths.map((path) => path.split('/').slice(0, -1));
  const [first = []] = folders;
  let depth = 0;
  while (depth < first.length && folders.every((segments) => segments[depth] === first[depth])) {
    depth++;
  }
  return first.slice(0, depth).join('/');
}
