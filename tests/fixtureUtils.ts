import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Creates a unique temporary directory for a test suite or a single test.
 * @param prefix - Optional prefix for the temporary directory name.
 * @returns A promise that resolves to the path of the created temporary directory.
 */
export async function createTempDir(prefix: string = 'ship-test-'): Promise<string> {
  const tempDirPath = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return tempDirPath;
}

/**
 * Writes a configuration file into the specified directory.
 * @param dirPath - The directory where the file will be written.
 * @param fileName - The name of the file (e.g., '.shiprc', 'package.json', 'ship.config.js').
 * @param content - The content of the file. For JSON/YAML, this can be an object (will be stringified).
 *                  For .js/.cjs files, this must be a string of JavaScript code.
 * @returns A promise that resolves to the full path of the written file.
 * @throws {Error} If content is an object for a .js/.cjs file.
 */
export async function writeConfigFile(
  dirPath: string,
  fileName: string,
  content: string | object
): Promise<string> {
  const filePath = path.join(dirPath, fileName);
  let fileContentString: string;

  if (typeof content === 'object') {
    if (fileName.endsWith('.js') || fileName.endsWith('.cjs')) {
      // For JS config files, content should ideally be a string of JS code
      // For simplicity here, if it's an object, we'll assume it's meant for module.exports or export default
      // This might need refinement based on actual .js config structure.
      // A common pattern for .js is `module.exports = ${JSON.stringify(content)};`
      // Or for ESM: `export default ${JSON.stringify(content)};`
      // For this util, we'll require content to be a string for .js files.
      throw new Error('For .js/.cjs config files, content must be provided as a string of JavaScript code.');
    }
    fileContentString = JSON.stringify(content, null, 2);
  } else {
    fileContentString = content;
  }

  await fs.writeFile(filePath, fileContentString);
  return filePath;
}


/**
 * Cleans up (deletes) the specified temporary directory.
 * Includes safety checks to prevent accidental deletion of important system directories.
 * @param dirPath - The path to the temporary directory to delete.
 */
export async function cleanupTempDir(dirPath: string): Promise<void> {
  if (!dirPath || dirPath === '/' || dirPath === os.tmpdir()) {
    // Safety check to prevent accidental deletion of important directories
    console.warn(`Skipping cleanup of potentially unsafe path: ${dirPath}`);
    return;
  }
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    // Log error but don't let it fail tests typically
    console.error(`Error cleaning up temp directory ${dirPath}:`, error);
  }
}

/**
 * Sets up a temporary test environment with specified file fixtures.
 * Creates a temporary directory, writes fixture files into it, and changes
 * the current working directory to this temporary directory.
 * @param fileFixtures - An array of objects, each specifying a `fileName` and its `content`.
 * @param prefix - Optional prefix for the temporary directory name.
 * @returns A promise that resolves to an object containing the `testDirPath`,
 *          the `originalCwd` (current working directory before change), and a `cleanup` function.
 *          The `cleanup` function restores the original CWD and deletes the temporary directory.
 */
export async function setupTestEnvironment(
  fileFixtures: Array<{ fileName: string; content: string | object }>,
  prefix?: string
): Promise<{ testDirPath: string; originalCwd: string; cleanup: () => Promise<void> }> {
  const testDirPath = await createTempDir(prefix);
  const originalCwd = process.cwd();
  process.chdir(testDirPath);

  for (const fixture of fileFixtures) {
    await writeConfigFile(testDirPath, fixture.fileName, fixture.content);
  }

  const cleanup = async () => {
    process.chdir(originalCwd);
    await cleanupTempDir(testDirPath);
  };

  return { testDirPath, originalCwd, cleanup };
}

/**
 * Generates a string representation of a JavaScript configuration file content.
 * Useful for creating .js or .cjs config files in tests.
 * @param configObject - The configuration object to serialize.
 * @param esm - If true, generates ESM syntax (`export default`); otherwise, generates CommonJS (`module.exports`). Defaults to false.
 * @returns A string containing the JavaScript code for the configuration file.
 */
export function createJsConfigContent(configObject: object, esm: boolean = false): string {
  if (esm) {
    return `export default ${JSON.stringify(configObject, null, 2)};`;
  }
  return `module.exports = ${JSON.stringify(configObject, null, 2)};`;
}
