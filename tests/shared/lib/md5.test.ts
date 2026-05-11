// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateMD5 } from '../../../src/shared/lib/md5';
import { ShipError } from '@shipstatic/types';

const { MOCK_SPARK_MD5_INSTANCE, MOCK_SPARK_MD5_ARRAY_BUFFER_FN } = vi.hoisted(() => {
  const instance = { append: vi.fn(), end: vi.fn() };
  return { MOCK_SPARK_MD5_INSTANCE: instance, MOCK_SPARK_MD5_ARRAY_BUFFER_FN: vi.fn(() => instance) };
});
const { MOCK_CRYPTO_HASH_INSTANCE, MOCK_CREATE_HASH_FN } = vi.hoisted(() => {
  const instance = { update: vi.fn().mockReturnThis(), digest: vi.fn() };
  return { MOCK_CRYPTO_HASH_INSTANCE: instance, MOCK_CREATE_HASH_FN: vi.fn(() => instance) };
});
const { MOCK_FS_STREAM_INSTANCE, MOCK_CREATE_READ_STREAM_FN } = vi.hoisted(() => {
  const streamInstance = { on: vi.fn() };
  return { MOCK_FS_STREAM_INSTANCE: streamInstance, MOCK_CREATE_READ_STREAM_FN: vi.fn(() => streamInstance) };
});

vi.mock('spark-md5', () => ({ default: { ArrayBuffer: MOCK_SPARK_MD5_ARRAY_BUFFER_FN } }));
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return { ...actual, createHash: MOCK_CREATE_HASH_FN };
});
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, createReadStream: MOCK_CREATE_READ_STREAM_FN };
});

describe('calculateMD5', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MOCK_SPARK_MD5_INSTANCE.end.mockReturnValue('mocked-spark-md5-hash');
    MOCK_CRYPTO_HASH_INSTANCE.digest.mockReturnValue('mocked-crypto-md5-hash');
  });

  describe('Blob', () => {
    it('hashes a Blob via SparkMD5 and Blob.arrayBuffer()', async () => {
      const blob = new Blob(['hello']);
      const result = await calculateMD5(blob);
      expect(MOCK_SPARK_MD5_ARRAY_BUFFER_FN).toHaveBeenCalled();
      expect(MOCK_SPARK_MD5_INSTANCE.append).toHaveBeenCalled();
      expect(result.md5).toBe('mocked-spark-md5-hash');
    });

    it('does not touch FileReader', async () => {
      // Pin the contract: the Blob path uses only Blob.arrayBuffer — the one
      // primitive every modern runtime ships. jsdom's arrayBuffer polyfill in
      // tests/setup.ts goes through FileReader, so we patch slice() to return
      // a native-arrayBuffer object and bypass the polyfill for this assertion.
      const data = new TextEncoder().encode('payload');
      const blob = new Blob([data]);
      Object.defineProperty(blob, 'slice', {
        configurable: true,
        value: () => ({ arrayBuffer: async () => data.buffer }),
      });

      const original = (globalThis as any).FileReader;
      (globalThis as any).FileReader = undefined;
      try {
        const result = await calculateMD5(blob);
        expect(result.md5).toBe('mocked-spark-md5-hash');
      } finally {
        (globalThis as any).FileReader = original;
      }
    });
  });

  describe('Buffer', () => {
    it('hashes a Buffer via crypto', async () => {
      const buffer = Buffer.from('hello');
      const result = await calculateMD5(buffer);
      expect(MOCK_CREATE_HASH_FN).toHaveBeenCalledWith('md5');
      expect(MOCK_CRYPTO_HASH_INSTANCE.update).toHaveBeenCalledWith(buffer);
      expect(result.md5).toBe('mocked-crypto-md5-hash');
    });
  });

  describe('file path', () => {
    function mockStream(handlers: { data?: Buffer; end?: boolean; error?: Error }) {
      MOCK_FS_STREAM_INSTANCE.on.mockImplementation((event: string, cb: (...args: any[]) => void) => {
        if (event === 'data' && handlers.data) setTimeout(() => cb(handlers.data), 0);
        if (event === 'end' && handlers.end) setTimeout(() => cb(), 0);
        if (event === 'error' && handlers.error) setTimeout(() => cb(handlers.error), 0);
        return MOCK_FS_STREAM_INSTANCE;
      });
    }

    it('hashes a file via fs.createReadStream', async () => {
      const chunk = Buffer.from('mock stream data');
      mockStream({ data: chunk, end: true });

      const path = '/mock/file.txt';
      await calculateMD5(path);
      expect(MOCK_CREATE_READ_STREAM_FN).toHaveBeenCalledWith(path);
      expect(MOCK_CRYPTO_HASH_INSTANCE.update).toHaveBeenCalledWith(chunk);
    });

    it('rejects when the file stream errors', async () => {
      const streamError = new Error('File access denied');
      mockStream({ error: streamError });

      await expect(calculateMD5('/mock/errorfile.txt')).rejects.toThrow(
        ShipError.business(`Failed to read file for MD5: ${streamError.message}`)
      );
    });
  });

  describe('invalid input', () => {
    it('throws for inputs that are neither Blob, Buffer, nor string', async () => {
      await expect(calculateMD5(42 as any)).rejects.toThrow('Invalid input for MD5 calculation');
      await expect(calculateMD5({} as any)).rejects.toThrow('Invalid input for MD5 calculation');
    });
  });
});
