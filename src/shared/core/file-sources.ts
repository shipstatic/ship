/**
 * @file `File`s as deploy sources: the input every runtime takes.
 *
 * A browser, a Worker, Node, Bun and Deno all have `File`, so a deploy of
 * `File`s is the one input that works wherever this SDK runs. A `File`
 * already is its size and its bytes, so there is nothing to look up and
 * nothing to open: the only thing read here is its path.
 */

import type { DeploySource } from './deploy-files.js';

/** Whether a deploy's input is a list of `File`s. */
export function isFiles(input: unknown): input is File[] {
  return Array.isArray(input) && input.every((item) => item instanceof File);
}

/** Each `File` as the shared pipeline takes it. */
export function fileSources(files: File[]): DeploySource[] {
  return files.map((file) => ({
    // A folder drop or `<input webkitdirectory>` carries the relative path;
    // anywhere else the name is the path, and may hold folders (`css/app.css`).
    path: file.webkitRelativePath || file.name,
    size: file.size,
    read: async () => file,
  }));
}
