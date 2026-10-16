/**
 * Unicode line break classes (UAX #14) for the pinned UCD release.
 *
 * This module is the read side of `scripts/generate-line-break-data.mjs`: it
 * turns the generated range tables into per-code-point lookups and applies the
 * class resolution the algorithm requires before any rule is evaluated.
 *
 * `isProhibitedBreak` in `lineBreakProhibition.ts` is the predicate the layout
 * engine consumes; this file only answers "what class is this".
 */
import {
  EAST_ASIAN_WIDE_RANGES,
  FINAL_QUOTE_CODE_POINTS,
  INITIAL_QUOTE_CODE_POINTS,
  LINE_BREAK_CLASS_NAMES,
  LINE_BREAK_ORACLE,
  LINE_BREAK_RANGES,
  LINE_BREAK_UCD_VERSION,
  type LineBreakClass,
  UNASSIGNED_PICTOGRAPHIC_RANGES,
} from './lineBreakClassesData';

export type { LineBreakClass };
export {
  EAST_ASIAN_WIDE_RANGES,
  FINAL_QUOTE_CODE_POINTS,
  INITIAL_QUOTE_CODE_POINTS,
  LINE_BREAK_CLASS_NAMES,
  LINE_BREAK_ORACLE,
  LINE_BREAK_RANGES,
  LINE_BREAK_UCD_VERSION,
  UNASSIGNED_PICTOGRAPHIC_RANGES,
};

/** Binary search over a sorted `[first, last, value]` range table. */
function searchRanges(
  ranges: readonly (readonly [number, number, number])[],
  codePoint: number,
): number | null {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = ranges[mid]!;
    if (codePoint < row[0]) hi = mid - 1;
    else if (codePoint > row[1]) lo = mid + 1;
    else return row[2];
  }
  return null;
}

/**
 * Raw `Line_Break` property value, before any UAX #14 resolution.
 * The table covers the whole code space, so this never falls through.
 */
export function rawLineBreakClassOf(codePoint: number): LineBreakClass {
  const index = searchRanges(LINE_BREAK_RANGES, codePoint);
  if (index === null) {
    throw new Error(`Line break table has no entry for U+${codePoint.toString(16)}`);
  }
  return LINE_BREAK_CLASS_NAMES[index]!;
}

/**
 * UAX #14 LB1: resolve the classes the algorithm cannot use directly.
 *
 * - `AI`, `SG`, `XX` → `AL`. Ambiguous-width characters are resolved as
 *   alphabetic rather than ideographic: UAX #14 notes this "achieves a
 *   canonically equivalent resolution … and is compatible with emerging
 *   modern practice", and it is the tailoring the pinned oracle assumes.
 * - `CJ` → `NS`. Conditional Japanese starters (small kana, the prolonged
 *   sound mark) are non-starters under normal breaking, which is what makes
 *   them line-start prohibited — the JLREQ 行頭禁則 behaviour.
 * - `SA` → `AL`. Complex-context scripts stay unstyled here: Thai and friends
 *   get their break opportunities from the layout engine's dictionary
 *   segmentation, not from this table.
 */
export function lineBreakClassOf(codePoint: number): LineBreakClass {
  const raw = rawLineBreakClassOf(codePoint);
  switch (raw) {
    case 'AI':
    case 'SG':
    case 'XX':
    case 'SA':
      return 'AL';
    case 'CJ':
      return 'NS';
    default:
      return raw;
  }
}

/** East_Asian_Width in {F, W, H} — UAX #14's `$EastAsian` set. */
export function isEastAsianWide(codePoint: number): boolean {
  let lo = 0;
  let hi = EAST_ASIAN_WIDE_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = EAST_ASIAN_WIDE_RANGES[mid]!;
    if (codePoint < row[0]) hi = mid - 1;
    else if (codePoint > row[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/**
 * `[\p{Extended_Pictographic} & \p{Cn}]` — the unassigned pictographic code
 * points LB30b pairs with a following emoji modifier.
 */
export function isUnassignedPictographic(codePoint: number): boolean {
  let lo = 0;
  let hi = UNASSIGNED_PICTOGRAPHIC_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = UNASSIGNED_PICTOGRAPHIC_RANGES[mid]!;
    if (codePoint < row[0]) hi = mid - 1;
    else if (codePoint > row[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** U+25CC DOTTED CIRCLE, which UAX #14's `[◌]` denotes literally. */
export const DOTTED_CIRCLE = 0x25cc;

/** U+2010 HYPHEN, which LB20a names as a literal alongside class HY. */
export const HYPHEN = 0x2010;

/**
 * Classes that a combining mark or zero-width joiner may inherit from its
 * base under LB9; anything else is not a base.
 */
const LB9_NON_BASE: ReadonlySet<LineBreakClass> = new Set<LineBreakClass>([
  'BK',
  'CR',
  'LF',
  'NL',
  'SP',
  'ZW',
]);

export interface ResolvedLineBreakClasses {
  /**
   * Effective classes, one per code point. LB9 substitutions are applied so
   * callers can read a class directly, but positions flagged in `inherited`
   * must be skipped when looking for a base — LB9 ignores these characters in
   * every later rule.
   */
  classes: LineBreakClass[];
  /**
   * LB1-resolved class without LB9 substitution, so rules that run *before*
   * LB9 (LB8a's zero-width joiner) can still see the original character.
   */
  rawClasses: LineBreakClass[];
  /**
   * True where LB9 made this code point inherit its base's class. A line break
   * immediately before such a code point is prohibited, and later rules treat
   * the position as absent.
   */
  inherited: boolean[];
  /**
   * True where the code point belongs to UAX #14's `SA` class (Thai, Lao,
   * Khmer, Myanmar and relatives). LB1 resolves `SA` to `AL` for
   * implementations without dictionary analysis; this pipeline *does* segment
   * those scripts, so its word boundaries are real break opportunities and the
   * word-gluing rules must not re-join them. See the tailoring note in
   * `lineBreakProhibition.ts`.
   */
  dictionarySegmented: boolean[];
}

/**
 * Resolve a paragraph's code points to effective line break classes, applying
 * LB1 then LB9 in one pass.
 *
 * LB9 treats `X (CM | ZWJ)*` as if it were `X`, so a combining mark never
 * introduces a break opportunity relative to the character it modifies. LB10
 * catches marks with no base (paragraph-initial, or after a mandatory break,
 * space, or zero-width space) and treats them as `AL`.
 */
export function resolveLineBreakClasses(text: string): ResolvedLineBreakClasses {
  const classes: LineBreakClass[] = [];
  const rawClasses: LineBreakClass[] = [];
  const inherited: boolean[] = [];
  const dictionarySegmented: boolean[] = [];
  let base: LineBreakClass = 'AL';
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    const raw = rawLineBreakClassOf(codePoint);
    const resolved = lineBreakClassOf(codePoint);
    rawClasses.push(resolved);
    dictionarySegmented.push(raw === 'SA');
    if (resolved === 'CM' || resolved === 'ZWJ') {
      if (LB9_NON_BASE.has(base)) {
        // LB10 — a mark with no base (paragraph-initial, or after a mandatory
        // break, space, or zero-width space) is an ordinary `AL` character and
        // stays significant for later rules.
        classes.push('AL');
        inherited.push(false);
        base = 'AL';
      } else {
        // LB9 — the mark joins the base and later rules ignore it.
        classes.push(base);
        inherited.push(true);
      }
      continue;
    }
    classes.push(resolved);
    inherited.push(false);
    base = resolved;
  }
  return { classes, rawClasses, inherited, dictionarySegmented };
}
