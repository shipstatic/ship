/**
 * @file A site's junk: the files a tool or an operating system leaves in a
 * folder, which are set aside before a deployment's files are named or judged.
 */

import { hasUnbuiltMarker } from '@shipstatic/types';
import { isJunk } from 'junk';

/**
 * Folders an operating system adds beside a person's files. A file inside one,
 * at any depth, is junk. Compared without case.
 *
 * @internal
 */
export const JUNK_DIRECTORIES = ['__MACOSX', '.Trashes', '.fseventsd', '.Spotlight-V100'] as const;

/**
 * The paths that are not junk, in order.
 *
 * A path is junk when:
 * 1. its file name is one the `junk` package knows (`.DS_Store`, `Thumbs.db`);
 * 2. any of its segments starts with a dot (`.env`, `.git/`), since those
 *    hold configuration or are not meant to be served. `.well-known` is kept
 *    (RFC 8615);
 * 3. any of its folders is in {@link JUNK_DIRECTORIES}.
 *
 * It sets aside and judges nothing. A project's files (`node_modules`,
 * `package.json`) are kept even under a dot folder such as pnpm's
 * `node_modules/.pnpm/`, so the deploy rules refuse an unbuilt project by
 * name; and a path that cannot be published for any other reason (a segment
 * too long, a name with unsafe characters) is kept for those rules to refuse
 * in words. Dropping it here would publish the site without the file and tell
 * nobody.
 *
 * It reads a SITE's files. A project sent for building is never filtered: its
 * source is decided by `@shipstatic/drop`, and a dot file a build reads is
 * source.
 *
 * @example
 * filterJunk(['index.html', '.DS_Store', '.gitattributes', '__MACOSX/file.txt', 'app.js']);
 * // ['index.html', 'app.js']
 */
export function filterJunk(filePaths: string[]): string[] {
  return filePaths.filter((filePath) => {
    if (!filePath) return false;
    if (hasUnbuiltMarker(filePath)) return true;

    const segments = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
    const folders = segments.slice(0, -1);
    const isJunkFolder = (folder: string) =>
      JUNK_DIRECTORIES.some((junk) => junk.toLowerCase() === folder.toLowerCase());

    return !(
      isJunk(segments.at(-1) ?? '') ||
      segments.some((segment) => segment.startsWith('.') && segment !== '.well-known') ||
      folders.some(isJunkFolder)
    );
  });
}
