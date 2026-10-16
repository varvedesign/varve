#!/usr/bin/env node
/**
 * Launcher for the Varve CLI.
 *
 * Packaged installs ship `dist/varve.mjs` (see `pnpm build:bundle`), a single
 * self-contained file; this launcher imports it and never touches esbuild.
 *
 * In a source checkout without a built bundle it falls back to bundling the
 * TypeScript sources on the fly with esbuild, and says so on stderr, so
 * developers keep a zero-step workflow without the packaged path depending on
 * a dev tool.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function run(file) {
  const { mainAsync } = await import(pathToFileURL(file).href);
  process.exitCode = await mainAsync(process.argv.slice(2));
}

const bundled = fileURLToPath(new URL('../dist/varve.mjs', import.meta.url));
if (existsSync(bundled)) {
  await run(bundled);
} else {
  const entry = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  let buildSync;
  try {
    ({ buildSync } = await import('esbuild'));
  } catch {
    process.stderr.write(
      'varve: no bundled CLI found (dist/varve.mjs) and esbuild is not installed.\n' +
        '       Build one with: pnpm --filter @varve/cli build:bundle\n',
    );
    process.exit(2);
  }
  if (!existsSync(entry)) {
    process.stderr.write('varve: this installation is incomplete (no dist/varve.mjs).\n');
    process.exit(2);
  }
  const dir = mkdtempSync(join(tmpdir(), 'varve-cli-'));
  const outfile = join(dir, 'cli.mjs');
  try {
    buildSync({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      outfile,
      logLevel: 'error',
      legalComments: 'none',
      banner: {
        js: "import { createRequire as __varveCreateRequire } from 'node:module';\nconst require = __varveCreateRequire(import.meta.url);",
      },
    });
    await run(outfile);
  } catch (err) {
    process.stderr.write(
      `varve: bundle failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 2;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}
