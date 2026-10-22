/**
 * PDF import parser.
 *
 * Contract, stated once so callers can rely on it:
 *
 * - **Text** is imported as editable Varve text, positioned from the content
 *   stream's text matrix composed with the CTM and mapped into page space, so
 *   a page's text lands where the PDF puts it rather than mirrored.
 * - **Pages** map one-to-one, up to a bounded count; the remainder is named in
 *   the warnings instead of being silently merged into the last page.
 * - **Only plain axis-aligned rectangle fills and text** become nodes. Images,
 *   form XObjects, curves, strokes, CMYK and pattern paints, and composite-font
 *   runs with no mapping are *counted and reported*; none of them is
 *   approximated into artwork the user would mistake for the source.
 *
 * Decoding failures are reported, never converted into an empty document: a
 * document with no extractable text and a document whose streams could not be
 * read are different outcomes, and they read differently in Import Results.
 *
 * `center` and `keepPosition` do not apply here: content is placed in page
 * space by definition, so there is no unanchored position to adjust.
 */
import type { Affine } from '@varve/engine';
import type { Document, SceneNode } from '@varve/scene';
import {
  addChild,
  addPage,
  createDocument,
  makeShapeNode,
  makeTextNode,
  nextNodeId,
  setPageSize,
} from '@varve/scene';
import type { ImportCapabilities, ImportOptions, ImportParser, ImportResult } from '../types';
import type { RectFill, TextRun } from './content';
import { type ContentDiagnostics, createDiagnostics } from './content';
import { createContentInterpreter, runContentStream } from './contentInterpreter';
import { detectEncryption, type EncryptionInfo } from './encryption';
import {
  createDecodeReport,
  type DecodeReport,
  decodeStream,
  indexPdfObjects,
  MAX_PDF_BYTES,
  type PdfIndex,
} from './objects';
import { collectPages, MAX_IMPORTED_PAGES, type PageCollection, type PdfPage } from './pages';

/** PDF points are 1/72 inch; Varve page geometry is a fixed-96dpi world unit. */
const POINTS_TO_PX = 96 / 72;

export function createPdfParser(): ImportParser {
  return {
    format: 'pdf',
    supportedExtensions: () => ['pdf'],
    canParse: (data) => {
      if (typeof data === 'string') return false;
      if (data.length < 5) return false;
      return new TextDecoder().decode(data.slice(0, 5)) === '%PDF-';
    },
    parse: (data, options) => parsePdf(data, options ?? {}),
  };
}

export function parsePdf(data: string | Uint8Array, options: Partial<ImportOptions>): ImportResult {
  const opts: ImportOptions = {
    embedImages: options.embedImages ?? true,
    scale: options.scale ?? 1,
    center: options.center ?? false,
    keepPosition: options.keepPosition ?? false,
  };

  if (typeof data === 'string') return failedResult('PDF parsing requires binary data');
  if (data.length < 5) return failedResult('File too small to be a valid PDF');
  if (data.length > MAX_PDF_BYTES) {
    return failedResult(
      `PDF is larger than the ${Math.round(MAX_PDF_BYTES / (1024 * 1024))} MB import budget`,
    );
  }

  const warnings: string[] = [];
  const unsupportedFeatures: string[] = [];
  const report = createDecodeReport();
  const index = indexPdfObjects(data);
  if (index.truncated) {
    warnings.push(
      `Only the first ${Math.round(MAX_PDF_BYTES / (1024 * 1024))} MB were read; later objects were not imported`,
    );
  }

  const encryption = detectEncryption(index);
  if (encryption) return encryptedResult(encryption);

  const collection = collectPages(index, report);
  if (collection.pages.length === 0) return emptyResult(report, warnings, unsupportedFeatures);

  const diagnostics = createDiagnostics();
  const outcome = assembleDocument(index, collection.pages, report, diagnostics, opts);
  reportDiagnostics(collection, report, diagnostics, warnings, unsupportedFeatures);

  if (outcome.nodeIds.length === 0) {
    warnings.push('No text or plain rectangle fills could be imported from this PDF');
  }

  return {
    document: outcome.document,
    nodeIds: outcome.nodeIds,
    warnings,
    unsupportedFeatures,
    capabilities: capabilitiesFor({
      multipage: (outcome.document.pages?.length ?? 0) > 1,
      pageDimensions: true,
      text:
        diagnostics.undecodableRuns === 0 &&
        diagnostics.unmappedRuns === 0 &&
        outcome.nodeIds.length > 0,
      notes: capabilityNotes(collection, diagnostics, report, opts),
    }),
  };
}

