#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultOutput = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../apps/desktop/public/wasm/threads',
);
const outputDir = resolve(process.argv[2] ?? defaultOutput);
const entryName = 'varve_wasm_threads.js';
const helperFiles = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) await visit(target);
    else if (entry.name === 'workerHelpers.js') helperFiles.push(target);
  }
}

try {
  await visit(join(outputDir, 'snippets'));
} catch (error) {
  throw new Error(`Rayon worker helpers not found under ${outputDir}: ${String(error)}`);
}
if (helperFiles.length === 0) {
  throw new Error(`No wasm-bindgen-rayon workerHelpers.js found under ${outputDir}`);
}

const packageUrlFrom = (helperPath) => {
  const entryPath = join(outputDir, entryName);
  return relative(dirname(helperPath), entryPath).split(sep).join('/');
};

for (const helperPath of helperFiles) {
  const source = await readFile(helperPath, 'utf8');
  const directoryImport = /import\((['"])\.\.\/\.\.\/\.\.\1\)/g;
  const explicitImport = `import('${packageUrlFrom(helperPath)}')`;
  const matches = [...source.matchAll(directoryImport)];
  if (matches.length === 0) {
    if (source.includes(explicitImport)) continue;
    throw new Error(`Unrecognized wasm-bindgen-rayon bootstrap in ${helperPath}`);
  }
  if (matches.length !== 1) {
    throw new Error(
      `Expected one package directory import in ${helperPath}, found ${matches.length}`,
    );
  }
  await writeFile(helperPath, source.replace(directoryImport, explicitImport));
}

console.log(`Patched ${helperFiles.length} Rayon worker bootstrap(s) to import ./${entryName}`);
