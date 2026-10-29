/**
 * Glyph coverage at export time.
 *
 * Canvas2D draws a character the authored family lacks by falling back to
 * another installed face, so the editor shows text. The PDF writer does not
 * have that luxury: it outlines the *authored* face, and a code point that
 * face does not map becomes `.notdef` — a blank or a box in the exported
 * file. The two surfaces therefore disagree, silently, and the disagreement
 * is only visible after the file has been sent somewhere.
 *
 * This module reads the coverage of the exact font binaries the PDF exporter
 * is about to embed and names the characters that will not be drawn. It is a
 * report, not a repair: the exporter still writes the same file, and the user
 * decides whether to change the font, substitute a face that covers the text,
 * or accept the difference.
 *
 * A font whose coverage cannot be parsed makes no claim: an empty range list
 * means "unknown", never "supports nothing".
 */
import type { FontDataRecord } from '@varve/engine';
import { parseFontData } from '@varve/engine';

/**
 * Structural view of a text node. The editor holds scene nodes and the export
 * path holds engine nodes; both carry the same authored text, so the check
 * accepts either rather than forcing a conversion at the call site.
 */
export interface CoverageTextNode {
  readonly id: string;
  readonly kind?: string;
  readonly fontFamily?: string;
  readonly text?: unknown;
  readonly richText?: {
    readonly paragraphs: ReadonlyArray<{
      readonly runs: ReadonlyArray<{
        readonly text?: string;
        readonly format?: { readonly fontFamily?: string };
      }>;
    }>;
  };
}

export interface GlyphCoverageGap {
  readonly family: string;
  /** Distinct characters the face cannot draw, sorted, capped for display. */
  readonly characters: readonly string[];
  /** Total distinct characters missing, before the display cap. */
  readonly missingCount: number;
  /** Text nodes containing at least one missing character. */
  readonly nodeCount: number;
}

/** Characters checked per export; a hostile document must not stall it. */
const MAX_CHARACTERS_CHECKED = 400_000;
/** Missing characters reported per family. */
const MAX_REPORTED_CHARACTERS = 12;

/**
 * Compare every text node against the coverage of the font binary the export
 * will embed for its family. Families without a record are skipped: the
 * exporter has no face to outline with, which is a different failure.
 */
export async function detectExportGlyphGaps(
  nodes: readonly CoverageTextNode[],
  records: readonly FontDataRecord[],
): Promise<GlyphCoverageGap[]> {
  if (records.length === 0 || nodes.length === 0) return [];
  const coverage = await coverageByFamily(records);
  if (coverage.size === 0) return [];

  const gaps = new Map<string, { missing: Set<string>; nodes: Set<string> }>();
  let checked = 0;

  for (const node of nodes) {
    if (node.kind !== 'text') continue;
    for (const run of textRunsOf(node)) {
      const ranges = coverage.get(normalizeFamily(run.family));
      if (!ranges) continue;
      for (const character of run.text) {
        if (checked >= MAX_CHARACTERS_CHECKED) break;
        checked += 1;
        if (isIgnorable(character)) continue;
        const codePoint = character.codePointAt(0);
        if (codePoint === undefined) continue;
        if (ranges.some(([start, end]) => codePoint >= start && codePoint <= end)) continue;
        const entry = gaps.get(run.family) ?? { missing: new Set(), nodes: new Set() };
        entry.missing.add(character);
        entry.nodes.add(node.id);
        gaps.set(run.family, entry);
      }
    }
  }

  return [...gaps.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, entry]) => {
      const characters = [...entry.missing].sort();
      return {
        family,
        characters: characters.slice(0, MAX_REPORTED_CHARACTERS),
        missingCount: characters.length,
        nodeCount: entry.nodes.size,
      };
    });
}

/** One warning per family, phrased for the person deciding what to do. */
export function glyphGapWarnings(gaps: readonly GlyphCoverageGap[]): string[] {
  return gaps.map((gap) => {
    const sample = gap.characters.join(' ');
    const more = gap.missingCount > gap.characters.length ? ' …' : '';
    const objects = gap.nodeCount === 1 ? '1 text object' : `${gap.nodeCount} text objects`;
    return (
      `Font "${gap.family}" has no glyph for ${gap.missingCount} character(s) used in ${objects} ` +
      `(${sample}${more}). The editor draws them with a fallback font; the PDF embeds "${gap.family}", ` +
      'so those characters may export as blank boxes. Choose a font that covers them, or convert the text to outlines after checking it.'
    );
  });
}

async function coverageByFamily(
  records: readonly FontDataRecord[],
): Promise<Map<string, Array<[number, number]>>> {
  const out = new Map<string, Array<[number, number]>>();
  for (const record of records) {
    const ranges = await coverageOf(record);
    if (ranges.length === 0) continue;
    out.set(normalizeFamily(record.family), ranges);
  }
  return out;
}

async function coverageOf(record: FontDataRecord): Promise<Array<[number, number]>> {
  try {
    const bytes = record.data;
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const metadata = await parseFontData(buffer);
    return metadata.unicodeRanges.map(([start, end]) => [start, end] as [number, number]);
  } catch {
    // A font the parser cannot read makes no coverage claim. Reporting a gap
    // from a failed parse would invent a defect in the user's document.
    return [];
  }
}

interface TextRunInspection {
  readonly family: string;
  readonly text: string;
}

function textRunsOf(node: CoverageTextNode): TextRunInspection[] {
  const family = node.fontFamily ?? 'sans-serif';
  const richText = node.richText;
  if (!richText) return [{ family, text: textOf(node) }];
  const runs: TextRunInspection[] = [];
  for (const paragraph of richText.paragraphs) {
    for (const run of paragraph.runs) {
      runs.push({
        family: run.format?.fontFamily ?? family,
        text: typeof run.text === 'string' ? run.text : '',
      });
    }
  }
  return runs.length > 0 ? runs : [{ family, text: textOf(node) }];
}

function textOf(node: CoverageTextNode): string {
  return typeof node.text === 'string' ? node.text : '';
}

/** Whitespace and control characters never need a glyph. */
function isIgnorable(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint <= 0x20 || codePoint === 0x7f || (codePoint >= 0x200b && codePoint <= 0x200f);
}

function normalizeFamily(family: string): string {
  return family
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .toLocaleLowerCase();
}
