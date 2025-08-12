// @vitest-environment jsdom
/**
 * @file Tests for directory structure preservation in Browser SDK
 * These tests ensure that the browser SDK properly preserves nested
 * folder structures when users upload directories via file input.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { processFilesForBrowser } from '../../src/lib/browser-files.js';
import { __setTestEnvironment } from '../../src/lib/env.js';

// Helper function to create mock File objects with webkitRelativePath
function createMockFileWithPath(name: string, webkitRelativePath: string, content: string): File {
  const file = new File([content], name, { type: 'text/plain' });
  // Simulate browser behavior where webkitRelativePath is set when uploading directories
  Object.defineProperty(file, 'webkitRelativePath', {
    value: webkitRelativePath,
    writable: false
  });
  return file;
}

// Helper to create a mock FileList
function createMockFileList(files: File[]): FileList {
  const fileList = {
    length: files.length,
    item: (index: number) => files[index] || null,
    [Symbol.iterator]: function* () {
      for (let i = 0; i < files.length; i++) {
        yield files[i];
      }
    }
  };
  
  // Add indexed properties
  files.forEach((file, index) => {
    (fileList as any)[index] = file;
  });
  
  return fileList as FileList;
}

describe('Browser SDK Directory Structure Preservation', () => {
  beforeEach(() => {
    // Set environment to browser for these tests
    __setTestEnvironment('browser');
  });

  afterEach(() => {
    // Reset environment after each test
    __setTestEnvironment('node');
    vi.clearAllMocks();
  });
  test('should preserve directory structure from webkitRelativePath when uploading folders', async () => {
    // Simulate a user selecting a directory in browser file input with webkitdirectory
    const files = [
      createMockFileWithPath('index.html', 'my-app/index.html', `
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="/assets/css/main.css">
  <script src="/assets/js/app.js"></script>
</head>
<body><div id="root"></div></body>
</html>
      `),
      createMockFileWithPath('app.js', 'my-app/assets/js/app.js', 'console.log("App loaded");'),
      createMockFileWithPath('main.css', 'my-app/assets/css/main.css', 'body { margin: 0; }'),
      createMockFileWithPath('logo.png', 'my-app/assets/images/logo.png', 'fake-png-data'),
      createMockFileWithPath('Button.jsx', 'my-app/components/ui/Button.jsx', 'export const Button = () => {};')
    ];

    const fileList = createMockFileList(files);
    const processedFiles = await processFilesForBrowser(fileList);
    
    // Extract the paths from processed files  
    const filePaths = processedFiles.map(f => f.path);

    // Verify nested paths are preserved based on webkitRelativePath
    expect(filePaths).toContain('assets/js/app.js');
    expect(filePaths).toContain('assets/css/main.css');
    expect(filePaths).toContain('assets/images/logo.png');
    expect(filePaths).toContain('components/ui/Button.jsx');
    expect(filePaths).toContain('index.html');

    // Verify files are NOT flattened
    expect(filePaths).not.toContain('app.js');
    expect(filePaths).not.toContain('main.css');
    expect(filePaths).not.toContain('logo.png');
    expect(filePaths).not.toContain('Button.jsx');
  });

  test('should handle Vite build directory upload - the critical bug case', async () => {
    // This is the exact scenario that was broken - Vite puts everything in /assets/
    const files = [
      createMockFileWithPath('index.html', 'dist/index.html', `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="/assets/index-8ac629b0.css">
  <script type="module" src="/assets/index-f1e2d3c4.js"></script>
</head>
<body>
  <div id="app"></div>
</body>
</html>
      `),
      // THE CRITICAL FILES - these were being flattened before the fix
      createMockFileWithPath('index-8ac629b0.css', 'dist/assets/index-8ac629b0.css', '/* Vite CSS */'),
      createMockFileWithPath('index-f1e2d3c4.js', 'dist/assets/index-f1e2d3c4.js', '// Vite bundle'),
      createMockFileWithPath('vue-logo.png', 'dist/assets/vue-logo-a1b2c3d4.png', 'png-data'),
      createMockFileWithPath('favicon.ico', 'dist/favicon.ico', 'ico-data')
    ];

    const fileList = createMockFileList(files);
    const processedFiles = await processFilesForBrowser(fileList);
    
    const filePaths = processedFiles.map(f => f.path);

    // THE CRITICAL ASSERTIONS: These paths MUST be preserved
    expect(filePaths).toContain('assets/index-8ac629b0.css');
    expect(filePaths).toContain('assets/index-f1e2d3c4.js');
    expect(filePaths).toContain('assets/vue-logo-a1b2c3d4.png');
    expect(filePaths).toContain('index.html');
    expect(filePaths).toContain('favicon.ico');

    // THE BUG CHECK: These flattened names should NOT exist
    expect(filePaths).not.toContain('index-8ac629b0.css');
    expect(filePaths).not.toContain('index-f1e2d3c4.js');
    expect(filePaths).not.toContain('vue-logo-a1b2c3d4.png');
  });

  test('should handle individual file uploads without webkitRelativePath', async () => {
    // When users select individual files (not a directory), webkitRelativePath is usually empty
    const files = [
      new File(['<html>Content</html>'], 'index.html', { type: 'text/html' }),
      new File(['/* styles */'], 'styles.css', { type: 'text/css' }),
      new File(['console.log("app");'], 'app.js', { type: 'application/javascript' })
    ];

    const fileList = createMockFileList(files);
    const processedFiles = await processFilesForBrowser(fileList);
    
    const filePaths = processedFiles.map(f => f.path);

    // Individual files should use their filename
    expect(filePaths).toContain('index.html');
    expect(filePaths).toContain('styles.css');
    expect(filePaths).toContain('app.js');
  });

  test('should handle deeply nested directory structures', async () => {
    const files = [
      createMockFileWithPath('Component.tsx', 'project/src/components/ui/forms/inputs/text/Component.tsx', 'export const Component = {};'),
      createMockFileWithPath('utils.ts', 'project/src/utils/api/endpoints/v1/utils.ts', 'export const utils = {};'),
      createMockFileWithPath('config.json', 'project/config/environments/production/config.json', '{"env": "prod"}'),
      createMockFileWithPath('README.md', 'project/docs/api/v1/README.md', '# API Documentation'),
      createMockFileWithPath('index.html', 'project/public/index.html', '<html>App</html>')
    ];

    const fileList = createMockFileList(files);
    const processedFiles = await processFilesForBrowser(fileList);
    
    const filePaths = processedFiles.map(f => f.path);

    // Verify deep nesting is preserved
    expect(filePaths).toContain('src/components/ui/forms/inputs/text/Component.tsx');
    expect(filePaths).toContain('src/utils/api/endpoints/v1/utils.ts');
    expect(filePaths).toContain('config/environments/production/config.json');
    expect(filePaths).toContain('docs/api/v1/README.md');
    expect(filePaths).toContain('public/index.html');
  });

  test('should handle mixed file types and preserve all paths', async () => {
    const files = [
      createMockFileWithPath('index.html', 'webapp/index.html', '<html>Main</html>'),
      createMockFileWithPath('favicon.ico', 'webapp/public/favicon.ico', 'ico-data'),
      createMockFileWithPath('manifest.json', 'webapp/public/manifest.json', '{"name": "Web App"}'),
      createMockFileWithPath('robots.txt', 'webapp/public/robots.txt', 'User-agent: *'),
      createMockFileWithPath('main.js', 'webapp/assets/js/main.js', 'console.log("main");'),
      createMockFileWithPath('styles.css', 'webapp/assets/css/styles.css', 'body { font: Arial; }'),
      createMockFileWithPath('logo.svg', 'webapp/assets/images/logo.svg', '<svg>Logo</svg>'),
      createMockFileWithPath('README.md', 'webapp/docs/README.md', '# Documentation')
    ];

    const fileList = createMockFileList(files);
    const processedFiles = await processFilesForBrowser(fileList);
    
    const filePaths = processedFiles.map(f => f.path);

    // Verify all file types preserve their paths
    expect(filePaths).toContain('public/favicon.ico');
    expect(filePaths).toContain('public/manifest.json');
    expect(filePaths).toContain('public/robots.txt');
    expect(filePaths).toContain('assets/js/main.js');
    expect(filePaths).toContain('assets/css/styles.css');
    expect(filePaths).toContain('assets/images/logo.svg');
    expect(filePaths).toContain('docs/README.md');
    expect(filePaths).toContain('index.html');
  });

  test('should handle File array input correctly', async () => {
    const files = [
      createMockFileWithPath('index.html', 'app/index.html', '<html>App</html>'),
      createMockFileWithPath('script.js', 'app/js/script.js', 'console.log("script");'),
      createMockFileWithPath('style.css', 'app/css/style.css', 'body { margin: 0; }')
    ];

    // Test with File array (not FileList)
    const processedFiles = await processFilesForBrowser(files);
    
    const filePaths = processedFiles.map(f => f.path);

    expect(filePaths).toContain('index.html');
    expect(filePaths).toContain('js/script.js');
    expect(filePaths).toContain('css/style.css');
  });

  test('should handle empty webkitRelativePath gracefully', async () => {
    // Some browsers might set webkitRelativePath to empty string instead of the path
    const files = [
      createMockFileWithPath('index.html', '', '<html>App</html>'),
      createMockFileWithPath('app.js', '', 'console.log("app");')
    ];

    const fileList = createMockFileList(files);
    const processedFiles = await processFilesForBrowser(fileList);
    
    const filePaths = processedFiles.map(f => f.path);

    // When webkitRelativePath is empty, should fall back to file.name
    expect(filePaths).toContain('index.html');
    expect(filePaths).toContain('app.js');
  });
});