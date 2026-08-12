/**
 * @file Collect the copyright notices of every package bundled INTO the
 * artifact, and write them beside it.
 *
 * Bundling MIT (and BSD, and ISC) code carries an obligation with it: the
 * copyright notice and permission text must travel with the copy. Since
 * 2026-08-12 `dist/cli.cjs` bundles everything it needs — that is what let the
 * four CLI-only packages leave `dependencies` — so the notices no longer
 * arrive by way of the consumer's own `node_modules`.
 *
 * **The list is DERIVED from the build, never written down.** esbuild's
 * metafile names every input file that went into each bundle, so the set of
 * bundled packages is read from `dist/metafile-*.json` — transitive
 * dependencies included, which a hand-maintained list would miss on its first
 * day. A package that stops being bundled leaves this file by itself.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'THIRD-PARTY-LICENSES.md');

/**
 * `…/node_modules/foo/dist/x.js` → `{ name: 'foo', dir: '…/node_modules/foo' }`.
 *
 * The directory comes from the path the BUNDLER read, never from
 * `require.resolve`: a modern `exports` map does not expose `./package.json`,
 * so resolving by name fails for exactly the packages most likely to be
 * bundled (commander among them). The metafile already knows where the bytes
 * came from.
 */
function packageOf(inputPath) {
  const marker = inputPath.lastIndexOf('node_modules/');
  if (marker === -1) return null;
  const head = inputPath.slice(0, marker + 'node_modules/'.length);
  const rest = inputPath.slice(marker + 'node_modules/'.length).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  return { name, dir: path.resolve(ROOT, head + name) };
}

/** name → directory, from every metafile the build wrote. */
const bundled = new Map();
for (const file of fs.readdirSync(DIST)) {
  if (!file.startsWith('metafile-') || !file.endsWith('.json')) continue;
  const meta = JSON.parse(fs.readFileSync(path.join(DIST, file), 'utf-8'));
  for (const input of Object.keys(meta.inputs ?? {})) {
    const found = packageOf(input);
    if (found && !bundled.has(found.name)) bundled.set(found.name, found.dir);
  }
}

if (bundled.size === 0) {
  console.error('❌ no bundled packages found in the metafiles — is `metafile: true` set?');
  process.exit(1);
}

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE', 'COPYING'];

const sections = [];
const missing = [];
for (const name of [...bundled.keys()].sort()) {
  const dir = bundled.get(name);
  const manifestPath = path.join(dir, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    missing.push(`${name} (no package.json at ${dir})`);
    continue;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const licenseFile = LICENSE_FILES.map((f) => path.join(dir, f)).find((p) => fs.existsSync(p));
  if (!licenseFile) {
    missing.push(`${name} (declares ${manifest.license ?? 'no license'}, ships no license file)`);
    continue;
  }
  sections.push(
    `## ${name} ${manifest.version ?? ''}`.trimEnd() +
      `\n\nLicense: ${manifest.license ?? 'see below'}\n\n\`\`\`\n${fs
        .readFileSync(licenseFile, 'utf-8')
        .trim()}\n\`\`\`\n`,
  );
}

// A package whose notice cannot be found is a licence obligation we cannot
// prove we met, so it fails the build rather than shipping quietly.
if (missing.length) {
  console.error(`❌ no license text found for: ${missing.join(', ')}`);
  process.exit(1);
}

fs.writeFileSync(
  OUT,
  `# Third-party licenses\n\n` +
    `\`@shipstatic/ship\` bundles the packages below into its published artifact.\n` +
    `Their copyright notices travel with that copy, and are reproduced here in\n` +
    `full. This file is GENERATED from the build's own metafile — edit the\n` +
    `bundle, not this list.\n\n${sections.join('\n')}`,
  'utf-8',
);

console.log(`✅ Third-party licenses collected (${sections.length} packages)`);
