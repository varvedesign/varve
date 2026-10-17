/**
 * PDF page-tree discovery for import.
 *
 * Page order and inheritance come from the catalog's `/Pages` tree: `/Kids`
 * order is the document's order, and `/MediaBox`, `/CropBox`, `/Rotate` and
 * `/Resources` are inherited from ancestors when a page omits them. Reading
 * order from object numbers instead would silently reorder the pages of any
 * document whose page objects are not numbered in reading order.
 *
 * When the tree cannot be walked at all — a damaged catalog, an encrypted
 * body — the importer falls back to scanning for `/Type /Page` objects and
 * says so, rather than reporting an empty document.
 */

import type { ExtGState } from './content';
import { buildFont, type PdfFont } from './encoding';
import {
  type DecodeReport,
  dictArrayBody,
  type PdfIndex,
  type PdfObject,
  parseNumberList,
  parseNumberListOrRef,
  resolveRef,
} from './objects';

/** Most pages imported from one file; the remainder is reported, not dropped. */
export const MAX_IMPORTED_PAGES = 50;
/** Deepest `/Pages` nesting the walker will follow. */
const MAX_TREE_DEPTH = 32;

export interface PdfPageBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface PdfPage {
  readonly objectNumber: number;
  /** Visible box used for page geometry (crop box when present). */
  readonly box: PdfPageBox;
  readonly mediaBox: PdfPageBox | null;
  readonly cropBoxApplied: boolean;
  readonly rotate: number;
  readonly contents: PdfObject[];
  readonly fonts: Map<string, PdfFont>;
  readonly extGStates: Map<string, ExtGState>;
}

export interface PageCollection {
  readonly pages: PdfPage[];
  /** Pages the document declares, before the import budget is applied. */
  readonly detected: number;
  /** False when order was inferred from object numbers instead of `/Kids`. */
  readonly orderedByTree: boolean;
  /** True when some page bodies existed but could not be decoded. */
  readonly undecodableContents: number;
}

interface Inherited {
  mediaBox: PdfPageBox | null;
  cropBox: PdfPageBox | null;
  rotate: number;
  /** `/Resources` dictionary body, from a reference or an inline dictionary. */
  resourcesHeader: string | null;
}

const NO_INHERITANCE: Inherited = {
  mediaBox: null,
  cropBox: null,
  rotate: 0,
  resourcesHeader: null,
};

/** Walk the page tree, falling back to a scan when the tree is unreachable. */
export function collectPages(index: PdfIndex, report: DecodeReport): PageCollection {
  const walked = walkTree(index, report);
  if (walked.pages.length > 0) return walked;
  return scanForPages(index, report);
}

function walkTree(index: PdfIndex, report: DecodeReport): PageCollection {
  const catalog = findObject(index, /\/Type\s*\/Catalog/);
  const pagesRef = catalog ? resolveRef(index, refAfter(catalog.header, 'Pages')) : null;
  if (!pagesRef) return { pages: [], detected: 0, orderedByTree: false, undecodableContents: 0 };

  const pages: PdfPage[] = [];
  let detected = 0;
  let undecodableContents = 0;
  const visited = new Set<number>();

  const walk = (node: PdfObject, inherited: Inherited, depth: number): void => {
    if (depth > MAX_TREE_DEPTH || visited.has(node.number)) return;
    visited.add(node.number);
    const merged = mergeInheritance(index, node, inherited);

    if (isPageNode(node)) {
      detected += 1;
      if (pages.length >= MAX_IMPORTED_PAGES) return;
      const page = materialize(index, node, merged, report);
      undecodableContents += page.contents.length === 0 && hasContentsKey(node) ? 1 : 0;
      pages.push(page);
      return;
    }
    const kids = dictArrayBody(node.header, 'Kids');
    if (kids === null) return;
    for (const ref of [...kids.matchAll(/(\d+)\s+\d+\s+R/g)]) {
      const child = index.objects.get(Number(ref[1]));
      if (child) walk(child, merged, depth + 1);
    }
  };

  walk(pagesRef, NO_INHERITANCE, 0);
  if (pages.length === 0)
    return { pages: [], detected: 0, orderedByTree: false, undecodableContents: 0 };
  return { pages, detected, orderedByTree: true, undecodableContents };
}

/**
 * Fallback for documents whose catalog cannot be followed: every object that
 * declares `/Type /Page`, in object-number order. Order is then inferred, so
 * the collection reports `orderedByTree: false`.
 */
function scanForPages(index: PdfIndex, report: DecodeReport): PageCollection {
  const candidates = [...index.objects.values()]
    .filter((object) => isPageNode(object))
    .sort((a, b) => a.number - b.number);
  const pages: PdfPage[] = [];
  let undecodableContents = 0;
  for (const object of candidates) {
    if (pages.length >= MAX_IMPORTED_PAGES) break;
    const merged = mergeInheritance(index, object, NO_INHERITANCE);
    const page = materialize(index, object, merged, report);
    undecodableContents += page.contents.length === 0 && hasContentsKey(object) ? 1 : 0;
    pages.push(page);
  }
  return {
    pages,
    detected: candidates.length,
    orderedByTree: false,
    undecodableContents,
  };
}

function hasContentsKey(object: PdfObject): boolean {
  return /\/Contents\b/.test(object.header);
}

function isPageNode(object: PdfObject): boolean {
  return /\/Type\s*\/Page(?![sA-Za-z])/.test(object.header);
}

