// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processFilesForBrowser } from '@/lib/browser-files';
import { __setTestEnvironment } from '@/lib/env';
import { Ship } from '@/index';
// import type { StaticFile } from '@/types'; // Could be used for uploadedFiles if desired

// Define mock implementations using vi.hoisted()
const mockApiHttpInstance = {
  ping: vi.fn(),
  deploy: vi.fn().mockResolvedValue({
    success: true,
    subdomain: 'test',
    expiresAt: new Date().toISOString(),
    fileCount: 3
  }),
  getConfig: vi.fn().mockResolvedValue({
    maxFileSize: 10 * 1024 * 1024,
    maxFilesCount: 1000,
    maxTotalSize: 100 * 1024 * 1024,
  }),
};

const { MOCK_API_HTTP_MODULE } = vi.hoisted(() => {
  return {
    MOCK_API_HTTP_MODULE: {
      ApiHttp: vi.fn(() => mockApiHttpInstance),
      DEFAULT_API_HOST: 'https://mockapi.shipstatic.com'
    }
  };
});

vi.mock('@/api/http', () => MOCK_API_HTTP_MODULE);

// Mock MD5 calculation
const { MOCK_CALCULATE_MD5_FN } = vi.hoisted(() => ({ 
  MOCK_CALCULATE_MD5_FN: vi.fn().mockResolvedValue('mocked-md5-hash') 
}));

vi.mock('@/lib/md5', () => ({ calculateMD5: MOCK_CALCULATE_MD5_FN }));

// Helper to create a mock File with webkitRelativePath
function mockFile(name: string, webkitRelativePath?: string): File {
  const file = new File(['content'], name, { type: 'text/plain' });
  if (webkitRelativePath) {
    Object.defineProperty(file, 'webkitRelativePath', {
      value: webkitRelativePath,
      writable: false,
      configurable: true,
      enumerable: true
    });
  }
  return file;
}

// Helper to create a mock FileList from an array of Files
function mockFileList(files: File[]): FileList {
  // FileList is not constructible, so we fake it as closely as possible
  const fileList = {} as any;
  
  // Copy indexed properties from files array
  for (let i = 0; i < files.length; i++) {
    fileList[i] = files[i];
  }
  
  // Add required FileList properties
  fileList.length = files.length;
  fileList.item = (i: number) => files[i] || null;
  
  // Make it iterable
  fileList[Symbol.iterator] = function* () {
    for (let i = 0; i < files.length; i++) {
      yield files[i];
    }
  };
  
  return fileList as FileList;
}

describe('Strip Common Prefix Test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setTestEnvironment('browser');
  });

  afterEach(() => {
    __setTestEnvironment(null);
  });


  describe('Ship.upload with flattenDirs', () => {
    it('should correctly strip nested parent folders', async () => {
      // Create a client directly
      const client = new Ship({ apiHost: 'https://test.api', apiKey: 'test-key' });
      
      // Create files mimicking the structure from the screenshot
      const files = [
        mockFile('DS_Store', 'fdsa/asdf/DS_Store'),
        mockFile('README.md', 'fdsa/asdf/README.md'),
        mockFile('styles.css', 'fdsa/asdf/css/styles.css'),
        mockFile('favicon.png', 'fdsa/asdf/images/favicon.png'),
        mockFile('index.html', 'fdsa/asdf/index.html'),
      ];
      
      // Call upload with flattenDirs: true
      await client.deployments.create(files, { flattenDirs: true });
      
      // Check what paths were sent to the API
      const uploadedFiles = mockApiHttpInstance.deploy.mock.calls[0][0] as any[]; // Typed as any[]
      
      // Check if paths were correctly stripped (they should NOT have any prefix)
      const allPathsStripped = uploadedFiles.every(f => 
        !f.path.startsWith('fdsa') && 
        !f.path.startsWith('asdf/')
      );
      
      expect(allPathsStripped).toBe(true);
    });

    it('should respect flattenDirs for nested folders', async () => {
      // Create a client
      const client = new Ship({ apiHost: 'https://test.api', apiKey: 'test-key' });
      
      // Create files with the problematic structure
      const files: File[] = [ // Ensure files is typed as File[]
        mockFile('README.md', 'fdsa/asdf/README.md'),
        mockFile('index.html', 'fdsa/asdf/index.html'),
      ];
      
      // Call upload with flattenDirs flag
      await client.deployments.create(files, {
        flattenDirs: true
      });
      
      // Check the paths sent to the API
      const uploadedFiles = mockApiHttpInstance.deploy.mock.calls[0][0] as any[]; // Typed as any[]
      
      // Verify all paths have had both directory levels removed
      const allPathsCorrect = uploadedFiles.every(f => 
        !f.path.includes('fdsa') && 
        !f.path.includes('asdf/')
      );
      
      expect(allPathsCorrect).toBe(true);
    });
  });
});
