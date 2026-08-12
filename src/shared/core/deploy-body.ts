/**
 * @file The deploy request body — one builder, both platforms.
 *
 * A deploy is one multipart POST: the files, their checksums, and the
 * deployment metadata that rides beside them. None of that differs by
 * platform, and since 2026-08-12 nothing here does either.
 *
 * **It was two files, and the second existed only to hand-encode.** Node built
 * its FormData with `formdata-node` and serialized it through
 * `form-data-encoder` into an ArrayBuffer with a hand-computed
 * `Content-Type` and `Content-Length`, because those objects are not the ones
 * undici's `fetch` knows how to encode. That was a real constraint on a Node
 * without a global `FormData` — and `engines.node >= 20` has had global
 * `FormData`, `File` and a multipart-encoding `fetch` all along, so the
 * constraint had already lapsed. Verified on both runtimes the SDK targets
 * (node 22, bun 1.3): a native `FormData` posted through `fetch` arrives as
 * multipart with `filename="assets/nested/index.html"` intact — the deploy
 * PATH rides `File.name`, so that verbatim round trip is the whole contract.
 *
 * What the two files actually shared was every line that mattered; what they
 * differed on was a content type-check. So the check became one, and the
 * platform seam moved off the body entirely — it now lives only where it is
 * genuine, in how each platform COLLECTS files (`processInput`).
 */

import { DEPLOY_FIELDS, ShipError } from '@shipstatic/types';
import type { DeployBodyContext, StaticFile } from '../types.js';

/**
 * Build the multipart body for a deploy.
 *
 * Returns a native `FormData`: `fetch` sets the boundary and the
 * `Content-Type` itself, which is why nothing here composes headers. Passing
 * a hand-encoded buffer with a hand-written boundary was the old shape, and
 * every part of it was a way of doing what the runtime does.
 */
export async function createDeployBody(
  files: StaticFile[],
  context: DeployBodyContext = {},
): Promise<FormData> {
  const { labels, via, password, ttl, flags, captcha } = context;
  const formData = new FormData();
  const checksums: string[] = [];

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

    if (!file.md5) {
      throw ShipError.file(`File missing md5 checksum: ${file.path}`, { filePath: file.path });
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
    checksums.push(file.md5);
  }

  // Index-aligned with the files above — the API checks the two lengths match.
  formData.append(DEPLOY_FIELDS.CHECKSUMS, JSON.stringify(checksums));

  if (labels && labels.length > 0) formData.append(DEPLOY_FIELDS.LABELS, JSON.stringify(labels));
  if (via) formData.append(DEPLOY_FIELDS.VIA, via);
  if (password) formData.append(DEPLOY_FIELDS.PASSWORD, password);
  // A multipart field is text; `ttl` is the DURATION in seconds and the API
  // turns it into an instant against its own clock. `!== undefined` rather
  // than truthiness — the rule already refuses 0, and a truthiness test would
  // drop it silently instead of letting the caller hear why.
  if (ttl !== undefined) formData.append(DEPLOY_FIELDS.TTL, String(ttl));
  if (flags?.build) formData.append(DEPLOY_FIELDS.BUILD, 'true');
  if (flags?.prerender) formData.append(DEPLOY_FIELDS.PRERENDER, 'true');
  if (flags?.spa) formData.append(DEPLOY_FIELDS.SPA, 'true');
  if (captcha) formData.append(DEPLOY_FIELDS.CAPTCHA, captcha);

  return formData;
}
