/**
 * @file A path in web form: forward slashes, none doubled, none leading.
 */

/** A path as a deployment names it, whatever separators its platform wrote. */
export function normalizeWebPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '');
}
