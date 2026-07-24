/**
 * @file MD5 utility for Blob, Buffer, or file path inputs.
 */
import { ShipError } from '@shipstatic/types';

export interface MD5Result {
  md5: string;
}

async function md5Blob(blob: Blob): Promise<MD5Result> {
  const SparkMD5 = (await import('spark-md5')).default;
  const spark = new SparkMD5.ArrayBuffer();
  const chunkSize = 2097152; // 2 MB
  for (let start = 0; start < blob.size; start += chunkSize) {
    const end = Math.min(start + chunkSize, blob.size);
    spark.append(await blob.slice(start, end).arrayBuffer());
  }
  return { md5: spark.end() };
}

async function md5Buffer(buffer: Buffer): Promise<MD5Result> {
  const { createHash } = await import('node:crypto');
  const hash = createHash('md5');
  hash.update(buffer);
  return { md5: hash.digest('hex') };
}

async function md5Path(path: string): Promise<MD5Result> {
  const { createHash } = await import('node:crypto');
  const { createReadStream } = await import('node:fs');
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    const stream = createReadStream(path);
    stream.on('error', (err) =>
      reject(ShipError.business(`Failed to read file for MD5: ${err.message}`)),
    );
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve({ md5: hash.digest('hex') }));
  });
}

export async function calculateMD5(input: Blob | Buffer | string): Promise<MD5Result> {
  if (input instanceof Blob) return md5Blob(input);
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) return md5Buffer(input);
  if (typeof input === 'string') return md5Path(input);
  throw ShipError.business('Invalid input for MD5 calculation');
}
