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
 * bundled packages is read from `build-meta/*.json` — transitive dependencies
 * included, which a hand-maintained list would miss on its first day. A package
 * that stops being bundled leaves this file by itself.
 *
 * **And the derivation is only as honest as its inputs, which is a lesson this
 * file paid for.** The metafiles used to live in `dist/` under tsup's own
 * `metafile-{format}.json` names, where two of the three concurrent builds
 * collided on each name; a lost metafile meant a bundle's inputs were never
 * read, and the notice under-reported with a green build. `tsup.config.ts`
 * gives each bundle its own path now — and `uncoveredBundles` below is the
 * half that refuses to trust that, by checking every bundle the package SHIPS
 * against the bundles the metafiles actually describe. Derived from
 * `package.json`, so it answers about the published artifact rather than about
 * the build config that happened to produce it.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const META_DIR = path.join(ROOT, 'build-meta');
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

/** Every JS bundle the package publishes, read from `exports` + `bin`. */
function shippedBundles(manifest) {
  const found = new Set();
  const walk = (node) => {
    if (typeof node === 'string') {
      if (/^\.\/dist\/.*\.(js|cjs|mjs)$/.test(node)) found.add(node.slice(2));
      return;
    }
    if (node && typeof node === 'object') for (const v of Object.values(node)) walk(v);
  };
  walk(manifest.exports);
  walk(manifest.bin);
  return [...found].sort();
}

/** The bundles the metafiles actually describe. */
function describedBundles(metafiles) {
  const found = new Set();
  for (const meta of metafiles) {
    for (const out of Object.keys(meta.outputs ?? {})) {
      if (!out.endsWith('.map')) found.add(out);
    }
  }
  return [...found].sort();
}

/**
 * A shipped bundle whose inputs no metafile describes — so its bundled
 * packages were never asked for their notices. Empty is the only safe answer.
 */
function uncoveredBundles(manifest, metafiles) {
  const described = new Set(describedBundles(metafiles));
  return shippedBundles(manifest).filter((b) => !described.has(b));
}

/** name → directory, over every metafile the build wrote. */
function bundledPackages(metafiles) {
  const bundled = new Map();
  for (const meta of metafiles) {
    for (const input of Object.keys(meta.inputs ?? {})) {
      const found = packageOf(input);
      if (found && !bundled.has(found.name)) bundled.set(found.name, found.dir);
    }
  }
  return bundled;
}

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE', 'COPYING'];

/** Read every metafile the build wrote, failing loudly on an unreadable one. */
function readMetafiles(dir = META_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const p = path.join(dir, f);
      try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      } catch (err) {
        throw new Error(`metafile ${f} is unreadable (${err.message}) — the build wrote it wrong`);
      }
    });
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

  let metafiles;
  try {
    metafiles = readMetafiles();
  } catch (err) {
    // One failure shape for every way this can go wrong: a message and exit 1,
    // never a stack trace. An unreadable metafile used to surface as a raw
    // `JSON.parse` throw from inside a loop, which said nothing about which
    // file or why.
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  // A bundle nobody described is a bundle whose licences nobody collected.
  const uncovered = uncoveredBundles(manifest, metafiles);
  if (uncovered.length) {
    console.error(
      `❌ no metafile describes: ${uncovered.join(', ')} — the licence list would ` +
        `under-report what the artifact bundles. Did a build fail, or two builds ` +
        `write one metafile path?`,
    );
    process.exit(1);
  }

  const bundled = bundledPackages(metafiles);
  if (bundled.size === 0) {
    console.error('❌ no bundled packages found in the metafiles — is the metafile plugin set?');
    process.exit(1);
  }

  const sections = [];
  const missing = [];
  for (const name of [...bundled.keys()].sort()) {
    const dir = bundled.get(name);
    const manifestPath = path.join(dir, 'package.json');
    if (!fs.existsSync(manifestPath)) {
      missing.push(`${name} (no package.json at ${dir})`);
      continue;
    }
    const dep = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const licenseFile = LICENSE_FILES.map((f) => path.join(dir, f)).find((p) => fs.existsSync(p));
    if (!licenseFile) {
      missing.push(`${name} (declares ${dep.license ?? 'no license'}, ships no license file)`);
      continue;
    }
    sections.push(
      `## ${name} ${dep.version ?? ''}`.trimEnd() +
        `\n\nLicense: ${dep.license ?? 'see below'}\n\n\`\`\`\n${fs
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

  console.log(
    `✅ Third-party licenses collected (${sections.length} packages, ` +
      `${metafiles.length} bundles described)`,
  );
}

if (require.main === module) main();

module.exports = {
  packageOf,
  shippedBundles,
  describedBundles,
  uncoveredBundles,
  bundledPackages,
  readMetafiles,
  META_DIR,
};
