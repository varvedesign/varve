#!/usr/bin/env node
/**
 * Real-toolchain verification for the React + Tailwind code target.
 *
 * Builds the exported bundle inside a pinned consumer project in a temp
 * directory (never inside this repository), with the real Tailwind
 * production CSS-generation path — dynamically constructed class names
 * would pass a fake check and fail a real build, so the source scanner
 * must find the emitted literal classes.
 *
 * What a PASS means: dependencies resolved, `tsc --noEmit` clean, `vite
 * build` produced a CSS bundle that contains the emitted utilities, every
 * `assets/` reference resolves to a file in the bundle, and no unportable
 * source (blob:, file:, http(s)://) appears in the generated code. Browser
 * rendering itself is covered by the E2E suite, not by this script.
 *
 * Usage: node scripts/codegen-verify/verify-web.mjs <bundle-dir>
 * The bundle directory is produced by running the harness exporter:
 *   VARVE_CODEGEN_VERIFY_OUT=/tmp/varve-verify-bundle \
 *     pnpm vitest run packages/codegen/src/__tests__/harness-export.test.ts
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const bundleDir = resolve(process.argv[2] ?? process.env.VARVE_CODEGEN_VERIFY_BUNDLE ?? '');
if (!bundleDir || !existsSync(bundleDir)) {
  console.error('verify-web: bundle directory required (see header comment for usage)');
  process.exit(1);
}

// Pinned consumer profile — a silent "latest" would make a PASS meaningless
// across machines and months.
const DEPS = {
  react: '18.3.1',
  'react-dom': '18.3.1',
};

const DEV_DEPS = {
  '@types/react': '18.3.12',
  '@types/react-dom': '18.3.1',
  '@vitejs/plugin-react': '4.3.4',
  autoprefixer: '10.4.20',
  postcss: '8.4.49',
  tailwindcss: '3.4.15',
  typescript: '5.6.3',
  vite: '5.4.11',
};

const log = (...parts) => console.log('verify-web:', ...parts);

function step(name, cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    console.error(`verify-web: FAILED at ${name}`);
    console.error(result.stdout?.slice(-4000));
    console.error(result.stderr?.slice(-4000));
    process.exit(1);
  }
  log(`${name} ok`);
  return result;
}

// ── Inspect the bundle before building anything ─────────────────────────────
const entries = readdirSync(bundleDir);
const componentFiles = entries.filter((f) => f.endsWith('.tsx'));
if (componentFiles.length === 0) {
  console.error('verify-web: no .tsx components in the bundle');
  process.exit(1);
}
const manifestPath = join(bundleDir, 'varve-codegen.manifest.json');
if (!existsSync(manifestPath)) {
  console.error('verify-web: bundle is missing varve-codegen.manifest.json');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

let unportable = null;
for (const file of componentFiles) {
  const text = readFileSync(join(bundleDir, file), 'utf8');
  const bad = text.match(/(blob:|file:|https?:\/\/)[^\s"')]+/);
  if (bad) unportable = `${file}: ${bad[0]}`;
}
if (unportable) {
  console.error(`verify-web: unportable source reference — ${unportable}`);
  process.exit(1);
}

for (const [path, record] of Object.entries(manifest.files)) {
  if (record.role === 'asset' && !existsSync(join(bundleDir, path))) {
    console.error(`verify-web: manifest asset missing from bundle — ${path}`);
    process.exit(1);
  }
}
for (const file of componentFiles) {
  const text = readFileSync(join(bundleDir, file), 'utf8');
  for (const match of text.matchAll(/assets\/[\w.-]+/g)) {
    if (!existsSync(join(bundleDir, match[0]))) {
      console.error(`verify-web: ${file} references missing asset ${match[0]}`);
      process.exit(1);
    }
  }
}
log('bundle inspection ok');

// ── Scaffold the consumer project ───────────────────────────────────────────
const project = join(tmpdir(), `varve-codegen-verify-${Date.now()}`);
mkdirSync(join(project, 'src'), { recursive: true });
mkdirSync(join(project, 'bundle'), { recursive: true });
cpSync(bundleDir, join(project, 'bundle'), { recursive: true });

const exports_ = componentFiles.map((file) => {
  const stem = file.replace(/\.tsx$/, '');
  const text = readFileSync(join(bundleDir, file), 'utf8');
  const match = text.match(/export function (\w+)/);
  return { stem, fn: match?.[1] ?? stem };
});

writeFileSync(
  join(project, 'package.json'),
  JSON.stringify(
    {
      name: 'varve-codegen-verify',
      private: true,
      type: 'module',
      scripts: { build: 'vite build', typecheck: 'tsc --noEmit' },
      dependencies: DEPS,
      devDependencies: DEV_DEPS,
    },
    null,
    2,
  ),
);
// pnpm 11 blocks dependency lifecycle scripts interactively; the consumer
// build needs none of them (esbuild resolves its platform binary without
// the postinstall), so installs run with scripts explicitly off.
writeFileSync(
  join(project, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ['src', 'bundle'],
    },
    null,
    2,
  ),
);
writeFileSync(
  join(project, 'vite.config.ts'),
  [
    "import react from '@vitejs/plugin-react';",
    "import { defineConfig } from 'vite';",
    'export default defineConfig({',
    '  plugins: [react()],',
    '  build: { cssCodeSplit: false },',
    '});',
    '',
  ].join('\n'),
);
// Tailwind v3 generates through the PostCSS plugin — the real production
// path the bundle must survive.
writeFileSync(
  join(project, 'postcss.config.js'),
  ['export default { plugins: { tailwindcss: {}, autoprefixer: {} } };', ''].join('\n'),
);
writeFileSync(
  join(project, 'tailwind.config.js'),
  [
    '/** @type {import("tailwindcss").Config} */',
    'export default {',
    '  content: ["./bundle/**/*.tsx"],',
    '  theme: { extend: {} },',
    '  plugins: [],',
    '};',
    '',
  ].join('\n'),
);
writeFileSync(
  join(project, 'index.html'),
  [
    '<!doctype html>',
    '<html><head><meta charset="utf-8" /></head>',
    '<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
    '',
  ].join('\n'),
);
writeFileSync(
  join(project, 'src', 'main.tsx'),
  [
    "import { createRoot } from 'react-dom/client';",
    ...exports_.map(({ stem, fn }) => `import { ${fn} } from '../bundle/${stem}';`),
    '',
    'const app = (',
    '  <div>',
    ...exports_.map(({ fn }) => `    <${fn} />`),
    '  </div>',
    ');',
    "createRoot(document.getElementById('root')!).render(app);",
    '',
  ].join('\n'),
);
writeFileSync(
  join(project, 'src', 'index.css'),
  ['@tailwind base;', '@tailwind components;', '@tailwind utilities;', ''].join('\n'),
);
if (!readFileSync(join(project, 'src', 'main.tsx'), 'utf8').includes('index.css')) {
  writeFileSync(
    join(project, 'src', 'main.tsx'),
    `import './index.css';\n${readFileSync(join(project, 'src', 'main.tsx'), 'utf8')}`,
  );
}

