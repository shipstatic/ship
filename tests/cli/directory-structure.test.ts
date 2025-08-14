/**
 * @file Tests for directory structure preservation in CLI deployments
 * These tests ensure that nested folder structures are properly maintained
 * during deployment, preventing the regression where assets/js files were
 * flattened and broke HTML references.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getFilesFromPath, processFilesForNode } from '../../src/lib/node-files.js';
import { setConfig } from '../../src/core/platform-config.js';

describe('CLI Directory Structure Preservation', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Setup platform config for tests
    setConfig({
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxFilesCount: 1000,
      maxTotalSize: 100 * 1024 * 1024, // 100MB
    });
    // Create a temporary directory with nested structure
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-test-'));
    
    // Create a realistic web app structure
    fs.mkdirSync(path.join(tempDir, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'assets', 'js'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'assets', 'css'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'images'), { recursive: true });
    
    // Create files that would be referenced in HTML
    fs.writeFileSync(path.join(tempDir, 'index.html'), `
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="/assets/css/styles.css">
</head>
<body>
  <script src="/assets/js/app.js"></script>
  <img src="/images/logo.png" alt="Logo">
</body>
</html>
    `);
    
    fs.writeFileSync(path.join(tempDir, 'assets', 'js', 'app.js'), 'console.log("app loaded");');
    fs.writeFileSync(path.join(tempDir, 'assets', 'css', 'styles.css'), 'body { margin: 0; }');
    fs.writeFileSync(path.join(tempDir, 'images', 'logo.png'), 'fake-png-data');
    
    // Create deeply nested structure
    fs.mkdirSync(path.join(tempDir, 'components', 'ui', 'forms'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'components', 'ui', 'forms', 'input.js'), 'export default {};');
  });

  afterEach(async () => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  test('should preserve nested directory structure by default for directory deployments', async () => {
    // Test the core file processing logic directly - this is what was broken
    const files = await getFilesFromPath(tempDir, { pathDetect: false });
    
    // Extract the paths from processed files
    const filePaths = files.map(f => f.path);
    
    // Verify nested paths are preserved
    expect(filePaths).toContain('assets/js/app.js');
    expect(filePaths).toContain('assets/css/styles.css');
    expect(filePaths).toContain('images/logo.png');
    expect(filePaths).toContain('components/ui/forms/input.js');
    expect(filePaths).toContain('index.html');
    
    // Verify paths are NOT flattened (the original bug)
    expect(filePaths).not.toContain('app.js');
    expect(filePaths).not.toContain('styles.css');
    expect(filePaths).not.toContain('logo.png');
    expect(filePaths).not.toContain('input.js');
  });

  test('should flatten when pathDetect is true (default)', async () => {
    // Test with pathDetect enabled (default behavior)  
    const files = await getFilesFromPath(tempDir, { pathDetect: true });
    
    const filePaths = files.map(f => f.path);
    
    // With pathDetect enabled, files should be flattened
    expect(filePaths).toContain('app.js');
    expect(filePaths).toContain('styles.css');
    expect(filePaths).toContain('logo.png');
    expect(filePaths).toContain('input.js');
    expect(filePaths).toContain('index.html');
    
    // Verify nested paths are NOT preserved when flattening
    expect(filePaths).not.toContain('assets/js/app.js');
    expect(filePaths).not.toContain('assets/css/styles.css');
  });

  test('should preserve structure for React/Vite build output', async () => {
    // Create a Vite-style build structure - this is the exact case that was broken
    const viteDir = path.join(tempDir, 'vite-build');
    fs.mkdirSync(viteDir, { recursive: true });
    fs.mkdirSync(path.join(viteDir, 'assets'), { recursive: true });
    
    fs.writeFileSync(path.join(viteDir, 'index.html'), `
<!DOCTYPE html>
<html lang="en">
<head>
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
    fs.writeFileSync(path.join(viteDir, 'assets', 'index-f1e2d3c4.js'), '// Vite bundle');
    fs.writeFileSync(path.join(viteDir, 'assets', 'vue-logo-a1b2c3d4.png'), 'png-data');
    
    const files = await processFilesForNode([viteDir], { pathDetect: false });
    const filePaths = files.map(f => f.path);
    
    // THE CRITICAL TEST: These must NOT be flattened (the original bug)
    expect(filePaths).toContain('assets/index-8ac629b0.css');
    expect(filePaths).toContain('assets/index-f1e2d3c4.js');
    expect(filePaths).toContain('assets/vue-logo-a1b2c3d4.png');
    expect(filePaths).toContain('index.html');
    
    // Verify the original bug is fixed - these should NOT exist
    expect(filePaths).not.toContain('index-8ac629b0.css');
    expect(filePaths).not.toContain('index-f1e2d3c4.js');
    expect(filePaths).not.toContain('vue-logo-a1b2c3d4.png');
  });

  test('should handle deeply nested paths correctly', async () => {
    // Create very deep nesting to test path handling
    const deepPath = path.join(tempDir, 'src', 'components', 'ui', 'forms', 'inputs');
    fs.mkdirSync(deepPath, { recursive: true });
    fs.writeFileSync(path.join(deepPath, 'TextInput.tsx'), 'export const TextInput = () => {};');
    
    const files = await getFilesFromPath(tempDir, { pathDetect: false });
    const filePaths = files.map(f => f.path);
    
    // Verify deep nesting is preserved
    expect(filePaths).toContain('src/components/ui/forms/inputs/TextInput.tsx');
    
    // Verify it's not flattened
    expect(filePaths).not.toContain('TextInput.tsx');
  });

  test('should handle single file with relative path correctly', async () => {
    // Test single file processing
    const singleFile = path.join(tempDir, 'standalone.html');
    fs.writeFileSync(singleFile, '<html>Single file</html>');
    
    const files = await getFilesFromPath(singleFile, { pathDetect: false });
    const filePaths = files.map(f => f.path);
    
    // Single file should just use filename
    expect(filePaths).toContain('standalone.html');
    expect(filePaths).toHaveLength(1);
  });

  test('should flatten directory structure by default when processing directories', async () => {
    // This tests the default behavior - directories are flattened by default
    const files = await getFilesFromPath(tempDir); // No explicit pathDetect option
    
    const filePaths = files.map(f => f.path);
    
    // Should be flattened by default (pathDetect is true by default)
    expect(filePaths).toContain('app.js');
    expect(filePaths).toContain('styles.css');
    expect(filePaths).toContain('logo.png');
    expect(filePaths).toContain('input.js');
    expect(filePaths).toContain('index.html');
    
    // Should NOT preserve nested paths by default
    expect(filePaths).not.toContain('assets/js/app.js');
    expect(filePaths).not.toContain('assets/css/styles.css');
    expect(filePaths).not.toContain('images/logo.png');
  });

  test('should handle mixed file types in nested structure', async () => {
    // Add more file types to test comprehensive support
    fs.writeFileSync(path.join(tempDir, 'assets', 'favicon.ico'), 'ico-data');
    fs.writeFileSync(path.join(tempDir, 'assets', 'manifest.json'), '{"name": "test"}');
    fs.writeFileSync(path.join(tempDir, 'robots.txt'), 'User-agent: *');
    
    const files = await getFilesFromPath(tempDir, { pathDetect: false });
    const filePaths = files.map(f => f.path);
    
    // Verify all file types preserve their paths
    expect(filePaths).toContain('assets/favicon.ico');
    expect(filePaths).toContain('assets/manifest.json');
    expect(filePaths).toContain('robots.txt'); // Root level files
    
    // Verify different extensions work correctly
    expect(filePaths.filter(p => p.endsWith('.ico'))).toHaveLength(1);
    expect(filePaths.filter(p => p.endsWith('.json'))).toHaveLength(1);
    expect(filePaths.filter(p => p.endsWith('.txt'))).toHaveLength(1);
  });

});