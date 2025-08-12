/**
 * @file Tests for directory structure preservation in Node.js SDK
 * These tests ensure that the Node.js SDK properly preserves nested
 * folder structures when deploying directories and file arrays.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { getFilesFromPath, processFilesForNode } from '../../src/lib/node-files.js';
import { setConfig } from '../../src/core/platform-config.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Node.js SDK Directory Structure Preservation', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Setup platform config for tests
    setConfig({
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxFilesCount: 1000,
      maxTotalSize: 100 * 1024 * 1024, // 100MB
    });
    
    // Create temporary directory with nested structure
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-sdk-test-'));
    
    // Create realistic web app structure
    fs.mkdirSync(path.join(tempDir, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'assets', 'js'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'assets', 'css'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'components', 'ui'), { recursive: true });
    
    // Write test files
    fs.writeFileSync(path.join(tempDir, 'index.html'), `
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="/assets/css/main.css">
  <script src="/assets/js/bundle.js"></script>
</head>
<body>
  <div id="root"></div>
</body>
</html>
    `);
    
    fs.writeFileSync(path.join(tempDir, 'assets', 'js', 'bundle.js'), 'console.log("bundle loaded");');
    fs.writeFileSync(path.join(tempDir, 'assets', 'css', 'main.css'), 'body { font-family: Arial; }');
    fs.writeFileSync(path.join(tempDir, 'components', 'ui', 'Button.js'), 'export const Button = () => {};');
  });

  afterEach(async () => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  test('should preserve directory structure by default when processing directory path', async () => {
    const files = await getFilesFromPath(tempDir, { preserveDirs: true });
    const filePaths = files.map(f => f.path);

    // Verify nested paths are preserved
    expect(filePaths).toContain('assets/js/bundle.js');
    expect(filePaths).toContain('assets/css/main.css');
    expect(filePaths).toContain('components/ui/Button.js');
    expect(filePaths).toContain('index.html');

    // Verify files are NOT flattened
    expect(filePaths).not.toContain('bundle.js');
    expect(filePaths).not.toContain('main.css');
    expect(filePaths).not.toContain('Button.js');
  });

  test('should preserve structure in Vite-style assets folder', async () => {
    // This specifically tests the original bug case - Vite puts everything in /assets/
    const viteDir = path.join(tempDir, 'vite-build');
    fs.mkdirSync(viteDir, { recursive: true });
    fs.mkdirSync(path.join(viteDir, 'assets'), { recursive: true });

    fs.writeFileSync(path.join(viteDir, 'index.html'), `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="/assets/index-8ac629b0.css">
  <script type="module" src="/assets/index-f1e2d3c4.js"></script>
</head>
<body>
  <div id="app"></div>
</body>
</html>
    `);

    // These are the exact file patterns that were broken
    fs.writeFileSync(path.join(viteDir, 'assets', 'index-8ac629b0.css'), '/* Vite CSS */');
    fs.writeFileSync(path.join(viteDir, 'assets', 'index-f1e2d3c4.js'), '// Vite JS bundle');
    fs.writeFileSync(path.join(viteDir, 'assets', 'vue-logo-a1b2c3d4.png'), 'png-data');

    const files = await processFilesForNode([viteDir], { preserveDirs: true });
    const filePaths = files.map(f => f.path);

    // THE CRITICAL TEST: These must NOT be flattened
    expect(filePaths).toContain('assets/index-8ac629b0.css');
    expect(filePaths).toContain('assets/index-f1e2d3c4.js');
    expect(filePaths).toContain('assets/vue-logo-a1b2c3d4.png');
    expect(filePaths).toContain('index.html');

    // Verify the original bug is fixed - these should NOT exist
    expect(filePaths).not.toContain('index-8ac629b0.css');
    expect(filePaths).not.toContain('index-f1e2d3c4.js');
    expect(filePaths).not.toContain('vue-logo-a1b2c3d4.png');
  });

  test('should handle individual file paths correctly', async () => {
    // Test processing individual files by path
    const filePaths = [
      path.join(tempDir, 'index.html'),
      path.join(tempDir, 'assets', 'js', 'bundle.js'),
      path.join(tempDir, 'assets', 'css', 'main.css'),
      path.join(tempDir, 'components', 'ui', 'Button.js')
    ];

    const files = await processFilesForNode(filePaths, { preserveDirs: true });
    const processedFilePaths = files.map(f => f.path);

    // When processing individual files, each gets its own commonParent (dirname),
    // so the structure is based on each file's immediate directory
    expect(processedFilePaths).toContain('index.html');  // from tempDir
    expect(processedFilePaths).toContain('bundle.js');   // from tempDir/assets/js
    expect(processedFilePaths).toContain('main.css');    // from tempDir/assets/css
    expect(processedFilePaths).toContain('Button.js');   // from tempDir/components/ui
  });

  test('should handle deeply nested paths without truncation', async () => {
    // Create very deep nesting
    const deepPath = path.join(tempDir, 'src', 'components', 'ui', 'forms', 'inputs', 'text');
    fs.mkdirSync(deepPath, { recursive: true });
    fs.writeFileSync(path.join(deepPath, 'TextInput.tsx'), 'export const TextInput = () => {};');
    
    // Also create a parallel deep path
    const deepPath2 = path.join(tempDir, 'src', 'utils', 'api', 'endpoints', 'v1');
    fs.mkdirSync(deepPath2, { recursive: true });
    fs.writeFileSync(path.join(deepPath2, 'users.ts'), 'export const userAPI = {};');

    const files = await getFilesFromPath(tempDir, { preserveDirs: true });
    const filePaths = files.map(f => f.path);

    // Verify deep paths are preserved
    expect(filePaths).toContain('src/components/ui/forms/inputs/text/TextInput.tsx');
    expect(filePaths).toContain('src/utils/api/endpoints/v1/users.ts');
  });

  test('should handle mixed file types preserving all extensions and paths', async () => {
    // Create files with various extensions in nested structure
    fs.mkdirSync(path.join(tempDir, 'public'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'src', 'styles'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });

    const testFiles = [
      ['public/favicon.ico', 'ico-data'],
      ['public/manifest.json', '{"name": "test"}'],
      ['public/robots.txt', 'User-agent: *'],
      ['src/styles/globals.scss', '$primary: blue;'],
      ['src/app.tsx', 'import React from "react";'],
      ['docs/README.md', '# Documentation'],
      ['docs/api.yml', 'openapi: 3.0.0']
    ];

    testFiles.forEach(([filePath, content]) => {
      const fullPath = path.join(tempDir, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    });

    const files = await getFilesFromPath(tempDir, { preserveDirs: true });
    const filePaths = files.map(f => f.path);

    // Verify all file types preserve their nested paths
    expect(filePaths).toContain('public/favicon.ico');
    expect(filePaths).toContain('public/manifest.json');
    expect(filePaths).toContain('public/robots.txt');
    expect(filePaths).toContain('src/styles/globals.scss');
    expect(filePaths).toContain('src/app.tsx');
    expect(filePaths).toContain('docs/README.md');
    expect(filePaths).toContain('docs/api.yml');
  });
});