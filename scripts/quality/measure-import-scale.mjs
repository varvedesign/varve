#!/usr/bin/env node
/**
 * Bounded import-scale measurement.
 *
 * Three open reports describe scale, not correctness: a large design system
 * loading slowly (#255), a large Figma paste being expensive (#500), and a
 * `.fig` with large canvas bounds exhausting memory (#580). None can be closed
 * by reading code, and none should be closed by guessing. This harness produces
 * a number on demand with a bounded, generated fixture so the claim can be
 * checked on any machine.
 *
 * It measures the *shared import pipeline* with SVG, which is the path those
 * reports exercise and the only one with a deterministic text fixture. It does
 * not model `.fig` decoding, which is a separate parser and a separate cost.
 *
 * Usage:
 *   node scripts/quality/measure-import-scale.mjs [--elements 2000] [--repeat 3]
 *
 * Budget it listens to: the repository targets modest hardware (4 GB). The
 * default fixture is deliberately small enough to run anywhere; raise
 * `--elements` on the hardware you actually care about and record the result in
 * the audit ledger rather than in prose.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function parseArgs(argv) {
  const args = { elements: 2000, repeat: 3 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    const value = Number(argv[i + 1]);
    if (!key || !Number.isFinite(value)) continue;
    args[key] = value;
  }
  return args;
}

const { elements, repeat } = parseArgs(process.argv.slice(2));

/** A square grid of simple shapes — the shape of a large design-system page. */
function buildSvg(count) {
  const side = Math.ceil(Math.sqrt(count));
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side * 40}" height="${side * 40}" viewBox="0 0 ${side * 40} ${side * 40}">`,
  ];
  for (let i = 0; i < count; i++) {
    const x = (i % side) * 40;
    const y = Math.floor(i / side) * 40;
    // Alternate kinds so the importer exercises more than one branch.
    if (i % 3 === 0) {
      parts.push(`<rect x="${x + 4}" y="${y + 4}" width="32" height="32" rx="4" fill="#3a7"/>`);
    } else if (i % 3 === 1) {
      parts.push(`<circle cx="${x + 20}" cy="${y + 20}" r="14" fill="#37a"/>`);
    } else {
      parts.push(
        `<path d="M${x + 8} ${y + 32} L${x + 20} ${y + 8} L${x + 32} ${y + 32} Z" fill="#a37"/>`,
      );
    }
  }
  parts.push('</svg>');
  return parts.join('\n');
}

function megabytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const workdir = mkdtempSync(join(tmpdir(), 'varve-import-scale-'));
const fixturePath = join(workdir, `fixture-${elements}.svg`);
const svg = buildSvg(elements);
writeFileSync(fixturePath, svg);
console.log(`fixture: ${elements} elements, ${megabytes(Buffer.byteLength(svg))}`);

// The importer is TypeScript; run it through the workspace's own toolchain so
// the measurement uses shipping code rather than a copy.
const modulePath = resolve(import.meta.dirname, '..', '..', 'packages', 'import', 'src', 'svg.ts');
const { parseSvg } = await import(modulePath);

const timings = [];
let result;
for (let i = 0; i < repeat; i++) {
  globalThis.gc?.();
  const started = process.hrtime.bigint();
  result = parseSvg(svg);
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  timings.push(elapsed);
  console.log(`  run ${i + 1}: ${elapsed.toFixed(1)} ms`);
}

timings.sort((a, b) => a - b);
const median = timings[Math.floor(timings.length / 2)];
const heap = process.memoryUsage().heapUsed;
const nodes = result?.document ? Object.keys(result.document.nodes).length : null;
const warnings = result?.warnings?.length ?? 0;

console.log(`median: ${median.toFixed(1)} ms for ${elements} elements`);
console.log(`imported nodes: ${nodes ?? 'unknown'}`);
console.log(`warnings: ${warnings}`);
console.log(`heap after: ${megabytes(heap)}`);
console.log(
  `throughput: ${(elements / (median / 1000)).toFixed(0)} elements/s, ${(median / elements).toFixed(
    3,
  )} ms/element`,
);

rmSync(workdir, { recursive: true, force: true });