function failedResult(reason: string): ImportResult {
  return {
    document: createDocument('Imported PDF'),
    nodeIds: [],
    warnings: [reason],
    failure: reason,
    unsupportedFeatures: ['The document could not be read at all'],
    capabilities: capabilitiesFor({
      multipage: false,
      pageDimensions: false,
      text: false,
      notes: [reason],
    }),
  };
}

/**
 * An encrypted document is refused, not guessed at.
 *
 * The standard security handler encrypts strings and streams; without it the
 * importer would read ciphertext as page content and produce an empty or
 * nonsense document that looks like a successful import. Saying so is the only
 * honest outcome, and it tells the user what to do next.
 */
function encryptedResult(encryption: EncryptionInfo): ImportResult {
  const how =
    encryption.filter && encryption.filter !== 'Standard' ? ` with ${encryption.filter}` : '';
  const reason = `This PDF is encrypted${how}. Varve cannot open encrypted PDFs (password-protected or permission-restricted); export an unencrypted copy from a PDF reader, then import that.`;
  return {
    document: createDocument('Imported PDF'),
    nodeIds: [],
    warnings: [reason],
    failure: reason,
    unsupportedFeatures: ['The document is encrypted, so its pages, text and images were not read'],
    capabilities: capabilitiesFor({
      multipage: false,
      pageDimensions: false,
      text: false,
      notes: [reason],
    }),
  };
}

function emptyResult(
  report: DecodeReport,
  warnings: string[],
  unsupportedFeatures: string[],
): ImportResult {
  warnings.push('No pages were found in this PDF');
  unsupportedFeatures.push('No /Type /Page objects were found, so nothing could be imported');
  if (report.unsupportedFilters.size > 0) {
    unsupportedFeatures.push(
      `Content streams using ${[...report.unsupportedFilters].join(', ')} are not decoded`,
    );
  }
  return {
    document: createDocument('Imported PDF'),
    nodeIds: [],
    warnings,
    unsupportedFeatures,
    capabilities: capabilitiesFor({
      multipage: false,
      pageDimensions: false,
      text: false,
      notes: ['No page objects were found; page geometry was not read'],
    }),
  };
}

interface BuildOutcome {
  document: Document;
  nodeIds: string[];
}

/**
 * One Varve page per PDF page, holding that page's text runs and rectangle
 * fills. Text stays editable; nothing is flattened into an image.
 */
function assembleDocument(
  index: PdfIndex,
  pages: PdfPage[],
  report: DecodeReport,
  diagnostics: ContentDiagnostics,
  opts: ImportOptions,
): BuildOutcome {
  const first = pages[0]!;
  const firstSize = pageSizeOf(first, opts);
  let doc = createDocument('Imported PDF', {
    physicalWidth: first.box.x1 - first.box.x0,
    physicalHeight: first.box.y1 - first.box.y0,
    documentUnit: 'pt',
  });
  const nodeIds: string[] = [];

  for (const [position, page] of pages.entries()) {
    const size = pageSizeOf(page, opts);
    if (position === 0) {
      const pageId = doc.pages?.[0]?.id;
      if (!pageId) break;
      doc = setPageSize(doc, pageId, firstSize.width, firstSize.height);
    } else {
      doc = addPage(doc, {
        width: size.width,
        height: size.height,
        name: `Page ${position + 1}`,
      });
    }
    const target = doc.pages?.[position];
    if (!target) break;
    const built = buildPageNodes(index, page, target.contentRoot, doc, report, diagnostics, opts);
    doc = built.document;
    nodeIds.push(...built.nodeIds);
  }

  return { document: doc, nodeIds };
}

