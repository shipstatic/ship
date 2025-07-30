// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateMD5 } from '@/lib/md5';
import { __setTestEnvironment } from '@/index';
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
  const streamInstance = { on: vi.fn(), pipe: vi.fn() };
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

describe('Unified calculateMD5 Utility', () => {
  let mockFileReader: {
    readAsArrayBuffer: ReturnType<typeof vi.fn>;
    onload: ((event: { target: { result: ArrayBuffer | null } }) => void) | null;
    onerror: ((event?: any) => void) | null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    __setTestEnvironment('node');

    MOCK_SPARK_MD5_INSTANCE.end.mockReturnValue('mocked-spark-md5-hash');
    MOCK_CRYPTO_HASH_INSTANCE.digest.mockReturnValue('mocked-crypto-md5-hash');

    MOCK_FS_STREAM_INSTANCE.on.mockReset().mockImplementation(function(this: any, event: string, callback: (...args: any[]) => void) { // Changed Function to (...args: any[]) => void
        if (event === 'data') { setTimeout(() => callback(Buffer.from('mock stream data')), 0); }
        if (event === 'end') { setTimeout(() => callback(), 0); }
        return this;
    });

    mockFileReader = {
      readAsArrayBuffer: vi.fn(),
      onload: null,
      onerror: null,
    };
    vi.stubGlobal('FileReader', vi.fn(() => mockFileReader));
  });

  afterEach(() => {
    __setTestEnvironment(null);
    vi.unstubAllGlobals();
  });

  describe('Browser Environment', () => {
    beforeEach(() => { __setTestEnvironment('browser'); });

    it('should use SparkMD5 for a Blob', async () => {
      const mockBlob = new Blob(['hello browser']);
      mockFileReader.readAsArrayBuffer.mockImplementationOnce(() => {
        if (mockFileReader.onload) {
          setTimeout(() => mockFileReader.onload!({ target: { result: new TextEncoder().encode('hello browser').buffer } } as any), 0);
        }
      });

      const result = await calculateMD5(mockBlob);
      expect(MOCK_SPARK_MD5_ARRAY_BUFFER_FN).toHaveBeenCalled();
      expect(mockFileReader.readAsArrayBuffer).toHaveBeenCalledWith(mockBlob.slice(0, mockBlob.size));
      expect(result.md5).toBe('mocked-spark-md5-hash');
    });

    it('should reject on FileReader error', async () => {
      const mockBlob = new Blob(['error data']);
      mockFileReader.readAsArrayBuffer.mockImplementationOnce(() => {
        if (mockFileReader.onerror) {
          setTimeout(() => mockFileReader.onerror!(new ErrorEvent('error', {error: new Error('test read error')})), 0);
        }
      });
      await expect(calculateMD5(mockBlob)).rejects.toThrow(ShipError.business('Failed to calculate MD5: FileReader error'));
    });

    it('should throw if input is not a Blob in browser env', async () => {
        await expect(calculateMD5(Buffer.from('not a blob') as any)).rejects.toThrow('Invalid input for browser MD5 calculation: Expected Blob or File.');
    });
  });

  describe('Node.js Environment', () => {
    beforeEach(() => { __setTestEnvironment('node'); });

    it('should use crypto for a Buffer input', async () => {
      const buffer = Buffer.from('hello node');
      const result = await calculateMD5(buffer);
      expect(MOCK_CREATE_HASH_FN).toHaveBeenCalledWith('md5');
      expect(MOCK_CRYPTO_HASH_INSTANCE.update).toHaveBeenCalledWith(buffer);
      expect(result.md5).toBe('mocked-crypto-md5-hash');
    });

    it('should use crypto and fs.createReadStream for a file path input', async () => {
      const filePath = '/mock/file.txt';
      await calculateMD5(filePath);
      expect(MOCK_CREATE_READ_STREAM_FN).toHaveBeenCalledWith(filePath);
      expect(MOCK_CRYPTO_HASH_INSTANCE.update).toHaveBeenCalledWith(Buffer.from('mock stream data'));
    });

    it('should reject on fs.createReadStream error', async () => {
      const filePath = '/mock/errorfile.txt';
      const streamError = new Error('File access denied');
      MOCK_CREATE_READ_STREAM_FN.mockImplementationOnce(() => {
        const errorStream = { on: vi.fn((event: string, cb: (...args: any[]) => void) => { if (event === 'error') setTimeout(() => cb(streamError),0); return errorStream; })}; // Changed Function to (...args: any[]) => void
        return errorStream as any;
      });
      await expect(calculateMD5(filePath)).rejects.toThrow(ShipError.business(`Failed to read file for MD5: ${streamError.message}`));
    });

    it('should throw if input is not Buffer or string in Node.js env', async () => {
        await expect(calculateMD5(new Blob(['not buffer']) as any)).rejects.toThrow('Invalid input for Node.js MD5 calculation: Expected Buffer or file path string.');
    });
  });

  describe('Unknown Environment', () => {
    it('should throw an error', async () => {
      __setTestEnvironment('unknown');
      await expect(calculateMD5(Buffer.from('any') as any)).rejects.toThrow('Unknown or unsupported execution environment for MD5 calculation.');
    });
  });
});