function mergeInheritance(index: PdfIndex, node: PdfObject, inherited: Inherited): Inherited {
  const ownMediaBox = readBox(index, node.header, 'MediaBox');
  const ownCropBox = readBox(index, node.header, 'CropBox');
  const ownRotate = numberAfter(node.header, 'Rotate');
  const referenced = resolveRef(index, refAfter(node.header, 'Resources'));
  const ownResources =
    referenced?.header ?? inlineDictBody(node.header, 'Resources') ?? inherited.resourcesHeader;
  return {
    mediaBox: ownMediaBox ?? inherited.mediaBox,
    cropBox: ownCropBox ?? inherited.cropBox,
    rotate: ownRotate ?? inherited.rotate,
    resourcesHeader: ownResources,
  };
}

/** Body of an inline `/Key << ... >>` dictionary, without the angle brackets. */
function inlineDictBody(header: string, key: string): string | null {
  const at = new RegExp(`/${key}(?![A-Za-z0-9])\\s*<<`).exec(header);
  if (!at) return null;
  const open = at.index + at[0].length - 2;
  let depth = 0;
  for (let i = open; i < header.length; i += 1) {
    if (header.startsWith('<<', i)) {
      depth += 1;
      i += 1;
      continue;
    }
    if (header.startsWith('>>', i)) {
      depth -= 1;
      if (depth === 0) return header.slice(open + 2, i);
      i += 1;
    }
  }
  return null;
}

function materialize(
  index: PdfIndex,
  node: PdfObject,
  inherited: Inherited,
  report: DecodeReport,
): PdfPage {
  const mediaBox = inherited.mediaBox;
  const cropBox = inherited.cropBox;
  const box = cropBox ?? mediaBox ?? { x0: 0, y0: 0, x1: 612, y1: 792 };
  return {
    objectNumber: node.number,
    box,
    mediaBox,
    cropBoxApplied: cropBox !== null && mediaBox !== null && !sameBox(cropBox, mediaBox),
    rotate: inherited.rotate,
    contents: readContents(index, node, report),
    fonts: readFonts(index, inherited.resourcesHeader, report),
    extGStates: readExtGStates(index, inherited.resourcesHeader),
  };
}

function sameBox(a: PdfPageBox, b: PdfPageBox): boolean {
  return a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
}

function readContents(index: PdfIndex, node: PdfObject, report: DecodeReport): PdfObject[] {
  const direct = refAfter(node.header, 'Contents');
  const fromRef = resolveRef(index, direct);
  if (fromRef) return [fromRef];
  const arrayBody = dictArrayBody(node.header, 'Contents');
  if (arrayBody === null) return [];
  const out: PdfObject[] = [];
  for (const ref of [...arrayBody.matchAll(/(\d+)\s+\d+\s+R/g)]) {
    const object = index.objects.get(Number(ref[1]));
    if (object) out.push(object);
  }
  void report;
  return out;
}

/** `/Resources << /Font << /F1 7 0 R >> >>`, possibly inherited. */
function readFonts(
  index: PdfIndex,
  resourcesHeader: string | null,
  report: DecodeReport,
): Map<string, PdfFont> {
  const fonts = new Map<string, PdfFont>();
  if (!resourcesHeader) return fonts;
  const fontDict = inlineDictBody(resourcesHeader, 'Font');
  if (fontDict === null) return fonts;
  for (const entry of fontDict.matchAll(/\/([A-Za-z0-9#._-]+)\s+(\d+)\s+\d+\s+R/g)) {
    const name = entry[1]!;
    const object = index.objects.get(Number(entry[2]));
    fonts.set(name, buildFont(index, name, object ?? null, report));
  }
  return fonts;
}

/**
 * `/Resources << /ExtGState << /GS1 9 0 R >> >>`. A state whose `/ca` cannot be
 * read is recorded with `alpha: null`, which tells the interpreter not to
 * paint its fills as if they were opaque.
 */
function readExtGStates(index: PdfIndex, resourcesHeader: string | null): Map<string, ExtGState> {
  const states = new Map<string, ExtGState>();
  if (!resourcesHeader) return states;
  const dict = inlineDictBody(resourcesHeader, 'ExtGState');
  if (dict === null) return states;
  for (const entry of dict.matchAll(/\/([A-Za-z0-9#._-]+)\s+(\d+)\s+\d+\s+R/g)) {
    const object = index.objects.get(Number(entry[2]));
    states.set(entry[1]!, { alpha: readAlpha(object?.header) });
  }
  return states;
}

function readAlpha(header: string | undefined): number | null {
  if (header === undefined) return null;
  const match = /\/ca(?![A-Za-z0-9])\s+(-?\d*\.?\d+)/.exec(header);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

function readBox(index: PdfIndex, header: string, key: string): PdfPageBox | null {
  const body = dictArrayBody(header, key);
  if (body === null) {
    const ref = refAfter(header, key);
    if (!ref) return null;
    const referenced = resolveRef(index, ref);
    if (!referenced) return null;
    return boxFromNumbers(parseNumberList(referenced.header));
  }
  return boxFromNumbers(parseNumberListOrRef(index, body));
}

function boxFromNumbers(values: number[]): PdfPageBox | null {
  if (values.length < 4) return null;
  const [x0, y0, x1, y1] = values as [number, number, number, number];
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  return {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1),
  };
}

function findObject(index: PdfIndex, pattern: RegExp): PdfObject | null {
  for (const object of index.objects.values()) {
    if (pattern.test(object.header)) return object;
  }
  return null;
}

function refAfter(header: string, key: string): string | undefined {
  const match = new RegExp(`/${key}(?![A-Za-z0-9])\\s+(\\d+\\s+\\d+\\s+R)`).exec(header);
  return match?.[1];
}

function numberAfter(header: string, key: string): number | null {
  const match = new RegExp(`/${key}(?![A-Za-z0-9])\\s+(-?\\d*?\\.?\\d+)`).exec(header);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}
