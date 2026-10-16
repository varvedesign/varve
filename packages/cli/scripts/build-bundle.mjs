#!/usr/bin/env node
/**
 * Build the self-contained CLI: one ESM file with no workspace or npm
 * dependencies, runnable by `node` from any directory (including paths with
 * spaces) on a machine that has neither pnpm nor esbuild.
 *
 *   node scripts/build-bundle.mjs [--outfile <path>]
 *
 * esbuild is a build-time tool only. The launcher in `bin/` never imports it
 * when `dist/varve.mjs` exists.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = args.indexOf('--outfile');
const outfile =
  flag >= 0 && args[flag + 1] ? resolve(args[flag + 1]) : resolve(here, '../dist/varve.mjs');

mkdirSync(dirname(outfile), { recursive: true });
const result = buildSync({
  entryPoints: [resolve(here, '../src/cli.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  logLevel: 'error',
  legalComments: 'none',
  // Ship a production build. Without this the bundle inherits whatever
  // NODE_ENV the user's shell happens to have (usually none), and the scene
  // package's development-only `devValidate` re-validates the WHOLE document
  // after every operation: a create on a 4,000-node document took 1.3 to 2.3 s
  // for that diagnostic alone. The executor validates every command's input and
  // re-decodes every document it writes, so nothing here depends on the
  // diagnostic. See docs/perf/agent-control-baseline-2026-10-16.md.
  define: { 'process.env.NODE_ENV': '"production"' },
  // Some bundled dependencies are CommonJS and call require() at load time.
  banner: {
    js: "import { createRequire as __varveCreateRequire } from 'node:module';\nconst require = __varveCreateRequire(import.meta.url);",
  },
});
if (result.errors.length > 0) {
  for (const error of result.errors) process.stderr.write(`${error.text}\n`);
  process.exit(2);
}
process.stdout.write(`${outfile}\n`);
