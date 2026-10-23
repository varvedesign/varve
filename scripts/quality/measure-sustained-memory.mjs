#!/usr/bin/env node
/**
 * Sustained-operation memory sampling.
 *
 * OpenPencil #587 reports memory growing over a long session. A single before/
 * after heap reading cannot separate a leak from cache warm-up, and a point
 * sample is not evidence — so this runs many import cycles and samples the heap
 * throughout, then reports the slope after warm-up.
 *
 * Run with `--expose-gc` for meaningful numbers; without it, V8's lazy collection
 * makes the trend unreadable and the script says so rather than printing a
 * misleading curve.
 *
 * Usage:
 *   node --expose-gc scripts/quality/measure-sustained-memory.mjs \
 *     [--cycles 200] [--elements 400] [--every 20]
 *
 * A flat post-warm-up slope with a bounded peak is the healthy shape. Growth that
 * persists across cycles after a forced collection is the leak signature.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function parseArgs(argv) {
  const args = { cycles: 200, elements: 400, every: 20 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    const value = Number(argv[i + 1]);
    if (!key || !Number.isFinite(value)) continue;
    args[key] = value;
  }
  return args;
}

const { cycles, elements, every } = parseArgs(process.argv.slice(2));
const canGc = typeof globalThis.gc === 'function';
if (!canGc) {
  console.warn(
    'warning: run with --expose-gc. Without a forced collection the samples mix live data with uncollected garbage and the slope is not interpretable.',
  );
}

function buildSvg(count) {
  const side = Math.ceil(Math.sqrt(count));
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side * 40}" height="${side * 40}">`,
  ];
  for (let i = 0; i < count; i++) {
    const x = (i % side) * 40;
    const y = Math.floor(i / side) * 40;
    parts.push(`<rect x="${x + 4}" y="${y + 4}" width="32" height="32" fill="#3a7"/>`);
  }
  parts.push('</svg>');
  return parts.join('\n');
}

const workdir = mkdtempSync(join(tmpdir(), 'varve-memory-'));
const fixturePath = join(workdir, 'fixture.svg');
const svg = buildSvg(elements);
writeFileSync(fixturePath, svg);

const modulePath = resolve(import.meta.dirname, '..', '..', 'packages', 'import', 'src', 'svg.ts');
const { parseSvg } = await import(modulePath);

const mb = (bytes) => Number((bytes / (1024 * 1024)).toFixed(1));
const samples = [];

for (let cycle = 1; cycle <= cycles; cycle++) {
  // Parse, then drop the result: an import that retains its document would show
  // up as growth rather than as a steady state.
  parseSvg(svg);
  if (cycle % every === 0) {
    globalThis.gc?.();
    const { heapUsed, external, arrayBuffers } = process.memoryUsage();
    samples.push({ cycle, heap: mb(heapUsed), external: mb(external), buffers: mb(arrayBuffers) });
  }
}

console.log(`cycles: ${cycles} x ${elements} elements (${mb(Buffer.byteLength(svg))} MB fixture)`);
for (const s of samples) {
  console.log(
    `  cycle ${String(s.cycle).padStart(4)}  heap ${String(s.heap).padStart(7)} MB  external ${String(s.external).padStart(6)} MB  buffers ${String(s.buffers).padStart(6)} MB`,
  );
}

if (samples.length >= 3) {
  // Slope over the second half only: the first cycles warm caches and module
  // state, which is expected growth rather than a leak.
  const half = samples.slice(Math.floor(samples.length / 2));
  const first = half[0];
  const last = half[half.length - 1];
  const deltaCycles = last.cycle - first.cycle;
  const perHundred = ((last.heap - first.heap) / deltaCycles) * 100;
  console.log(
    `post-warm-up heap trend: ${(last.heap - first.heap).toFixed(1)} MB over ${deltaCycles} cycles (${perHundred.toFixed(2)} MB per 100 cycles)`,
  );
  const verdict =
    Math.abs(perHundred) < 2
      ? 'flat — no leak signature at this scale'
      : perHundred > 0
        ? 'growing — investigate retention'
        : 'shrinking — caches are being dropped, nothing to chase';
  console.log(`verdict: ${verdict}`);
}

rmSync(workdir, { recursive: true, force: true });
