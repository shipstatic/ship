/**
 * @file Config Directory Traversal Integration Tests
 * 
 * These tests verify that cosmiconfig properly traverses directories
 * and falls back to the home directory for config files. This is critical
 * for ensuring the CLI works correctly regardless of where it's run from.
 * 
 * Key scenarios tested:
 * 1. Directory tree traversal (current → parent → parent → home)
 * 2. Home directory fallback when no local config found
 * 3. Specific config file loading via -c flag
 * 4. Multiple config file format support (.shiprc, package.json, etc.)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig } from '@/core/config';

// Mock the environment detection
vi.mock('@/lib/env', () => ({
  getENV: vi.fn(() => 'node')
}));

// Mock the os module to control homedir
vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: vi.fn()
  };
});

describe('Config Directory Traversal Integration Tests', () => {
  let tempDir: string;
  let homeDir: string;
  let originalHome: string | undefined;
  let testDirs: {
    deepNested: string;
    middle: string;
    shallow: string;
    home: string;
  };

  beforeEach(async () => {
    // Create a temporary directory structure for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-config-test-'));
    
    // Create nested directory structure: home/shallow/middle/deepNested
    testDirs = {
      home: path.join(tempDir, 'home'),
      shallow: path.join(tempDir, 'home', 'shallow'),
      middle: path.join(tempDir, 'home', 'shallow', 'middle'),
      deepNested: path.join(tempDir, 'home', 'shallow', 'middle', 'deepNested')
    };

    await fs.mkdir(testDirs.home, { recursive: true });
    await fs.mkdir(testDirs.shallow, { recursive: true });
    await fs.mkdir(testDirs.middle, { recursive: true });
    await fs.mkdir(testDirs.deepNested, { recursive: true });

    // Mock the home directory to our test home
    originalHome = process.env.HOME;
    process.env.HOME = testDirs.home;
    
    // Mock os.homedir() to return our test home directory
    vi.mocked(os.homedir).mockReturnValue(testDirs.home);
  });

  afterEach(async () => {
    // Restore original home directory
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
    
    vi.restoreAllMocks();
  });

  describe('Directory Tree Traversal', () => {
    it('should find config in current directory', async () => {
      // Create config in the deepest directory
      const configPath = path.join(testDirs.deepNested, '.shiprc');
      await fs.writeFile(configPath, JSON.stringify({
        apiKey: 'deep-nested-key',
        apiUrl: 'https://deep.api.com'
      }));

      // Change to the deepest directory and load config
      const originalCwd = process.cwd();
      process.chdir(testDirs.deepNested);

      try {
        const config = await loadConfig();
        expect(config).toEqual({
          apiKey: 'deep-nested-key',
          apiUrl: 'https://deep.api.com'
        });
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should traverse up to parent directory when not found locally', async () => {
      // Create config in middle directory
      const configPath = path.join(testDirs.middle, '.shiprc');
      await fs.writeFile(configPath, JSON.stringify({
        apiKey: 'middle-key',
        apiUrl: 'https://middle.api.com'
      }));

      // Change to the deepest directory (no config there)
      const originalCwd = process.cwd();
      process.chdir(testDirs.deepNested);

      try {
        const config = await loadConfig();
        expect(config).toEqual({
          apiKey: 'middle-key', 
          apiUrl: 'https://middle.api.com'
        });
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should traverse multiple levels up to find config', async () => {
      // Create config in shallow directory (2 levels up from deepNested)
      const configPath = path.join(testDirs.shallow, '.shiprc');
      await fs.writeFile(configPath, JSON.stringify({
        apiKey: 'shallow-key',
        apiUrl: 'https://shallow.api.com'
      }));

      // Change to the deepest directory
      const originalCwd = process.cwd();
      process.chdir(testDirs.deepNested);

      try {
        const config = await loadConfig();
        expect(config).toEqual({
          apiKey: 'shallow-key',
          apiUrl: 'https://shallow.api.com'
        });
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('Home Directory Fallback', () => {
    it('should fall back to home directory when no local config found', async () => {
      // Create config only in home directory
      const homeConfigPath = path.join(testDirs.home, '.shiprc');
      await fs.writeFile(homeConfigPath, JSON.stringify({
        apiKey: 'home-fallback-key',
        apiUrl: 'https://home.api.com'
      }));

      // Change to the deepest directory (no config in any parent)
      const originalCwd = process.cwd();
      process.chdir(testDirs.deepNested);

      try {
        const config = await loadConfig();
        expect(config).toEqual({
          apiKey: 'home-fallback-key',
          apiUrl: 'https://home.api.com'
        });
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should prioritize closer config over home directory fallback', async () => {
      // Create config in both home and middle directory
      const homeConfigPath = path.join(testDirs.home, '.shiprc');
      await fs.writeFile(homeConfigPath, JSON.stringify({
        apiKey: 'home-key',
        apiUrl: 'https://home.api.com'
      }));

      const middleConfigPath = path.join(testDirs.middle, '.shiprc');
      await fs.writeFile(middleConfigPath, JSON.stringify({
        apiKey: 'middle-priority-key',
        apiUrl: 'https://middle.api.com'
      }));

      // Change to the deepest directory
      const originalCwd = process.cwd();
      process.chdir(testDirs.deepNested);

      try {
        const config = await loadConfig();
        // Should find middle config, not home config
        expect(config).toEqual({
          apiKey: 'middle-priority-key',
          apiUrl: 'https://middle.api.com'
        });
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should work from outside home directory tree entirely', async () => {
      // Create a completely separate directory outside the home tree
      const outsideDir = path.join(tempDir, 'outside');
      await fs.mkdir(outsideDir, { recursive: true });

      // Create config only in home directory
      const homeConfigPath = path.join(testDirs.home, '.shiprc');
      await fs.writeFile(homeConfigPath, JSON.stringify({
        apiKey: 'outside-home-key',
        apiUrl: 'https://outside.api.com'
      }));

      // Change to the outside directory
      const originalCwd = process.cwd();
      process.chdir(outsideDir);

      try {
        const config = await loadConfig();
        // Should still find home config even from completely outside directory
        expect(config).toEqual({
          apiKey: 'outside-home-key',
          apiUrl: 'https://outside.api.com'
        });
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('Specific Config File Loading', () => {
    it('should load specific config file when path provided', async () => {
      // Create config files in different locations
      const homeConfigPath = path.join(testDirs.home, '.shiprc');
      await fs.writeFile(homeConfigPath, JSON.stringify({
        apiKey: 'home-key',
        apiUrl: 'https://home.api.com'
      }));

      const customConfigPath = path.join(testDirs.middle, 'custom-ship.json');
      await fs.writeFile(customConfigPath, JSON.stringify({
        apiKey: 'custom-file-key',
        apiUrl: 'https://custom.api.com'
      }));

      // Change to a different directory
      const originalCwd = process.cwd();
      process.chdir(testDirs.deepNested);

      try {
        // Load specific config file
        const config = await loadConfig(customConfigPath);
        expect(config).toEqual({
          apiKey: 'custom-file-key',
          apiUrl: 'https://custom.api.com'
        });
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should handle relative paths for specific config files', async () => {
      // Create custom config in middle directory
      const customConfigPath = path.join(testDirs.middle, 'ship.config.json');
      await fs.writeFile(customConfigPath, JSON.stringify({
        apiKey: 'relative-path-key',
        apiUrl: 'https://relative.api.com'
      }));

      // Change to deepNested directory
      const originalCwd = process.cwd();
      process.chdir(testDirs.deepNested);

      try {
        // Load config using relative path
        const relativePath = '../ship.config.json';
        const config = await loadConfig(relativePath);
        expect(config).toEqual({
          apiKey: 'relative-path-key',
          apiUrl: 'https://relative.api.com'
        });
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('Multiple Config File Formats', () => {
    it('should support .shiprc format', async () => {
      const configPath = path.join(testDirs.home, '.shiprc');
      await fs.writeFile(configPath, JSON.stringify({
        apiKey: 'shiprc-key',
        apiUrl: 'https://shiprc.api.com'
      }));

      const originalCwd = process.cwd();
      process.chdir(testDirs.deepNested);

      try {
        const config = await loadConfig();
        expect(config).toEqual({
          apiKey: 'shiprc-key',
          apiUrl: 'https://shiprc.api.com'
        });
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should support package.json with ship key', async () => {
      const packageJsonPath = path.join(testDirs.middle, 'package.json');
      await fs.writeFile(packageJsonPath, JSON.stringify({
        name: 'test-package',
        version: '1.0.0',
        ship: {
          apiKey: 'package-json-key',
          apiUrl: 'https://package.api.com'
        }
      }));

      const originalCwd = process.cwd();
      process.chdir(testDirs.deepNested);

      try {
        const config = await loadConfig();
        expect(config).toEqual({
          apiKey: 'package-json-key',
          apiUrl: 'https://package.api.com'
        });
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should prioritize .shiprc over package.json when both exist', async () => {
      // Create both config files in the same directory
      const shiprcPath = path.join(testDirs.middle, '.shiprc');
      await fs.writeFile(shiprcPath, JSON.stringify({
        apiKey: 'shiprc-priority-key',
        apiUrl: 'https://shiprc-priority.api.com'
      }));

      const packageJsonPath = path.join(testDirs.middle, 'package.json');
      await fs.writeFile(packageJsonPath, JSON.stringify({
        name: 'test-package',
        ship: {
          apiKey: 'package-json-key',
          apiUrl: 'https://package.api.com'
        }
      }));

      const originalCwd = process.cwd();
      process.chdir(testDirs.deepNested);

      try {
        const config = await loadConfig();
        // .shiprc should take priority
        expect(config).toEqual({
          apiKey: 'shiprc-priority-key',
          apiUrl: 'https://shiprc-priority.api.com'
        });
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('Error Handling', () => {
    it('should return empty config when no config files found anywhere', async () => {
      // Don't create any config files
      const originalCwd = process.cwd();
      process.chdir(testDirs.deepNested);

      try {
        const config = await loadConfig();
        expect(config).toEqual({});
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should handle malformed config files gracefully', async () => {
      // Create malformed JSON config
      const configPath = path.join(testDirs.home, '.shiprc');
      await fs.writeFile(configPath, '{ invalid json }');

      const originalCwd = process.cwd();
      process.chdir(testDirs.deepNested);

      try {
        // Should throw an error when file is malformed (cosmiconfig parses it as valid JSON object)
        await expect(loadConfig()).rejects.toThrow('Configuration validation failed');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should handle non-existent specific config file', async () => {
      const originalCwd = process.cwd();
      process.chdir(testDirs.deepNested);

      try {
        // Try to load a non-existent specific config file
        // Our implementation returns empty config when file doesn't exist (graceful handling)
        const config = await loadConfig('/non/existent/config.json');
        expect(config).toEqual({});
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('Linux Server Scenarios', () => {
    it('should work when run from /opt/app directory', async () => {
      // Simulate Linux server directory structure
      const optDir = path.join(tempDir, 'opt', 'app');
      await fs.mkdir(optDir, { recursive: true });

      // Config only in home directory
      const homeConfigPath = path.join(testDirs.home, '.shiprc');
      await fs.writeFile(homeConfigPath, JSON.stringify({
        apiKey: 'linux-server-key',
        apiUrl: 'https://production.api.com'
      }));

      const originalCwd = process.cwd();
      process.chdir(optDir);

      try {
        const config = await loadConfig();
        expect(config).toEqual({
          apiKey: 'linux-server-key',
          apiUrl: 'https://production.api.com'
        });
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should work when run from /var/www directory', async () => {
      // Simulate web server directory structure
      const varWwwDir = path.join(tempDir, 'var', 'www', 'html');
      await fs.mkdir(varWwwDir, { recursive: true });

      // Config only in home directory
      const homeConfigPath = path.join(testDirs.home, '.shiprc');
      await fs.writeFile(homeConfigPath, JSON.stringify({
        apiKey: 'webserver-key',
        apiUrl: 'https://webserver.api.com'
      }));

      const originalCwd = process.cwd();
      process.chdir(varWwwDir);

      try {
        const config = await loadConfig();
        expect(config).toEqual({
          apiKey: 'webserver-key',
          apiUrl: 'https://webserver.api.com'
        });
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should work when run from /tmp directory', async () => {
      // Create temp directory
      const tmpProjectDir = path.join(tempDir, 'tmp', 'project');
      await fs.mkdir(tmpProjectDir, { recursive: true });

      // Config only in home directory
      const homeConfigPath = path.join(testDirs.home, '.shiprc');
      await fs.writeFile(homeConfigPath, JSON.stringify({
        apiKey: 'tmp-dir-key',
        apiUrl: 'https://tmp.api.com'
      }));

      const originalCwd = process.cwd();
      process.chdir(tmpProjectDir);

      try {
        const config = await loadConfig();
        expect(config).toEqual({
          apiKey: 'tmp-dir-key',
          apiUrl: 'https://tmp.api.com'
        });
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});