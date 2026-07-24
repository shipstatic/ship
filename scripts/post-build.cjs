const fs = require('node:fs');
const path = require('node:path');

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

// Fence: the browser bundle must never reference Node builtins. A bare or
// node:-prefixed import surviving into dist/browser.js means the tsup alias
// table missed a spelling — it breaks every strict bundler downstream
// (esbuild sites, Cloudflare Workers). Fail the build here, not a consumer.
try {
  const browserBundle = fs.readFileSync(path.join(__dirname, '..', 'dist', 'browser.js'), 'utf-8');
  const nodeBuiltinRef = browserBundle.match(
    /import\(\s*["'](?:node:)?(?:fs|crypto|os|module|path|stream|child_process)["']\s*\)|from\s*["'](?:node:)[a-z_]+["']/,
  );
  if (nodeBuiltinRef) {
    console.error(`❌ dist/browser.js references a Node builtin: ${nodeBuiltinRef[0]}`);
    process.exit(1);
  }
  console.log('✅ Browser bundle is free of Node builtins');
} catch (err) {
  console.error('❌ Browser bundle fence failed:', err.message);
  process.exit(1);
}
