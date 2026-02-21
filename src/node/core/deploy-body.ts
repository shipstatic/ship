/**
 * Node.js-specific deploy body creation.
 */
import { ShipError } from '@shipstatic/types';
import type { StaticFile, DeployBody } from '../../shared/types.js';

export async function createDeployBody(
  files: StaticFile[],
  labels?: string[],
  via?: string
): Promise<DeployBody> {
  const { FormData, File } = await import('formdata-node');
  const { FormDataEncoder } = await import('form-data-encoder');

  const formData = new FormData();
  const checksums: string[] = [];

  for (const file of files) {
    // 1. Validate content type
    if (!Buffer.isBuffer(file.content) && !(typeof Blob !== 'undefined' && file.content instanceof Blob)) {
      throw ShipError.file(`Unsupported file.content type for Node.js: ${file.path}`, file.path);
    }

    // 2. Validate md5
    if (!file.md5) {
      throw ShipError.file(`File missing md5 checksum: ${file.path}`, file.path);
    }

    // 3. Create File and append — API derives Content-Type from extension
    const fileInstance = new File([file.content], file.path, { type: 'application/octet-stream' });
    formData.append('files[]', fileInstance);
    checksums.push(file.md5);
  }

  formData.append('checksums', JSON.stringify(checksums));

  if (labels && labels.length > 0) {
    formData.append('labels', JSON.stringify(labels));
  }

  if (via) {
    formData.append('via', via);
  }

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
      'Content-Length': Buffer.byteLength(body).toString()
    }
  };
}