function buildPageNodes(
  index: PdfIndex,
  page: PdfPage,
  contentRoot: string,
  doc: Document,
  report: DecodeReport,
  diagnostics: ContentDiagnostics,
  opts: ImportOptions,
): BuildOutcome {
  let current = doc;
  const nodeIds: string[] = [];

  // One interpreter for the whole page: a `/Contents` array is a single
  // concatenated program, so state and marked-content nesting cross the
  // boundary between its streams.
  const interpreter = createContentInterpreter(
    {
      box: page.box,
      rotate: page.rotate,
      fonts: page.fonts,
      extGStates: page.extGStates,
      hiddenPropertyNames: page.hiddenProperties,
    },
    diagnostics,
  );
  for (const content of page.contents) {
    const bytes = decodeStream(index, content, report);
    if (!bytes) continue;
    runContentStream(interpreter, bytes, diagnostics);
  }
  diagnostics.outsidePage += interpreter.outsidePage;
  // Paint order is stream order: a fill emitted before a run stays below it.
  // Consecutive vertical runs that continue one column are merged before nodes
  // are created: producers commonly position one glyph per `Tj`, and one node
  // per glyph would read the column as a row of single characters.
  const placements = groupVerticalColumns(interpreter.emissionOrder, interpreter);
  diagnostics.verticalColumns += placements.filter(
    (placement) => placement.kind === 'run' && placement.run.vertical,
  ).length;
  for (const placement of placements) {
    const { node, document } =
      placement.kind === 'run'
        ? textNodeFor(placement.run, placement.text, current, opts)
        : rectNodeFor(placement.rect, current, opts);
    current = addChild(document, contentRoot, node);
    nodeIds.push(node.id);
  }

  return { document: current, nodeIds };
}

type Placement =
  | {
      readonly kind: 'run';
      readonly run: TextRun;
      readonly text: string;
      readonly endX: number;
      readonly endY: number;
    }
  | { readonly kind: 'rect'; readonly rect: RectFill };

/**
 * Merge runs that continue one vertical column. Two runs join when they share
 * the font and size, start where the previous run's pen stopped, and keep
 * moving in the same direction. Anything else — a different font, a gap, a
 * rectangle painted between them — stays a separate node, so a false join can
 * never reorder the page.
 */
function groupVerticalColumns(
  order: readonly { readonly kind: 'run' | 'rect'; readonly at: number }[],
  interpreter: { readonly runs: readonly TextRun[]; readonly rects: readonly RectFill[] },
): Placement[] {
  const placements: Placement[] = [];
  for (const item of order) {
    if (item.kind === 'rect') {
      const rect = interpreter.rects[item.at];
      if (rect) placements.push({ kind: 'rect', rect });
      continue;
    }
    const run = interpreter.runs[item.at];
    if (!run) continue;
    const previous = placements[placements.length - 1];
    if (run.vertical && previous?.kind === 'run' && continuesColumn(previous, run)) {
      placements[placements.length - 1] = {
        kind: 'run',
        run: previous.run,
        text: previous.text + run.text,
        endX: run.x + run.advanceX,
        endY: run.y + run.advanceY,
      };
      continue;
    }
    placements.push({
      kind: 'run',
      run,
      text: run.text,
      endX: run.x + run.advanceX,
      endY: run.y + run.advanceY,
    });
  }
  return placements;
}

function continuesColumn(previous: Extract<Placement, { kind: 'run' }>, run: TextRun): boolean {
  if (!previous.run.vertical) return false;
  if (
    previous.run.fontResource !== run.fontResource ||
    previous.run.fontBase !== run.fontBase ||
    Math.abs(previous.run.fontSize - run.fontSize) > 0.01
  ) {
    return false;
  }
  const tolerance = Math.max(0.5, run.fontSize * 0.25);
  if (Math.hypot(run.x - previous.endX, run.y - previous.endY) > tolerance) return false;
  // A run that reverses direction starts a new column, not a continuation.
  return run.advanceX * previous.run.advanceX + run.advanceY * previous.run.advanceY >= 0;
}

