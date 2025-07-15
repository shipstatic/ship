/**
 * @file Simplified MD5 calculation utility with separate environment handlers.
 */
import { getENV } from './env';
import { ShipError } from '@shipstatic/types';

export interface MD5Result {
  md5: string;
}

/**
 * Browser-specific MD5 calculation for Blob/File objects
 */
async function calculateMD5Browser(blob: Blob): Promise<MD5Result> {
  const SparkMD5 = (await import('spark-md5')).default;
  
  return new Promise((resolve, reject) => {
    const chunkSize = 2097152; // 2MB chunks
    const chunks = Math.ceil(blob.size / chunkSize);
    let currentChunk = 0;
    const spark = new SparkMD5.ArrayBuffer();
    const fileReader = new FileReader();

    const loadNext = () => {
      const start = currentChunk * chunkSize;
      const end = Math.min(start + chunkSize, blob.size);
      fileReader.readAsArrayBuffer(blob.slice(start, end));
    };

    fileReader.onload = (e) => {
      const result = e.target?.result as ArrayBuffer;
      if (!result) {
        reject(ShipError.business('Failed to read file chunk'));
        return;
      }
      
      spark.append(result);
      currentChunk++;
      
      if (currentChunk < chunks) {
        loadNext();
      } else {
        resolve({ md5: spark.end() });
      }
    };

    fileReader.onerror = () => {
      reject(ShipError.business('Failed to calculate MD5: FileReader error'));
    };

    loadNext();
  });
}

/**
 * Node.js-specific MD5 calculation for Buffer or file path
 */
async function calculateMD5Node(input: Buffer | string): Promise<MD5Result> {
  const crypto = await import('crypto');
  
  if (Buffer.isBuffer(input)) {
    const hash = crypto.createHash('md5');
    hash.update(input);
    return { md5: hash.digest('hex') };
  }
  
  // Handle file path
  const fs = await import('fs');
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(input);
    
    stream.on('error', err => 
      reject(ShipError.business(`Failed to read file for MD5: ${err.message}`))
    );
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve({ md5: hash.digest('hex') }));
  });
}

/**
 * Unified MD5 calculation that delegates to environment-specific handlers
 */
export async function calculateMD5(input: Blob | Buffer | string): Promise<MD5Result> {
  const env = getENV();
  
  if (env === 'browser') {
    if (!(input instanceof Blob)) {
      throw ShipError.business('Invalid input for browser MD5 calculation: Expected Blob or File.');
    }
    return calculateMD5Browser(input);
  }
  
  if (env === 'node') {
    if (!(Buffer.isBuffer(input) || typeof input === 'string')) {
      throw ShipError.business('Invalid input for Node.js MD5 calculation: Expected Buffer or file path string.');
    }
    return calculateMD5Node(input);
  }
  
  throw ShipError.business('Unknown or unsupported execution environment for MD5 calculation.');
}
