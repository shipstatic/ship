/**
 * @file The deploy request bodies: one builder, both platforms.
 *
 * A deploy is declared, then filled: the declaration carries the manifest,
 * the deployment's options and any of its files, and each fill carries more
 * of its files (`POST /deployments/:deployment/files`). A deployment that fits
 * one request is declared with every file, which is the whole deploy. None of
 * that differs by platform: the platform seam lives only where it is genuine,
 * in how each platform COLLECTS files (`processInput`).
 *
 * Every body is a native `FormData`: `fetch` sets the boundary and the
 * `Content-Type` itself, which is why nothing here composes headers. Global
 * `FormData`, `File` and a multipart-encoding `fetch` exist on every runtime
 * the SDK targets (`engines.node >= 20.19.0`, bun), and a `FormData` posted
 * through `fetch` arrives with `filename="assets/nested/index.html"` intact:
 * the deploy PATH rides `File.name`, so that verbatim round trip is the whole
 * file contract.
 *
 * The declaration's text fields are stated once, in order, by
 * {@link deployFields}, and both the body and the planner read that list
 * (`deploy-plan.ts`), so what is counted is what is sent.
 */

import { DEPLOY_FIELDS, type ManifestEntry, ShipError } from '@shipstatic/types';
import type { DeployBodyContext, StaticFile } from '../types.js';

/** One text field of a deploy body: its name and its value, as sent. */
export type DeployField = readonly [name: string, value: string];

/**
 * The deployment's manifest: every file it holds, by path, size and MD5. The
 * API checks each arriving file against its entry and R2 checks its bytes
 * against the digest, so a deploy is verified whatever count of requests
 * carries it.
 */
export function deployManifest(files: StaticFile[]): ManifestEntry[] {
  return files.map((file) => {
    if (!file.md5) {
      throw ShipError.file(`MD5 missing for file: ${file.path}`, { filePath: file.path });
    }
    return { path: file.path, size: file.size, md5: file.md5 };
  });
}

/**
 * The declaration's text fields, in the order the body carries them: the
 * manifest, then each option the caller set.
 */
export function deployFields(
  manifest: ManifestEntry[],
  context: DeployBodyContext = {},
): DeployField[] {
  const { labels, via, password, ttl, flags, captcha } = context;
  const fields: DeployField[] = [[DEPLOY_FIELDS.MANIFEST, JSON.stringify(manifest)]];
  if (labels && labels.length > 0) fields.push([DEPLOY_FIELDS.LABELS, JSON.stringify(labels)]);
  if (via) fields.push([DEPLOY_FIELDS.VIA, via]);
  if (password) fields.push([DEPLOY_FIELDS.PASSWORD, password]);
  // A multipart field is text; `ttl` is the DURATION in seconds and the API
  // turns it into an instant against its own clock. `!== undefined` rather
  // than truthiness: the rule already refuses 0, and a truthiness test would
  // drop it silently instead of letting the caller hear why.
  if (ttl !== undefined) fields.push([DEPLOY_FIELDS.TTL, String(ttl)]);
  if (flags?.build) fields.push([DEPLOY_FIELDS.BUILD, 'true']);
  if (flags?.prerender) fields.push([DEPLOY_FIELDS.PRERENDER, 'true']);
  if (flags?.spa) fields.push([DEPLOY_FIELDS.SPA, 'true']);
  if (flags?.buildCommand) fields.push([DEPLOY_FIELDS.BUILD_COMMAND, flags.buildCommand]);
  if (flags?.outputDir) fields.push([DEPLOY_FIELDS.OUTPUT_DIR, flags.outputDir]);
  if (captcha) fields.push([DEPLOY_FIELDS.CAPTCHA, captcha]);
  return fields;
}

/** Append each file as a `files[]` part named by its deploy path. */
function appendFiles(formData: FormData, files: StaticFile[]): void {
  for (const file of files) {
    // An ASSERTION, not a wire rule: `StaticFile.content` is typed
    // `File | Buffer | Blob` and both pipelines produce one of those, so
    // reaching here means an internal bug rather than bad user input. It
    // names the path because that is the only thing that makes such a bug
    // findable. (`Buffer` is a `Uint8Array`, so all three are `BlobPart`s.)
    if (typeof file.content === 'string' || file.content === null || file.content === undefined) {
      throw ShipError.file(`Unsupported file.content type: ${file.path}`, {
        filePath: file.path,
      });
    }

    // The deploy PATH is the filename — the API reads it off `File.name` and
    // stores the file there. The API derives Content-Type from the extension,
    // so the part's own type is deliberately opaque.
    // The cast is the two type libraries failing to agree, not a widening:
    // `Buffer` IS a `Uint8Array` and therefore a `BufferSource`, but this
    // package builds against both node and DOM lib types and
    // `Buffer<ArrayBufferLike>` does not unify with the DOM's `BlobPart`.
    // The guard above is what actually narrows the value.
    formData.append(
      DEPLOY_FIELDS.FILES,
      new File([file.content as BlobPart], file.path, { type: 'application/octet-stream' }),
    );
  }
}

/** The declaration: the files it carries, then its text fields. */
export function createDeployBody(files: StaticFile[], fields: DeployField[]): FormData {
  const formData = new FormData();
  appendFiles(formData, files);
  for (const [name, value] of fields) formData.append(name, value);
  return formData;
}

/** A fill: files and nothing else, since the declaration stated the rest. */
export function createFillBody(files: StaticFile[]): FormData {
  const formData = new FormData();
  appendFiles(formData, files);
  return formData;
}