function pageSizeOf(page: PdfPage, opts: ImportOptions): { width: number; height: number } {
  const scale = opts.scale > 0 ? opts.scale : 1;
  const width = (page.box.x1 - page.box.x0) * POINTS_TO_PX * scale;
  const height = (page.box.y1 - page.box.y0) * POINTS_TO_PX * scale;
  return page.rotate === 90 || page.rotate === 270
    ? { width: height, height: width }
    : { width, height };
}

function textNodeFor(
  run: TextRun,
  text: string,
  doc: Document,
  opts: ImportOptions,
): { node: SceneNode; document: Document } {
  const scale = opts.scale > 0 ? opts.scale : 1;
  const { id, doc: next } = nextNodeId(doc);
  const family = run.fontBase?.replace(/^[A-Z]{6}\+/, '');
  const node = makeTextNode(id, text, {
    name: family
      ? `${run.vertical ? 'Vertical text' : 'Text'} (${family})`
      : run.vertical
        ? 'Vertical text'
        : 'Text',
    transform: [1, 0, 0, 1, run.x * POINTS_TO_PX * scale, run.y * POINTS_TO_PX * scale] as Affine,
    fontSize: Math.max(run.fontSize * POINTS_TO_PX * scale, 0.1),
    // A vertical run is a column, not a line. Varve authors vertical text
    // natively, so the run keeps its writing mode instead of arriving as one
    // long horizontal string.
    ...(run.vertical ? { writingMode: 'vertical-rl' as const } : {}),
  });
  return { node, document: next };
}

function rectNodeFor(
  rect: RectFill,
  doc: Document,
  opts: ImportOptions,
): { node: SceneNode; document: Document } {
  const scale = opts.scale > 0 ? opts.scale : 1;
  const { id, doc: next } = nextNodeId(doc);
  const width = Math.max(rect.width * POINTS_TO_PX * scale, 0);
  const height = Math.max(rect.height * POINTS_TO_PX * scale, 0);
  const node = makeShapeNode(
    id,
    { kind: 'rect', x: 0, y: 0, w: width, h: height },
    {
      name: 'Rectangle',
      transform: [
        1,
        0,
        0,
        1,
        rect.x * POINTS_TO_PX * scale,
        rect.y * POINTS_TO_PX * scale,
      ] as Affine,
      fill: {
        space: 'rgb' as const,
        r: toByte(rect.r),
        g: toByte(rect.g),
        b: toByte(rect.b),
        a: toByte(rect.alpha),
      },
    },
  );
  return { node, document: next };
}

