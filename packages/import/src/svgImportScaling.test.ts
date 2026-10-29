/**
 * SVG import must stay linear in the number of elements.
 *
 * It was quadratic: `convertElement` copied the whole node map to apply
 * visibility once per converted element, and `addNode` copied it again on
 * append, so cost grew with the square of the document size. Measured on an
 * 8-core host: 500 elements 290 ms, 2 000 4.8 s, 4 000 14.6 s. After the fix the
 * same fixtures take 39 ms / 86 ms / 262 ms — linear, and roughly 55x faster at
 * the sizes that used to hurt.
 *
 * A wall-clock assertion in a shared repository is a flake risk, so only
 * absolute ceilings are asserted, with roughly an order of magnitude of
 * headroom over observed times. That is enough: quadratic at 8 000 elements
 * took ~58 s, so the ceiling separates the two regimes by a wide margin without
 * depending on the ratio between two noisy millisecond measurements.
 */
import { describe, expect, it } from 'vitest';
import { parseSvg } from './svg';

/** A grid of plain rects — the shape of a large pasted or imported file. */
function svgWith(elements: number): string {
  const side = Math.ceil(Math.sqrt(elements));
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side * 40}" height="${side * 40}">`,
  ];
  for (let i = 0; i < elements; i++) {
    const x = (i % side) * 40;
    const y = Math.floor(i / side) * 40;
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

/** Median of three runs: one slow pass under GC or another agent's load is not a regression. */
function medianImportMs(elements: number): number {
  const svg = svgWith(elements);
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const started = performance.now();
    const result = parseSvg(svg);
    runs.push(performance.now() - started);
    // Sanity: the fixture really produced one node per element.
    expect(Object.keys(result.document.nodes).length).toBe(elements + 1);
  }
  runs.sort((a, b) => a - b);
  return runs[1]!;
}

describe('SVG import scaling', () => {
  it('imports a large flat file within a linear budget', () => {
    const ms = medianImportMs(4000);
    // Quadratic took ~15 s here; linear takes ~0.26 s. The ceiling is far above
    // both the fixed cost and normal machine variance, and far below the
    // regression it exists to catch.
    expect(ms, `4000 elements took ${ms.toFixed(0)} ms`).toBeLessThan(4000);
  });

  it('imports 8 000 elements within the same linear budget', () => {
    const ms = medianImportMs(8000);
    // Quadratic took ~58 s here; linear takes well under a second.
    expect(ms, `8000 elements took ${ms.toFixed(0)} ms`).toBeLessThan(6000);
  });
});
