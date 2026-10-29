/** Clipboard reads: async Clipboard API items, DOM event snapshots, and representation helpers. */

import { restoreClipboardFontDependencies } from './fonts';
import {
  isVarvePayloadType,
  LEGACY_MIME,
  VARVE_MIME,
  WEB_LEGACY_MIME,
  WEB_VARVE_MIME,
} from './mime';
import { parseClipboardData } from './parse';
import type { ClipboardData, ClipboardImportItem, UnifiedClipboardResult } from './types';

function createClipboardResult(): UnifiedClipboardResult {
  return { varveData: null, importItems: [] };
}
export async function hydrateClipboardFonts(
  result: UnifiedClipboardResult,
  documentId?: string,
): Promise<UnifiedClipboardResult> {
  if (result.varveData?.fontDependencies) {
    await restoreClipboardFontDependencies(result.varveData.fontDependencies, documentId);
  }
  return result;
}
export function isSvgText(text: string): boolean {
  return /^(?:\uFEFF|\s|<!--(?:[\s\S]*?)-->)*(?:<\?xml\b[^>]*>\s*)?(?:<!--(?:[\s\S]*?)-->\s*)*<svg(?:\s|>)/i.test(
    text,
  );
}
export function hasRichClipboardContent(result: UnifiedClipboardResult): boolean {
  return Boolean(result.varveData || result.importItems.length > 0 || result.htmlText);
}
/** Extract one local SVG element from HTML clipboard data without executing or
 * fetching anything. The SVG still goes through the bounded SVG importer. */
function extractSvgFromHtml(html: string): string | null {
  if (!/<svg\b/i.test(html) || typeof DOMParser === 'undefined') return null;
  try {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const svg = document.querySelector('svg');
    if (!svg || typeof XMLSerializer === 'undefined') return null;
    const serialized = new XMLSerializer().serializeToString(svg);
    return isSvgText(serialized) ? serialized : null;
  } catch {
    return null;
  }
}
function addSvgItem(
  result: UnifiedClipboardResult,
  data: string,
  name: string,
  dedupe = true,
): void {
  // A single clipboard item can expose SVG through several equivalent MIME
  // representations (string MIME, HTML, and a file). Those alternatives are
  // one logical item and should be deduplicated. Separate ClipboardItem
  // entries, however, are distinct user content even when their bytes happen
  // to be identical, so the async Clipboard API can opt out of this check.
  if (
    dedupe &&
    result.importItems.some(
      (item) =>
        item.mimeType === 'image/svg+xml' && typeof item.data === 'string' && item.data === data,
    )
  ) {
    return;
  }
  addImageItem(result, data, 'image/svg+xml', name);
}
function addImageItem(
  result: UnifiedClipboardResult,
  data: string | Uint8Array,
  mimeType: string,
  name: string,
): void {
  result.importItems.push({
    data,
    mimeType,
    name: name || `clipboard.${mimeType.split('/')[1] ?? 'bin'}`,
  });
}
async function readClipboardItem(
  item: ClipboardItem,
  result: UnifiedClipboardResult,
  itemIndex: number,
): Promise<void> {
  const varveType = item.types.find(isVarvePayloadType);
  if (varveType) {
    try {
      const parsed = parseClipboardData(await (await item.getType(varveType)).text());
      if (parsed) {
        result.varveData = parsed;
        return;
      }
    } catch {
      // A malformed custom format must not hide a valid fallback item.
    }
  }
  const svgType = item.types.find((type) => type === 'image/svg+xml' || type === 'text/svg+xml');
  if (svgType) {
    try {
      const text = await (await item.getType(svgType)).text();
      if (isSvgText(text)) {
        // ClipboardItem boundaries are logical item boundaries. Do not merge
        // two separately copied, byte-identical SVGs into one pasted layer.
        addSvgItem(result, text, `clipboard-${itemIndex}.svg`, false);
        return;
      }
    } catch {
      // Try the raster representation below.
    }
  }
  const imageType = item.types.find(
    (type) => type.startsWith('image/') && type !== 'image/svg+xml',
  );
  if (imageType) {
    try {
      const bytes = new Uint8Array(await (await item.getType(imageType)).arrayBuffer());
      addImageItem(
        result,
        bytes,
        imageType,
        `clipboard-${itemIndex}.${imageType.split('/')[1] ?? 'bin'}`,
      );
      return;
    } catch {
      // Keep looking for a safe text representation.
    }
  }
  if (item.types.includes('text/plain')) {
    try {
      const text = await (await item.getType('text/plain')).text();
      if (isSvgText(text)) {
        addSvgItem(result, text, `clipboard-${itemIndex}.svg`);
      } else if (text) {
        result.plainText ??= text;
      }
    } catch {
      // Ignore one unreadable representation.
    }
  }
  if (item.types.includes('text/html')) {
    try {
      const html = await (await item.getType('text/html')).text();
      if (html) {
        const bounded = html.slice(0, 4 * 1024 * 1024);
        result.htmlText ??= bounded;
        const svg = extractSvgFromHtml(bounded);
        if (svg) addSvgItem(result, svg, `clipboard-${itemIndex}.svg`);
      }
    } catch {
      // HTML is optional; plain text remains usable.
    }
  }
}
export async function readClipboardUnified(documentId?: string): Promise<UnifiedClipboardResult> {
  const result = createClipboardResult();
  try {
    const items = await navigator.clipboard.read();
    for (let i = 0; i < items.length; i++) await readClipboardItem(items[i]!, result, i);
  } catch {
    // Clipboard read failed or permission denied
  }
  return hydrateClipboardFonts(result, documentId);
}
/**
 * Read clipboard data from a DOM ClipboardEvent directly (async).
 *
 * This is the cross-platform path: `ClipboardEvent.clipboardData` is available
 * on all platforms and browsers (including Wayland) without the permission
 * issues that affect `navigator.clipboard.read()` with image MIME types.
 *
 * Reads image files as Uint8Array and SVG files as text strings, matching
 * the format expected by the import pipeline (importFile → importImageAsFile).
 */