function toByte(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

function reportDiagnostics(
  collection: PageCollection,
  report: DecodeReport,
  diagnostics: ContentDiagnostics,
  warnings: string[],
  unsupportedFeatures: string[],
): void {
  if (collection.detected > collection.pages.length) {
    warnings.push(
      `Imported the first ${MAX_IMPORTED_PAGES} of ${collection.detected} pages; the rest were not imported`,
    );
  }
  if (!collection.orderedByTree) {
    warnings.push(
      'Page order was inferred from object numbers because the page tree could not be read',
    );
  }
  const undecodable = collection.undecodableContents + report.skippedStreams;
  if (undecodable > 0) {
    warnings.push(`${undecodable} page content stream(s) could not be decoded and were skipped`);
  }
  if (report.unsupportedFilters.size > 0) {
    unsupportedFeatures.push(
      `Content streams using ${[...report.unsupportedFilters].join(', ')} are not decoded`,
    );
  }
  if (report.oversizedStreams > 0) {
    unsupportedFeatures.push(`${report.oversizedStreams} stream(s) exceeded the decode budget`);
  }
  if (diagnostics.undecodableRuns > 0) {
    unsupportedFeatures.push(
      `${diagnostics.undecodableRuns} text run(s) use a font with no readable encoding (composite fonts need a /ToUnicode map)`,
    );
  }
  if (diagnostics.invisibleRuns > 0) {
    unsupportedFeatures.push(
      `${diagnostics.invisibleRuns} text run(s) are painted with an invisible or clip-only render mode and were not imported (a searchable text layer over a scan looks like this)`,
    );
  }
  if (diagnostics.hiddenRuns > 0 || diagnostics.hiddenRects > 0) {
    const parts: string[] = [];
    if (diagnostics.hiddenRuns > 0) parts.push(`${diagnostics.hiddenRuns} text run(s)`);
    if (diagnostics.hiddenRects > 0) parts.push(`${diagnostics.hiddenRects} fill(s)`);
    const layers = [...diagnostics.hiddenLayers];
    const named = layers.length > 0 ? ` (hidden layers: ${layers.join(', ')})` : '';
    unsupportedFeatures.push(
      `${parts.join(' and ')} were not imported: the document's default layer configuration hides them${named}`,
    );
  }
  if (diagnostics.unresolvedOptionalContent > 0) {
    unsupportedFeatures.push(
      `${diagnostics.unresolvedOptionalContent} optional-content section(s) could not be resolved; their content was imported as visible`,
    );
  }
  if (diagnostics.unmappedRuns > 0) {
    unsupportedFeatures.push(
      `${diagnostics.unmappedRuns} text run(s) contained ${diagnostics.unmappedCodes} character(s) the font does not map; those characters are missing from the imported text`,
    );
  }
  if (diagnostics.formXObjects > 0) {
    unsupportedFeatures.push(
      `${diagnostics.formXObjects} form XObject(s) were not entered; content drawn inside them is not imported`,
    );
  }
  if (diagnostics.strokedPaths > 0) {
    unsupportedFeatures.push(`${diagnostics.strokedPaths} stroked path(s) were not imported`);
  }
  if (diagnostics.cmykFills > 0) {
    unsupportedFeatures.push(
      `${diagnostics.cmykFills} CMYK paint operator(s) were skipped rather than converted to a different colour space`,
    );
  }
  if (diagnostics.patternFills > 0) {
    unsupportedFeatures.push(
      `${diagnostics.patternFills} pattern, separation or unresolved paint(s) were skipped`,
    );
  }
  if (diagnostics.unknownGraphicsStates > 0) {
    unsupportedFeatures.push(
      `${diagnostics.unknownGraphicsStates} unresolved graphics state(s); fills under them were skipped instead of painted opaque`,
    );
  }
  if (diagnostics.inlineImages > 0) {
    unsupportedFeatures.push(`${diagnostics.inlineImages} inline image(s) were skipped`);
  }
  if (diagnostics.truncated) {
    warnings.push('A content stream was longer than the interpreter budget and was truncated');
  }
  unsupportedFeatures.push(
    'Images, curves, gradients, and text inside form XObjects are not imported',
  );
}

function capabilityNotes(
  collection: PageCollection,
  diagnostics: ContentDiagnostics,
  report: DecodeReport,
  opts: ImportOptions,
): string[] {
  const notes = [
    'Text is imported as editable text with positions taken from the page content stream',
    'Only plain axis-aligned rectangle fills are imported as vectors; curves, strokes, images and gradients are reported rather than approximated',
  ];
  if (opts.scale !== 1) notes.push(`Geometry scaled by ${opts.scale}x at import`);
  if (collection.pages.some((page) => page.rotate !== 0)) {
    notes.push('Page rotation was applied to page size and to content positions');
  }
  if (collection.pages.some((page) => page.cropBoxApplied)) {
    notes.push('The crop box was used as the page box where it differs from the media box');
  }
  if (diagnostics.verticalRuns > 0) {
    notes.push(
      `${diagnostics.verticalRuns} vertical text run(s) were imported as ${diagnostics.verticalColumns} vertical column(s)`,
    );
  }
  if (report.unsupportedFilters.size > 0) notes.push('Unsupported stream filters were reported');
  if (diagnostics.outsidePage > 0) {
    notes.push(
      `${diagnostics.outsidePage} text run(s) fall outside the page box and are placed outside it`,
    );
  }
  return notes;
}

function capabilitiesFor(input: {
  multipage: boolean;
  pageDimensions: boolean;
  text: boolean;
  notes: string[];
}): ImportCapabilities {
  return {
    format: 'pdf',
    multipage: input.multipage,
    pageDimensions: input.pageDimensions,
    vectors: true,
    text: input.text,
    images: false,
    masters: false,
    textThreads: false,
    notes: input.notes,
  };
}
