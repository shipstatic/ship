/**
 * Browser-specific deploy body creation.
 */
import { ShipError } from '@shipstatic/types';
import type { StaticFile, DeployBody } from '../../shared/types.js';
import { getMimeType } from '../../shared/utils/mimeType.js';

function getContentType(file: File | string): string {
  if (typeof file === 'string') {
    return getMimeType(file);
  }
  return file.type || getMimeType(file.name);
}

export async function createDeployBody(
  files: StaticFile[],
  tags?: string[],
  via?: string
): Promise<DeployBody> {
  const formData = new FormData();
  const checksums: string[] = [];

  for (const file of files) {
    if (!(file.content instanceof File || file.content instanceof Blob)) {
      throw ShipError.file(`Unsupported file.content type for browser: ${file.path}`, file.path);
    }
    if (!file.md5) {
      throw ShipError.file(`File missing md5 checksum: ${file.path}`, file.path);
    }

    const contentType = getContentType(file.content instanceof File ? file.content : file.path);
    const fileWithPath = new File([file.content], file.path, { type: contentType });
    formData.append('files[]', fileWithPath);
    checksums.push(file.md5);
  }

  formData.append('checksums', JSON.stringify(checksums));

  if (tags && tags.length > 0) {
    formData.append('tags', JSON.stringify(tags));
  }

  if (via) {
    formData.append('via', via);
  }

  return { body: formData, headers: {} };
}
