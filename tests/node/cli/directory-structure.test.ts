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
import { processFilesForNode } from '@/node/core/node-files';
import { setConfig } from '@/shared/core/platform-config';

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
    
    fs.writeFileSync(path.join(tempDir, 'assets', 'js', 'app'), 'console.log("app loaded");');
    fs.writeFileSync(path.join(tempDir, 'assets', 'css', 'styles.css'), 'body { margin: 0; }');
    fs.writeFileSync(path.join(tempDir, 'images', 'logo.png'), 'fake-png-data');
    
    // Create deeply nested structure
    fs.mkdirSync(path.join(tempDir, 'components', 'ui', 'forms'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'components', 'ui', 'forms', 'input'), 'export default {};');
  });

  afterEach(async () => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  test('should preserve nested directory structure by default for directory deployments', async () => {
    // Test the core file processing logic directly - this is what was broken
    const files = await processFilesForNode([tempDir], { pathDetect: false });
    
    // Extract the paths from processed files
    const filePaths = files.map(f => f.path);
    
    // Verify nested paths are preserved
    expect(filePaths).toContain('assets/js/app');
    expect(filePaths).toContain('assets/css/styles.css');
    expect(filePaths).toContain('images/logo.png');
    expect(filePaths).toContain('components/ui/forms/input');
    expect(filePaths).toContain('index.html');
    
    // Verify paths are NOT flattened (the original bug)
    expect(filePaths).not.toContain('app');
    expect(filePaths).not.toContain('styles.css');
    expect(filePaths).not.toContain('logo.png');
    expect(filePaths).not.toContain('input');
  });

  test('should optimize paths when pathDetect is true (default)', async () => {
    // Test with pathDetect enabled (default behavior)  
    const files = await processFilesForNode([tempDir], { pathDetect: true });
    
    const filePaths = files.map(f => f.path);
    
    // With pathDetect enabled, structure is preserved since no common directory exists
    // (index.html is at root, others are in subdirectories)
    expect(filePaths).toContain('index.html');
    expect(filePaths).toContain('assets/js/app');
    expect(filePaths).toContain('assets/css/styles.css');
    expect(filePaths).toContain('images/logo.png');
    expect(filePaths).toContain('components/ui/forms/input');
    
    // Verify individual filenames are NOT at root level since they have no common directory
    expect(filePaths).not.toContain('app');
    expect(filePaths).not.toContain('styles.css');
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
    fs.writeFileSync(path.join(viteDir, 'assets', 'index-f1e2d3c4'), '// Vite bundle');
    fs.writeFileSync(path.join(viteDir, 'assets', 'vue-logo-a1b2c3d4.png'), 'png-data');
    
    const files = await processFilesForNode([viteDir], { pathDetect: false });
    const filePaths = files.map(f => f.path);
    
    // THE CRITICAL TEST: These must NOT be flattened (the original bug)
    expect(filePaths).toContain('assets/index-8ac629b0.css');
    expect(filePaths).toContain('assets/index-f1e2d3c4');
    expect(filePaths).toContain('assets/vue-logo-a1b2c3d4.png');
    expect(filePaths).toContain('index.html');
    
    // Verify the original bug is fixed - these should NOT exist
    expect(filePaths).not.toContain('index-8ac629b0.css');
    expect(filePaths).not.toContain('index-f1e2d3c4');
    expect(filePaths).not.toContain('vue-logo-a1b2c3d4.png');
  });

  test('should handle deeply nested paths correctly', async () => {
    // Create very deep nesting to test path handling
    const deepPath = path.join(tempDir, 'src', 'components', 'ui', 'forms', 'inputs');
    fs.mkdirSync(deepPath, { recursive: true });
    fs.writeFileSync(path.join(deepPath, 'TextInput.tsx'), 'export const TextInput = () => {};');
    
    const files = await processFilesForNode([tempDir], { pathDetect: false });
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
    
    const files = await processFilesForNode([singleFile], { pathDetect: false });
    const filePaths = files.map(f => f.path);
    
    // Single file should just use filename
    expect(filePaths).toContain('standalone.html');
    expect(filePaths).toHaveLength(1);
  });

  test('should optimize paths by default when processing directories', async () => {
    // This tests the default behavior - paths are optimized by default
    const files = await processFilesForNode([tempDir]); // No explicit pathDetect option
    
    const filePaths = files.map(f => f.path);
    
    // Should preserve structure by default since no common directory exists
    expect(filePaths).toContain('index.html');
    expect(filePaths).toContain('assets/js/app');
    expect(filePaths).toContain('assets/css/styles.css');
    expect(filePaths).toContain('images/logo.png');
    expect(filePaths).toContain('components/ui/forms/input');
    
    // Should NOT have individual filenames at root level  
    expect(filePaths).not.toContain('app');
    expect(filePaths).not.toContain('styles.css');
    expect(filePaths).not.toContain('logo.png');
  });

  test('should handle mixed file types in nested structure', async () => {
    // Add more file types to test comprehensive support
    fs.writeFileSync(path.join(tempDir, 'assets', 'favicon.ico'), 'ico-data');
    fs.writeFileSync(path.join(tempDir, 'assets', 'manifest.json'), '{"name": "test"}');
    fs.writeFileSync(path.join(tempDir, 'robots.txt'), 'User-agent: *');
    
    const files = await processFilesForNode([tempDir], { pathDetect: false });
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