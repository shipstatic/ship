/**
 * Browser-compatible MIME type utilities
 * Uses mime-db directly without Node.js dependencies
 */
import mimeDb from 'mime-db';

// Build extension to MIME type map from mime-db
const extensionToMimeMap: { [key: string]: string } = {};
for (const type in mimeDb) {
  const mimeInfo = mimeDb[type];
  if (mimeInfo && mimeInfo.extensions) {
    mimeInfo.extensions.forEach((ext: string) => {
      if (!extensionToMimeMap[ext]) {
        extensionToMimeMap[ext] = type;
      }
    });
  }
}

/**
 * Get MIME type from file path (browser-compatible, no Node.js dependencies)
 */
export function getMimeType(path: string): string {
  const extension = path.includes('.')
    ? path.substring(path.lastIndexOf('.') + 1).toLowerCase()
    : '';
  return extensionToMimeMap[extension] || 'application/octet-stream';
}
