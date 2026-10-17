#!/usr/bin/env node
/**
 * Compare the shipped baseline and SIMD WASM engine artifacts on the work they
 * actually export, and prove their outputs are byte-identical.
 *
 * `build_ir_json` and `hit_test_json` are the only canvas-facing exports of the
 * engine module. This harness loads both committed binaries through their own
 * wasm-bindgen glue (the same bytes a browser would fetch), runs them on
 * synthetic scenes of increasing size, and reports per-call latency alongside
 * an equality check on the returned JSON.
 *
 * What this does not prove: browser/WebKitGTK performance, or that any other
 * export benefits. It is a Node/V8 measurement on this machine, and the
 * README/report must say so.
 *
 * Usage: node scripts/quality/bench-wasm-artifacts.mjs [--json] [--reps N]
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
const wasmDir = process.env.VARVE_WASM_DIR
  ? resolve(process.env.VARVE_WASM_DIR)
  : resolve(root, 'apps/desktop/public/wasm');
const json = process.argv.includes('--json');
const repsIndex = process.argv.indexOf('--reps');
const reps = repsIndex > -1 ? Number(process.argv[repsIndex + 1]) : 12;

/** Deterministic synthetic scene in the bridge's wire format. */
function scene(count) {
  const nodes = [];
  for (let i = 0; i < count; i++) {
    nodes.push({
      id: `n${i}`,
      name: `Node ${i}`,
      transform: [1, 0, 0, 1, (i % 64) * 10, Math.floor(i / 64) * 10],
      shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 30 },
      fill: { space: 'rgb', r: 57 + (i % 7), g: 208, b: 198, a: 255 },
      opacity: 1,
      blend_mode: 'normal',
      rotation: 0,
      strokes: [],
      effects: [],
    });
  }
  return JSON.stringify(nodes);
}

async function loadArtifact(name) {
  const gluePath = resolve(wasmDir, `${name}.js`);
  const wasmPath = resolve(wasmDir, `${name}_bg.wasm`);
  const glue = await import(pathToFileURL(gluePath).href);
  const bytes = await readFile(wasmPath);
  await glue.default({ module_or_path: bytes });
  return glue;
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    medianMs: Number(at(0.5).toFixed(3)),
    p95Ms: Number(at(0.95).toFixed(3)),
    minMs: Number(at(0).toFixed(3)),
    maxMs: Number(at(1).toFixed(3)),
  };
}

/**
 * Interleave A and B within one loop and alternate their order each repetition.
 * Sequential blocks would charge one artifact for any drift in machine load,
 * which on a shared development machine is larger than the effect being
 * measured.
 */
function measurePair(fnA, fnB) {
  const a = [];
  const b = [];
  for (let i = 0; i < reps; i++) {
    if (i % 2 === 0) {
      let start = performance.now();
      fnA();
      a.push(performance.now() - start);
      start = performance.now();
      fnB();
      b.push(performance.now() - start);
    } else {
      let start = performance.now();
      fnB();
      b.push(performance.now() - start);
      start = performance.now();
      fnA();
      a.push(performance.now() - start);
    }
  }
  return { a: stats(a), b: stats(b) };
}

async function main() {
  const baseline = await loadArtifact('varve_wasm');
  const simd = await loadArtifact('varve_wasm_simd');

  const versions = {
    baseline: baseline.wasm_engine_version(),
    simd: simd.wasm_engine_version(),
  };
  if (versions.baseline !== versions.simd) {
    throw new Error(
      `artifact version mismatch: baseline ${versions.baseline} vs simd ${versions.simd}. ` +
        'Run `just wasm-build` so both artifacts come from one source tree.',
    );
  }

  const cases = [];
  for (const count of [200, 600, 2000]) {
    const nodes = scene(count);
    // Warm both paths before measuring, so neither pays first-call JIT cost.
    for (let i = 0; i < 3; i++) {
      baseline.build_ir_json(nodes);
      simd.build_ir_json(nodes);
    }
    const baseIr = baseline.build_ir_json(nodes);
    const simdIr = simd.build_ir_json(nodes);
    if (baseIr !== simdIr) {
      throw new Error(`IR mismatch at ${count} nodes: the artifacts do not agree`);
    }
    const baseHit = baseline.hit_test_json(nodes, 120, 120);
    const simdHit = simd.hit_test_json(nodes, 120, 120);
    if (baseHit !== simdHit) {
      throw new Error(`hit-test mismatch at ${count} nodes: baseline ${baseHit}, simd ${simdHit}`);
    }

    const paired = measurePair(
      () => baseline.build_ir_json(nodes),
      () => simd.build_ir_json(nodes),
    );
    cases.push({
      nodes: count,
      irBytes: baseIr.length,
      identical: true,
      hitTest: baseHit,
      baseline: paired.a,
      simd: paired.b,
      speedup: Number((paired.a.medianMs / paired.b.medianMs).toFixed(2)),
    });
  }

  const payload = {
    measuredAt: new Date().toISOString(),
    runtime: `node ${process.version} (V8)`,
    cpu: 'see docs/perf/2026-10-16-wasm-simd-capability.md',
    reps,
    versions,
    cases,
    caveat:
      'Node/V8 on the development machine, not a browser or WebKitGTK certification. ' +
      'The exported path includes JSON parse + serialize, so kernel-level gains are diluted.',
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`node ${process.version} / V8 — wasm engine ${versions.baseline}`);
    console.log('nodes |  ir bytes | baseline p50 | simd p50 | speedup | identical');
    for (const item of cases) {
      console.log(
        `${String(item.nodes).padStart(5)} | ${String(item.irBytes).padStart(9)} | ` +
          `${String(item.baseline.medianMs).padStart(12)} | ${String(item.simd.medianMs).padStart(8)} | ` +
          `${String(item.speedup).padStart(7)}x | ${item.identical}`,
      );
    }
    console.log(
      '\nCaveat: exported work is boundary-heavy (serde JSON parse + serialize); ' +
        'a speedup here is evidence about this path only.',
    );
  }
}

main().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
