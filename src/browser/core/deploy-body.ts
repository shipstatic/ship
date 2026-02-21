/**
 * Browser-specific deploy body creation.
 */
import { ShipError } from '@shipstatic/types';
import type { StaticFile, DeployBody } from '../../shared/types.js';

export async function createDeployBody(
  files: StaticFile[],
  labels?: string[],
  via?: string
): Promise<DeployBody> {
  const formData = new FormData();
  const checksums: string[] = [];

  for (const file of files) {
    // 1. Validate content type
    if (!(file.content instanceof File || file.content instanceof Blob)) {
      throw ShipError.file(`Unsupported file.content type for browser: ${file.path}`, file.path);
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

  return { body: formData, headers: {} };
}
