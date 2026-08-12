/**
 * Node.js-specific deploy body creation.
 */
import { DEPLOY_FIELDS, ShipError } from '@shipstatic/types';
import type { DeployBody, DeployBodyContext, StaticFile } from '../../shared/types.js';

export async function createDeployBody(
  files: StaticFile[],
  context: DeployBodyContext = {},
): Promise<DeployBody> {
  const { FormData, File } = await import('formdata-node');
  const { FormDataEncoder } = await import('form-data-encoder');

  const { labels, via, password, ttl, flags, captcha } = context;
  const formData = new FormData();
  const checksums: string[] = [];

  for (const file of files) {
    // 1. Validate content type
    if (
      !Buffer.isBuffer(file.content) &&
      !(typeof Blob !== 'undefined' && file.content instanceof Blob)
    ) {
      throw ShipError.file(`Unsupported file.content type for Node.js: ${file.path}`, {
        filePath: file.path,
      });
    }

    // 2. Validate md5
    if (!file.md5) {
      throw ShipError.file(`File missing md5 checksum: ${file.path}`, { filePath: file.path });
    }

    // 3. Create File and append — API derives Content-Type from extension
    const fileInstance = new File([file.content], file.path, { type: 'application/octet-stream' });
    formData.append(DEPLOY_FIELDS.FILES, fileInstance);
    checksums.push(file.md5);
  }

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

  const encoder = new FormDataEncoder(formData);
  const chunks = [];
  for await (const chunk of encoder.encode()) {
    chunks.push(Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks);

  return {
    body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    headers: {
      'Content-Type': encoder.contentType,
      'Content-Length': Buffer.byteLength(body).toString(),
    },
  };
}
