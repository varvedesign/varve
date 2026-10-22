/**
 * Export glyph-coverage regressions.
 *
 * The canvas falls back per glyph; the PDF writer outlines the authored face.
 * These tests pin the report that makes the difference visible before the file
 * leaves the application, and pin the rule that an unparseable font makes no
 * claim rather than a false one.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FontDataRecord } from '@varve/engine';
import { makeTextNode, type SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { detectExportGlyphGaps, glyphGapWarnings } from './glyphCoverage';

/** A Latin-subset variable face: it has no CJK coverage by construction. */
const GEIST_LATIN = new Uint8Array(
  readFileSync(
    join(
      repositoryRoot(),
      'packages/engine/src/font/__fixtures__/geist/geist-latin-wght-normal.woff2',
    ),
  ),
);

/** jsdom gives `import.meta.url` an http scheme, so find the root on disk. */
function repositoryRoot(): string {
  let directory = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Could not find the repository root from ${process.cwd()}`);
}

function record(family: string, data: Uint8Array = GEIST_LATIN): FontDataRecord {
  return { family, data };
}

function textNode(id: string, text: string, family = 'Geist'): SceneNode {
  return makeTextNode(id, text, { fontFamily: family });
}

describe('export glyph coverage', () => {
  it('names the characters a Latin-only face cannot draw', async () => {
    const gaps = await detectExportGlyphGaps([textNode('t1', 'Hello 世界')], [record('Geist')]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.family).toBe('Geist');
    expect(gaps[0]!.missingCount).toBe(2);
    expect(gaps[0]!.characters).toEqual(['世', '界']);
    expect(gaps[0]!.nodeCount).toBe(1);
  });

  it('reports nothing when the face covers the text', async () => {
    const gaps = await detectExportGlyphGaps([textNode('t1', 'Hello world')], [record('Geist')]);
    expect(gaps).toEqual([]);
  });

  it('counts distinct characters and the objects that use them', async () => {
    const gaps = await detectExportGlyphGaps(
      [textNode('t1', '世界'), textNode('t2', '世界世界')],
      [record('Geist')],
    );
    expect(gaps[0]!.missingCount).toBe(2);
    expect(gaps[0]!.nodeCount).toBe(2);
  });

  it('makes no claim for a font whose coverage cannot be parsed', async () => {
    const gaps = await detectExportGlyphGaps(
      [textNode('t1', '世界')],
      [record('Geist', new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))],
    );
    expect(gaps).toEqual([]);
  });

  it('makes no claim for a family the export has no face for', async () => {
    const gaps = await detectExportGlyphGaps(
      [textNode('t1', '世界', 'Missing Face')],
      [record('Geist')],
    );
    expect(gaps).toEqual([]);
  });

  it('ignores whitespace and control characters', async () => {
    const gaps = await detectExportGlyphGaps(
      [textNode('t1', 'Hello\n\tworld 世界')],
      [record('Geist')],
    );
    expect(gaps[0]!.missingCount).toBe(2);
  });

  it('phrases the warning around the decision the user has to make', async () => {
    const gaps = await detectExportGlyphGaps([textNode('t1', '世界')], [record('Geist')]);
    const [warning] = glyphGapWarnings(gaps);
    expect(warning).toContain('"Geist"');
    expect(warning).toContain('2 character(s)');
    expect(warning).toContain('1 text object');
    expect(warning).toMatch(/fallback font/);
    expect(warning).toMatch(/PDF/);
  });

  it('reads rich-text runs by their own family', async () => {
    const node = {
      ...makeTextNode('t1', 'Hello 世界', { fontFamily: 'Geist' }),
      richText: {
        paragraphs: [
          {
            runs: [
              { text: 'Hello ', format: { fontFamily: 'Geist' } },
              { text: '世界', format: { fontFamily: 'Other Face' } },
            ],
          },
        ],
      },
    } as unknown as SceneNode;
    const gaps = await detectExportGlyphGaps([node], [record('Geist')]);
    expect(gaps).toEqual([]);
  });
});