// ── Install, typecheck, production build ────────────────────────────────────
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
step('install', pnpm, ['install', '--ignore-scripts'], project);
step('typecheck', pnpm, ['exec', 'tsc', '--noEmit'], project);
step('vite build (tailwind production CSS)', pnpm, ['exec', 'vite', 'build'], project);

const distFiles = readdirSync(join(project, 'dist'), { recursive: true }).map(String);
const cssFile = distFiles.find((f) => f.endsWith('.css'));
if (!cssFile) {
  console.error('verify-web: production build produced no CSS — Tailwind did not run');
  process.exit(1);
}
const css = readFileSync(join(project, 'dist', cssFile), 'utf8');
if (!css.includes('.absolute') || css.length < 2000) {
  console.error('verify-web: generated CSS lacks the emitted utilities (source scanning failed)');
  process.exit(1);
}
log(`tailwind CSS generated (${css.length} bytes)`);

const pnpmVersion = spawnSync(pnpm, ['--version'], { encoding: 'utf8' }).stdout.trim();
log(
  `PASS — compiled with pnpm ${pnpmVersion}, tailwindcss ${DEV_DEPS.tailwindcss}, vite ${DEV_DEPS.vite}, react ${DEPS.react}`,
);
log(`consumer project kept for inspection at ${project} (delete when done)`);