export async function readFromClipboardEvent(
  event: ClipboardEvent,
  documentId?: string,
): Promise<UnifiedClipboardResult> {
  const dt = event.clipboardData;
  if (!dt) return createClipboardResult();
  return hydrateClipboardFonts(await readClipboardSnapshot(snapshotClipboardData(dt)), documentId);
}
export interface ClipboardFileSnapshot {
  file: File;
  index: number;
}
export interface ClipboardDataSnapshot {
  varveData: ClipboardData | null;
  plainText: string | null;
  svgText: string | null;
  htmlText: string | null;
  files: ClipboardFileSnapshot[];
}
export function snapshotClipboardData(dt: DataTransfer): ClipboardDataSnapshot {
  let varveData: ClipboardData | null = null;
  for (const type of [VARVE_MIME, LEGACY_MIME, WEB_VARVE_MIME, WEB_LEGACY_MIME]) {
    try {
      const text = dt.getData(type);
      if (text) {
        const parsed = parseClipboardData(text);
        if (parsed) {
          varveData = parsed;
          break;
        }
      }
    } catch {
      // Continue through compatible representations.
    }
  }
  let svgText: string | null = null;
  for (const type of ['image/svg+xml', 'text/svg+xml']) {
    try {
      const text = dt.getData(type);
      if (text && isSvgText(text)) {
        svgText = text;
        break;
      }
    } catch {
      // Continue through the text fallback.
    }
  }
  let plainText: string | null = null;
  try {
    const text = dt.getData('text/plain');
    if (text && isSvgText(text)) svgText ??= text;
    else if (text) plainText = text;
  } catch {
    // Text is optional.
  }
  let htmlText: string | null = null;
  try {
    const html = dt.getData('text/html');
    if (html) htmlText = html.slice(0, 4 * 1024 * 1024);
  } catch {
    // HTML is optional.
  }
  const files: ClipboardFileSnapshot[] = [];
  const seenFiles = new Set<File>();
  const addFile = (file: File | null, index: number): void => {
    if (!file || seenFiles.has(file) || !file.type.startsWith('image/')) return;
    seenFiles.add(file);
    files.push({ file, index });
  };
  for (let i = 0; i < dt.files.length; i++) addFile(dt.files[i] ?? null, i);
  for (let i = 0; i < dt.items.length; i++) {
    const item = dt.items[i];
    if (item?.kind === 'file') addFile(item.getAsFile(), i);
  }
  return { varveData, plainText, svgText, htmlText, files };
}
export async function readClipboardSnapshot(
  snapshot: ClipboardDataSnapshot,
): Promise<UnifiedClipboardResult> {
  const result = createClipboardResult();
  result.varveData = snapshot.varveData;
  if (snapshot.plainText) result.plainText = snapshot.plainText;
  if (snapshot.htmlText) result.htmlText = snapshot.htmlText;
  if (snapshot.svgText) addSvgItem(result, snapshot.svgText, 'clipboard.svg');
  if (snapshot.htmlText) {
    const svg = extractSvgFromHtml(snapshot.htmlText);
    if (svg) addSvgItem(result, svg, 'clipboard-html.svg');
  }
  if (snapshot.varveData) return result;
  const imported = await Promise.all(
    snapshot.files.map(async ({ file, index }) => {
      try {
        if (file.type === 'image/svg+xml') {
          const text = await file.text();
          // A clipboard commonly exposes the same SVG as both a string MIME
          // and a File. Suppress only the byte-identical representation; a
          // second SVG file remains a distinct logical item.
          if (snapshot.svgText && text === snapshot.svgText) return null;
          return isSvgText(text)
            ? {
                data: text,
                mimeType: 'image/svg+xml',
                name: file.name || `clipboard-${index}.svg`,
              }
            : null;
        }
        return {
          data: new Uint8Array(await file.arrayBuffer()),
          mimeType: file.type,
          name: file.name || `clipboard-${index}.${file.type.split('/')[1] ?? 'bin'}`,
        } satisfies ClipboardImportItem;
      } catch {
        // Isolate one unreadable item from the rest of the paste.
        return null;
      }
    }),
  );
  for (const item of imported) {
    if (item) addImageItem(result, item.data, item.mimeType, item.name);
  }
  return result;
}
