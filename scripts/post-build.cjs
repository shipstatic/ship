const fs = require('node:fs');
const path = require('node:path');

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
