/**
 * @file MD5 of a file's bytes: the digest a deployment's manifest names for
 * each file, which storage holds the file's bytes to.
 */

const SLICE_BYTES = 2 * 1024 * 1024;

/** A running MD5: it takes bytes, then answers the digest in hex. */
interface Hash {
  update(bytes: ArrayBuffer): void;
  digest(): string;
}

/**
 * The runtime's own MD5 where it has one, and `spark-md5` where it does not:
 * Node has `crypto`, and a browser has no MD5 at all. The browser build
 * resolves `crypto` to an empty module, so the same question is asked of both.
 */
async function createHash(): Promise<Hash> {
  // biome-ignore lint/style/useNodejsImportProtocol: the browser build aliases the bare specifier to an empty module, and `node:` would bypass the alias (tsup.config.ts)
  const { createHash: nodeHash } = await import('crypto');
  if (nodeHash) {
    const hash = nodeHash('md5');
    return {
      update: (bytes) => void hash.update(new Uint8Array(bytes)),
      digest: () => hash.digest('hex'),
    };
  }
  const { default: SparkMD5 } = await import('spark-md5');
  const spark = new SparkMD5.ArrayBuffer();
  return { update: (bytes) => void spark.append(bytes), digest: () => spark.end() };
}

/**
 * The MD5 of a file's bytes, as 32 lowercase hex characters. Read one slice
 * at a time, so a file is never held whole to be hashed.
 */
export async function calculateMD5(content: Blob): Promise<string> {
  const hash = await createHash();
  for (let start = 0; start < content.size; start += SLICE_BYTES) {
    hash.update(await content.slice(start, start + SLICE_BYTES).arrayBuffer());
  }
  return hash.digest();
}
