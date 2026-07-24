/**
 * Browser-specific deploy body creation.
 */
import { ShipError } from '@shipstatic/types';
import type { DeployBody, DeployBodyContext, StaticFile } from '../../shared/types.js';

export async function createDeployBody(
  files: StaticFile[],
  context: DeployBodyContext = {},
): Promise<DeployBody> {
  const { labels, via, password, flags, captcha } = context;
  const formData = new FormData();
  const checksums: string[] = [];

  for (const file of files) {
    // 1. Validate content type
    if (!(file.content instanceof File || file.content instanceof Blob)) {
      throw ShipError.file(`Unsupported file.content type for browser: ${file.path}`, {
        filePath: file.path,
      });
    }

    // 2. Validate md5
    if (!file.md5) {
      throw ShipError.file(`File missing md5 checksum: ${file.path}`, { filePath: file.path });
    }

    // 3. Create File and append — API derives Content-Type from extension
    const fileInstance = new File([file.content], file.path, { type: 'application/octet-stream' });
    formData.append('files[]', fileInstance);
    checksums.push(file.md5);
  }

  formData.append('checksums', JSON.stringify(checksums));

  if (labels && labels.length > 0) formData.append('labels', JSON.stringify(labels));
  if (via) formData.append('via', via);
  if (password) formData.append('password', password);
  if (flags?.build) formData.append('build', 'true');
  if (flags?.prerender) formData.append('prerender', 'true');
  if (flags?.spa) formData.append('spa', 'true');
  if (captcha) formData.append('captcha', captcha);

  return { body: formData, headers: {} };
}
