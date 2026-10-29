#!/usr/bin/env node
/**
 * Every committed relative import must resolve to a committed file.
 *
 * Why this exists: `master` shipped `export * from './nodeResize'` in
 * `packages/scene/src/index.ts` and four `./bundle-assets` imports in
 * `packages/codegen`, while neither module was tracked. Both files existed only
 * as untracked files in one working tree, so a fresh clone failed with
 * `TS2307: Cannot find module` and no gate noticed — the working tree that
 * produced the commits resolved them fine.
 *
 * The check reads the committed tree, not the working tree, so it reports what a
 * clone would actually get and never fails on someone's in-flight edit.
 *
 * Resolves the specifier forms TypeScript/ESM/Vite use:
 *   - `./x`                → x.ts / x.tsx / x.mts / x.cts / x/index.ts / x/index.tsx
 *   - `./x.js`             → x.ts (NodeNext style `.js` specifier for a `.ts` file)
 *   - `./worker?raw`       → worker.ts (Vite query suffix)
 *
 * Bare specifiers resolve through node_modules and are out of scope.
 */
import { execFileSync } from 'node:child_process';

const SOURCE = /\.(?:ts|tsx|mts|cts)$/;
const RESOLVABLE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|json)$/;
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
/**
 * Asset specifiers are resolved by the bundler (Vite answers them, and CSS
 * modules have no file to point at), so they are not module-graph edges this
 * check can or should verify.
 */
const ASSET = /\.(?:css|svg|png|jpe?g|gif|webp|avif|woff2?|ttf|otf|wasm|mp4|webm)$/;

let tracked;
try {
  tracked = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean);
} catch (error) {
  console.error('audit-committed-imports: cannot read HEAD; run inside a git checkout.');
  throw error;
}

const committed = new Set(tracked);
const readCommitted = (path) =>
  execFileSync('git', ['show', `HEAD:${path}`], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

/** Drop block and line comments so prose cannot look like an import. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](\.[^'"]+)['"]/g;

/** Candidate committed paths a relative specifier could denote. */
function candidates(fromFile, specifier) {
  const bare = specifier.replace(/[?#].*$/, '');
  const joined = new URL(bare, `file:///${fromFile}`).pathname.slice(1).replace(/\/$/, '');
  const out = [];
  // NodeNext: `./x.js` in source means `x.ts` on disk.
  if (RESOLVABLE.test(joined)) {
    const stripped = joined.replace(RESOLVABLE, '');
    for (const ext of EXTENSIONS) out.push(`${stripped}${ext}`);
    out.push(joined);
  }
  for (const ext of EXTENSIONS) out.push(`${joined}${ext}`);
  for (const ext of EXTENSIONS) out.push(`${joined}/index${ext}`);
  return out;
}

let checked = 0;
const violations = [];

for (const file of tracked) {
  if (!SOURCE.test(file)) continue;
  const source = stripComments(readCommitted(file));
  for (const match of source.matchAll(IMPORT)) {
    const specifier = match[1];
    // A template literal (`./${stem}.module.css`) is a runtime-computed path,
    // not a static edge, and assets belong to the bundler.
    if (specifier.includes('${')) continue;
    if (ASSET.test(specifier.replace(/[?#].*$/, ''))) continue;
    checked += 1;
    if (candidates(file, specifier).some((candidate) => committed.has(candidate))) continue;
    violations.push(`${file}  →  '${specifier}'`);
  }
}

if (violations.length === 0) {
  console.log(
    `audit-committed-imports — clean (${checked} relative imports across ${tracked.length} committed files).`,
  );
  process.exit(0);
}

console.error(
  `audit-committed-imports — ${violations.length} committed import(s) have no committed target:\n`,
);
for (const violation of [...new Set(violations)]) console.error(`  ${violation}`);
console.error('\nA fresh clone cannot resolve these. Commit the module or drop the import.');
process.exit(1);
