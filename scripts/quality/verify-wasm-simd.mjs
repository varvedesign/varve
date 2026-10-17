#!/usr/bin/env node
/**
 * Verify that a WASM artifact labelled "SIMD" actually contains vector
 * instructions, and that the baseline artifact does not.
 *
 * A `-C target-feature=+simd128` build flag is not evidence of vectorized work:
 * the flag can be set on code that has nothing to vectorize, and the artifact
 * that ships is not necessarily the one the build produced. This tool reads the
 * committed binaries and counts `v128` instructions in their disassembly, so a
 * SIMD claim can be checked against the bytes a browser will load.
 *
 * Exit codes:
 *   0  every checked claim holds
 *   1  a claim is violated (e.g. SIMD artifact has no vector instructions)
 *   2  nothing was fully verified: the disassembler is unavailable, an
 *      artifact is missing, or no artifact exists. A missing artifact is not a
 *      pass — run `just wasm-build-all` (or point VARVE_WASM_DIR at a complete
 *      build) and re-run.
 *
 * This is deliberately not wired into the default test gate: it needs
 * `llvm-objdump` from `llvm-tools`. Run it before publishing a SIMD claim.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const wasmDir = process.env.VARVE_WASM_DIR
  ? resolve(process.env.VARVE_WASM_DIR)
  : resolve(root, 'apps/desktop/public/wasm');

/** artifact file -> whether it is claimed to contain SIMD. */
const CLAIMS = [
  { file: 'varve_wasm_bg.wasm', simd: false },
  { file: 'varve_wasm_simd_bg.wasm', simd: true },
  // The colour engine ships baseline-only. If this changes, add a SIMD claim
  // and a build target together; do not relabel this artifact.
  { file: 'varve_colour_bg.wasm', simd: false },
];

const SIMD_INSTRUCTION = /\b(?:v128|i8x16|i16x8|i32x4|i64x2|f32x4|f64x2)\.[a-z0-9_]+/g;

function disassemble(file) {
  const path = resolve(wasmDir, file);
  if (!existsSync(path)) return null;
  const text = execFileSync('llvm-objdump', ['-d', path], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const counts = new Map();
  for (const match of text.matchAll(SIMD_INSTRUCTION)) {
    counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  }
  return counts;
}

function probeDisassembler() {
  try {
    execFileSync('llvm-objdump', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main() {
  if (!probeDisassembler()) {
    console.error(
      'UNVERIFIED: llvm-objdump is not on PATH (install llvm-tools); no artifact was inspected.',
    );
    process.exit(2);
  }

  const json = process.argv.includes('--json');
  const results = [];
  let failures = 0;
  let inspected = 0;
  let missing = 0;

  for (const claim of CLAIMS) {
    const counts = disassemble(claim.file);
    if (!counts) {
      missing += 1;
      results.push({ file: claim.file, status: 'missing' });
      continue;
    }
    inspected += 1;
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const holds = claim.simd ? total > 0 : total === 0;
    if (!holds) failures += 1;
    results.push({
      file: claim.file,
      claimedSimd: claim.simd,
      vectorInstructions: total,
      top: Object.fromEntries(top),
      status: holds ? 'verified' : 'violated',
    });
  }

  if (json) {
    console.log(JSON.stringify({ inspected, missing, failures, results }, null, 2));
  } else {
    for (const result of results) {
      if (result.status === 'missing') {
        console.log(`${result.file}: MISSING (not inspected)`);
      } else {
        console.log(
          `${result.file}: ${result.vectorInstructions} vector instructions -> ${result.status}` +
            (result.claimedSimd ? '' : ' (baseline claim: must be 0)'),
        );
      }
    }
  }

  if (failures > 0) {
    console.error(
      `FAILED: ${failures} SIMD claim(s) do not match the shipped bytes. Do not publish an acceleration claim.`,
    );
    process.exit(1);
  }
  if (inspected === 0 || missing > 0) {
    console.error(
      inspected === 0
        ? 'UNVERIFIED: none of the claimed artifacts exist; build them first.'
        : `UNVERIFIED: ${missing} claimed artifact(s) are missing, so those claims were not checked.`,
    );
    process.exit(2);
  }
  console.log(`OK: ${inspected} artifact(s) inspected; SIMD claims match the bytes.`);
}

main();
