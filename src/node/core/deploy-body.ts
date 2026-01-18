/**
 * Node.js-specific deploy body creation.
 */
import { ShipError } from '@shipstatic/types';
import type { StaticFile, DeployBody } from '../../shared/types.js';
import { getMimeType } from '../../shared/utils/mimeType.js';

export async function createDeployBody(
  files: StaticFile[],
  tags?: string[],
  via?: string
): Promise<DeployBody> {
  const { FormData, File } = await import('formdata-node');
  const { FormDataEncoder } = await import('form-data-encoder');

  const formData = new FormData();
  const checksums: string[] = [];

  for (const file of files) {
    const contentType = getMimeType(file.path);

    let fileInstance;
    if (Buffer.isBuffer(file.content)) {
      fileInstance = new File([file.content], file.path, { type: contentType });
    } else if (typeof Blob !== 'undefined' && file.content instanceof Blob) {
      fileInstance = new File([file.content], file.path, { type: contentType });
    } else {
      throw ShipError.file(`Unsupported file.content type for Node.js: ${file.path}`, file.path);
    }

    if (!file.md5) {
      throw ShipError.file(`File missing md5 checksum: ${file.path}`, file.path);
    }

    const preservedPath = file.path.startsWith('/') ? file.path : '/' + file.path;
    formData.append('files[]', fileInstance, preservedPath);
    checksums.push(file.md5);
  }

  formData.append('checksums', JSON.stringify(checksums));

  if (tags && tags.length > 0) {
    formData.append('tags', JSON.stringify(tags));
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
