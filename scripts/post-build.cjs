const fs = require('fs');
const path = require('path');

/**
 * Post-build script for Ship SDK CommonJS exports
 * 
 * Transforms the tsup-generated CommonJS bundle to support axios-style imports:
 * - `const Ship = require('@shipstatic/ship')` returns the Ship constructor
 * - Named exports are available as properties: Ship.ShipError, Ship.getENV, etc.
 * - Maintains ESM compatibility with Ship.default
 */

const cjsFilePath = path.resolve(__dirname, '../dist/index.cjs');

try {
  let content = fs.readFileSync(cjsFilePath, 'utf-8');

  // Define the axios-style export transformation
  const axiosStyleExport = `
// Ship SDK: Enable axios-style CommonJS imports
pt.default = pt;
module.exports = pt;
`;

  // Find where the final export is done and apply the transformation
  // The new pattern is p(ee,y,module.exports); - we want to add our axios-style export after this
  const finalExportPattern = /p\(ee,y,module\.exports\);/;
  
  if (!finalExportPattern.test(content)) {
    throw new Error("Build output structure has changed. Please update the post-build script.");
  }

  // Replace the axios-style export to work with the new structure
  const newAxiosStyleExport = `
// Ship SDK: Enable axios-style CommonJS imports
const originalExports = module.exports;
const OriginalShip = originalExports.Ship;
module.exports = OriginalShip;
Object.assign(module.exports, {
  Ship: OriginalShip,
  default: OriginalShip,
  ApiHttp: originalExports.ApiHttp,
  ShipError: originalExports.ShipError,
  ShipErrorType: originalExports.ShipErrorType,
  DEFAULT_API: originalExports.DEFAULT_API,
  getENV: originalExports.getENV,
  loadConfig: originalExports.loadConfig,
  calculateMD5: originalExports.calculateMD5,
  filterJunk: originalExports.filterJunk,
  optimizeDeployPaths: originalExports.optimizeDeployPaths,
  pluralize: originalExports.pluralize,
  processFilesForNode: originalExports.processFilesForNode,
  resolveConfig: originalExports.resolveConfig,
  mergeDeployOptions: originalExports.mergeDeployOptions,
  setConfig: originalExports.setConfig,
  getCurrentConfig: originalExports.getCurrentConfig,
  createAccountResource: originalExports.createAccountResource,
  createAliasResource: originalExports.createAliasResource,
  createDeploymentResource: originalExports.createDeploymentResource,
  createKeysResource: originalExports.createKeysResource,
  __setTestEnvironment: originalExports.__setTestEnvironment,
  JUNK_DIRECTORIES: originalExports.JUNK_DIRECTORIES
});
`;

  content = content.replace(finalExportPattern, `p(ee,y,module.exports);${newAxiosStyleExport}`);
  
  // Ensure sourcemap comment stays at the end
  const sourceMapPattern = /(\s*\/\/# sourceMappingURL=.*)$/;
  const sourceMapMatch = content.match(sourceMapPattern);
  if (sourceMapMatch) {
    const sourceMapComment = sourceMapMatch[1];
    content = content.replace(sourceMapPattern, '').trimEnd();
    content += sourceMapComment;
  }

  fs.writeFileSync(cjsFilePath, content, 'utf-8');
  console.log('✅ Ship SDK CommonJS exports configured');

} catch (err) {
  console.error('❌ Post-build transformation failed:', err.message);
  process.exit(1);
}