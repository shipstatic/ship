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

  // This block modifies module.exports to achieve the desired import style.
  // It's appended to the file, making it independent of the build tool's internal output.
  const axiosStyleExport = `
// Ship SDK: Enable axios-style CommonJS imports
const originalExports = module.exports;
if (originalExports && originalExports.Ship) {
  const Ship = originalExports.Ship;
  module.exports = Ship;
  // Re-assign all original exports as properties of the main export,
  // and add a 'default' property for ESM compatibility.
  Object.assign(module.exports, originalExports, { default: Ship });
}
`;

  // Find and temporarily remove the source map comment to ensure it stays at the end.
  const sourceMapPattern = /(\s*\/\/# sourceMappingURL=.*)$/;
  const sourceMapMatch = content.match(sourceMapPattern);
  const sourceMapComment = sourceMapMatch ? sourceMapMatch[0] : '';

  if (sourceMapMatch) {
    content = content.replace(sourceMapPattern, '');
  }

  // Append the transformation logic and then re-append the source map comment.
  content += `\n${axiosStyleExport}`;
  if (sourceMapComment) {
    content += sourceMapComment;
  }

  fs.writeFileSync(cjsFilePath, content, 'utf-8');
  console.log('✅ Ship SDK CommonJS exports configured');

} catch (err) {
  console.error('❌ Post-build transformation failed:', err.message);
  process.exit(1);
}