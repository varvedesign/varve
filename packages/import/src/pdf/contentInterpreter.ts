/**
 * Interpreter for tokenized PDF content streams.
 *
 * The graphics and text state machines live here: `q`/`Q` save and restore the
 * transformation matrix, fill colour and text state; `cm` composes the CTM;
 * `Td`/`TD`/`Tm`/`T*` move the text matrix; `Tj`/`TJ`/`'`/`"` place glyph runs
 * whose device position is the text matrix composed with the CTM and then
 * mapped into page space (top-left origin, clockwise `/Rotate` applied).
 *
 * Only axis-aligned `re` fills become shapes. A path with curves, strokes, or
 * an unresolved paint space is counted instead of guessed, because a rectangle
 * that is not the source's rectangle is worse than no rectangle at all.
 */
import {
  type ContentDiagnostics,
  type ContentToken,
  type ExtGState,
  type RectFill,
  type TextRun,
  tokenizeContent,
} from './content';
import type { PdfFont } from './encoding';
import { decodeUtf16Be, hasUtf16Bom } from './encoding';
import { applyMat, IDENTITY, type Mat, multiply, toDisplaySpace, translation } from './geometry';
import type { PdfPageBox } from './pages';

/** A `TJ` gap at least this wide (in em) is a word space, not letter kerning. */
const WORD_GAP_EM = 0.18;
/** Advance used when a font publishes no width for a code. */
const FALLBACK_WIDTH = 500;
const MAX_RUNS = 4000;
const MAX_RECTS = 4000;

interface TextState {
  font: PdfFont | null;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  horizScale: number;
  leading: number;
  rise: number;
  /**
   * `Tr` text rendering mode. 3 (invisible) and 7 (clip) paint no glyphs, so
   * their text is not part of the page's appearance.
   */
  renderMode: number;
  matrix: Mat;
  lineMatrix: Mat;
}

interface GraphicsState {
  ctm: Mat;
  fill: { r: number; g: number; b: number } | null;
  alpha: number;
  alphaUnknown: boolean;
  colorSpace: 'gray' | 'rgb' | 'cmyk' | 'unknown';
  text: TextState;
}

export interface InterpretContext {
  readonly box: PdfPageBox;
  readonly rotate: number;
  readonly fonts: Map<string, PdfFont>;
  readonly extGStates: Map<string, ExtGState>;
  /**
   * Optional-content property names (`/OC /MC0 BDC` → `/Properties /MC0`) that
   * the document's default configuration hides, with the layer name used in
   * the import report.
   */
  readonly hiddenPropertyNames?: ReadonlyMap<string, string>;
}

export interface ContentResult {
  readonly runs: TextRun[];
  readonly rects: RectFill[];
  readonly diagnostics: ContentDiagnostics;
}

type Operand = number | string | Uint8Array | Operand[];

/** Tokenize and interpret one content stream, appending to `diagnostics`. */
export function interpretContent(
  bytes: Uint8Array,
  context: InterpretContext,
  diagnostics: ContentDiagnostics,
): ContentResult {
  const interpreter = createContentInterpreter(context, diagnostics);
  runContentStream(interpreter, bytes, diagnostics);
  diagnostics.outsidePage += interpreter.outsidePage;
  return { runs: interpreter.runs, rects: interpreter.rects, diagnostics };
}

/**
 * One interpreter for a whole page. A page's `/Contents` may be an array of
 * streams, and the format treats that array as a single concatenated program:
 * graphics state, text state and marked-content sections opened in one element
 * continue in the next. Creating an interpreter per element would lose a
 * hidden section's nesting and paint its content.
 */
export function createContentInterpreter(
  context: InterpretContext,
  diagnostics: ContentDiagnostics,
): ContentInterpreter {
  return new ContentInterpreter(context, diagnostics);
}

/** Interpret one stream into an existing page interpreter. */
export function runContentStream(
  interpreter: ContentInterpreter,
  bytes: Uint8Array,
  diagnostics: ContentDiagnostics,
): void {
  const { tokens, truncated, inlineImages } = tokenizeContent(bytes);
  if (truncated) diagnostics.truncated = true;
  diagnostics.inlineImages += inlineImages;
  interpreter.run(tokens);
  for (const name of interpreter.hiddenLayerNames) diagnostics.hiddenLayers.add(name);
}

export class ContentInterpreter {
  readonly runs: TextRun[] = [];
  readonly rects: RectFill[] = [];
  /**
   * Emission order across both lists. A page's content is painted in stream
   * order, and a fill emitted before a text run must stay below it after the
   * page is converted into nodes.
   */
  private readonly emissions: Array<{ readonly kind: 'run' | 'rect'; readonly at: number }> = [];
  private readonly pageBox: {
    width: number;
    height: number;
    rotate: number;
    originX: number;
    originY: number;
  };
  private operands: Operand[] = [];
  private arrayStack: Operand[][] | null = null;
  private state: GraphicsState;
  private stack: GraphicsState[] = [];
  private path: Array<{ x: number; y: number; w: number; h: number }> = [];
  private pathIsRectOnly = true;
  private outsidePageCount = 0;
  /** One entry per open marked-content section; true when it is hidden. */
  private markedContent: boolean[] = [];
  private hiddenDepth = 0;
  /**
   * True when `/OC` was followed by a direct dictionary. The tokenizer does
   * not build dictionary values, so the members would otherwise be read as
   * operands and the section would look like a name lookup that missed.
   */
  private ocDictionaryPending = false;
  private readonly hiddenLayers = new Set<string>();

  constructor(
    private readonly context: InterpretContext,
    private readonly diagnostics: ContentDiagnostics,
  ) {
    this.pageBox = {
      width: context.box.x1 - context.box.x0,
      height: context.box.y1 - context.box.y0,
      rotate: context.rotate,
      originX: context.box.x0,
      originY: context.box.y0,
    };
    this.state = freshGraphicsState();
  }

  /** Text runs whose display position fell outside the visible page box. */
  get outsidePage(): number {
    return this.outsidePageCount;
  }

  /** Names of hidden optional-content layers that had content on this page. */
  get hiddenLayerNames(): string[] {
    return [...this.hiddenLayers];
  }

  /** Runs and fills in the order the page painted them. */
  get emissionOrder(): ReadonlyArray<{ readonly kind: 'run' | 'rect'; readonly at: number }> {
    return this.emissions;
  }

  run(tokens: ContentToken[]): void {
    for (const token of tokens) {
      switch (token.kind) {
        case 'number':
          this.operands.push(token.value);
          break;
        case 'string':
          this.operands.push(token.value);
          break;
        case 'name':
          this.operands.push(`/${token.value}`);
          break;
        case 'arrayOpen':
          this.openArray();
          break;
        case 'arrayClose':
          this.closeArray();
          break;
        case 'dictOpen':
          if (this.operands[0] === '/OC') {
            this.ocDictionaryPending = true;
            this.operands = [];
          }
          break;
        case 'operator':
          this.dispatch(token.value);
          break;
        default:
          break;
      }
    }
  }

  private openArray(): void {
    const inner: Operand[] = [];
    if (this.arrayStack) {
      this.arrayStack[this.arrayStack.length - 1]!.push(inner);
      this.arrayStack.push(inner);
      return;
    }
    this.arrayStack = [inner];
  }

  private closeArray(): void {
    if (!this.arrayStack) return;
    const completed = this.arrayStack.pop()!;
    if (this.arrayStack.length === 0) {
      this.arrayStack = null;
      this.operands.push(completed);
    }
  }

  private dispatch(operator: string): void {
    const handled =
      this.handleGraphicsState(operator) ||
      this.handleText(operator) ||
      this.handlePath(operator) ||
      this.handleMarkedContent(operator);
    if (!handled && operator === 'Do') this.diagnostics.formXObjects += 1;
    this.operands = [];
  }

  // ── Marked content (optional-content visibility) ──────────────────────

  /**
   * Optional-content sections are the PDF mechanism behind "layers". A section
   * whose group is off is not shown by any conforming reader, so importing its
   * content as visible artwork would add things the document does not display
   * — the class that makes a layered CAD drawing arrive with every hidden sheet
   * on top of the visible one.
   */
  private handleMarkedContent(operator: string): boolean {
    switch (operator) {
      case 'BDC':
      case 'BMC':
        this.markedContent.push(this.enterMarkedContent(operator));
        return true;
      case 'EMC':
        if (this.markedContent.pop() === true) this.hiddenDepth -= 1;
        return true;
      default:
        return false;
    }
  }

  private enterMarkedContent(operator: string): boolean {
    if (this.ocDictionaryPending) {
      this.ocDictionaryPending = false;
      this.diagnostics.unresolvedOptionalContent += 1;
      return false;
    }
    if (this.operands[0] !== '/OC') return false;
    // `BDC` takes a tag and exactly one property-list operand. A direct
    // dictionary arrives here as its members (`/Type`, `/OCGs`, …) because the
    // tokenizer does not build dictionary values; that section's visibility
    // needs an object graph this interpreter deliberately does not carry, so
    // it is reported as unresolved rather than assumed visible.
    const property = this.operands.length === 2 ? this.operands[1] : undefined;
    if (operator !== 'BDC' || typeof property !== 'string' || !property.startsWith('/')) {
      this.diagnostics.unresolvedOptionalContent += 1;
      return false;
    }
    const hiddenLayer = this.context.hiddenPropertyNames?.get(property);
    if (hiddenLayer === undefined) return false;
    this.hiddenLayers.add(hiddenLayer);
    this.hiddenDepth += 1;
    return true;
  }

  // ── Graphics state ────────────────────────────────────────────────────

  private handleGraphicsState(operator: string): boolean {
    switch (operator) {
      case 'q':
        this.stack.push(cloneState(this.state));
        return true;
      case 'Q':
        this.state = this.stack.pop() ?? this.state;
        return true;
      case 'cm':
        this.applyCtm();
        return true;
      case 'gs':
        this.applyExtGState();
        return true;
      case 'rg':
        this.state.colorSpace = 'rgb';
        this.state.fill = this.rgbFromOperands();
        return true;
      case 'g':
        this.state.colorSpace = 'gray';
        this.state.fill = grayFill(this.numberAt(0));
        return true;
      case 'k':
        this.state.colorSpace = 'cmyk';
        this.state.fill = null;
        this.diagnostics.cmykFills += 1;
        return true;
      case 'cs':
        this.state.colorSpace = colorSpaceNamed(this.nameAt(0));
        this.state.fill = null;
        return true;
      case 'sc':
      case 'scn':
        this.applyColorOperands();
        return true;
      case 'BT':
        this.state.text.matrix = IDENTITY;
        this.state.text.lineMatrix = IDENTITY;
        return true;
      default:
        return false;
    }
  }

  private applyCtm(): void {
    const values = numbersOf(this.operands);
    if (values.length < 6) return;
    this.state.ctm = multiply(matrixFrom(values), this.state.ctm);
  }

  private applyExtGState(): void {
    const name = this.nameAt(0);
    const found = this.context.extGStates.get(name);
    if (!found) {
      // An unread ExtGState may carry transparency; painting its fill opaque
      // would assert an appearance the source never had.
      this.state.alphaUnknown = true;
      this.diagnostics.unknownGraphicsStates += 1;
      return;
    }
    this.state.alpha = found.alpha ?? 1;
    this.state.alphaUnknown = found.alpha === null;
  }

  private applyColorOperands(): void {
    const numbers = numbersOf(this.operands);
    if (this.state.colorSpace === 'rgb' && numbers.length >= 3) {
      this.state.fill = {
        r: clamp01(numbers[0]!),
        g: clamp01(numbers[1]!),
        b: clamp01(numbers[2]!),
      };
      return;
    }
    if (this.state.colorSpace === 'gray' && numbers.length >= 1) {
      this.state.fill = grayFill(numbers[0]!);
      return;
    }
    if (this.state.colorSpace === 'cmyk') {
      this.state.fill = null;
      this.diagnostics.cmykFills += 1;
      return;
    }
    // Pattern, separation, or an ICC space that is not mapped here: the fill
    // is reported rather than emitted as a colour the source never had.
    this.state.fill = null;
    this.diagnostics.patternFills += 1;
  }

  // ── Text ──────────────────────────────────────────────────────────────

  private handleText(operator: string): boolean {
    switch (operator) {
      case 'Tf':
        this.setFont();
        return true;
      case 'Td':
        this.moveText(this.numberAt(0), this.numberAt(1), false);
        return true;
      case 'TD':
        this.state.text.leading = -this.numberAt(1);
        this.moveText(this.numberAt(0), this.numberAt(1), false);
        return true;
      case 'Tm':
        this.setTextMatrix();
        return true;
      case 'T*':
        this.moveText(0, -this.state.text.leading, true);
        return true;
      case 'TL':
        this.state.text.leading = this.numberAt(0);
        return true;
      case 'Tc':
        this.state.text.charSpacing = this.numberAt(0);
        return true;
      case 'Tw':
        this.state.text.wordSpacing = this.numberAt(0);
        return true;
      case 'Tz':
        this.state.text.horizScale = this.numberAt(0) / 100;
        return true;
      case 'Ts':
        this.state.text.rise = this.numberAt(0);
        return true;
      case 'Tr':
        this.state.text.renderMode = Math.trunc(this.numberAt(0));
        return true;
      case 'Tj':
        this.showStrings(false);
        return true;
      case 'TJ':
        this.showStrings(true);
        return true;
      case "'":
      case '"':
        this.handleQuoteOperator(operator);
        return true;
      case 'ET':
        return true;
      default:
        return false;
    }
  }

  private handleQuoteOperator(operator: string): void {
    if (operator === '"') {
      this.state.text.wordSpacing = this.numberAt(0);
      this.state.text.charSpacing = this.numberAt(1);
    }
    this.moveText(0, -this.state.text.leading, true);
    this.showStrings(false);
  }

  private setFont(): void {
    const name = this.nameAt(0);
    this.state.text.font = this.context.fonts.get(name) ?? null;
    this.state.text.fontSize = this.numberAt(1);
  }

  private setTextMatrix(): void {
    const values = numbersOf(this.operands);
    if (values.length < 6) return;
    const matrix = matrixFrom(values);
    this.state.text.matrix = matrix;
    this.state.text.lineMatrix = matrix;
  }

  private moveText(tx: number, ty: number, relativeToLine: boolean): void {
    const base = relativeToLine ? this.state.text.lineMatrix : this.state.text.lineMatrix;
    const moved = multiply(translation(tx, ty), base);
    this.state.text.matrix = moved;
    this.state.text.lineMatrix = moved;
  }

  /** Show the operands of `Tj`/`TJ`/`'`/`"` as one positioned text run. */
  private showStrings(fromArray: boolean): void {
    const text = this.state.text;
    const font = text.font;
    if (!font) return;
    if (!font.decodable) {
      this.diagnostics.undecodableRuns += 1;
      return;
    }
    const position = this.displayPosition();
    const vertical = font.vertical === true;
    const items = fromArray && Array.isArray(this.operands[0]) ? this.operands[0] : this.operands;

    let content = '';
    let unmappedCodes = 0;
    let estimated = false;

    for (const item of items) {
      if (typeof item === 'number') {
        // A numeric TJ operand is a kerning adjustment: positive advances the
        // pen backwards, negative opens a gap that usually means a space.
        const emGap = -item / 1000;
        this.advanceInTextSpace(emGap * text.fontSize * text.horizScale);
        if (emGap >= WORD_GAP_EM && content.length > 0 && !content.endsWith(' ')) {
          content += ' ';
        }
        continue;
      }
      if (!(item instanceof Uint8Array)) continue;
      const decoded = this.decodeAndAdvance(item);
      content += decoded.text;
      unmappedCodes += decoded.unmapped;
      estimated ||= decoded.estimated;
    }

    const trimmed = trimTrailingSpace(content);
    if (unmappedCodes > 0) {
      this.diagnostics.unmappedRuns += 1;
      this.diagnostics.unmappedCodes += unmappedCodes;
    }
    if (trimmed.length === 0) return;
    if (this.hiddenDepth > 0) {
      // The document's default configuration hides this layer, so the user
      // does not see this text; report the count instead of importing it.
      this.diagnostics.hiddenRuns += 1;
      return;
    }
    if (!paintsGlyphs(text.renderMode)) {
      // `3 Tr` (invisible) and `7 Tr` (clip only) paint no glyphs. A searchable
      // OCR layer is exactly this text: importing it as visible would put a
      // duplicate, editable copy of the scan over the image.
      this.diagnostics.invisibleRuns += 1;
      return;
    }
    if (this.runs.length >= MAX_RUNS) return;
    if (vertical) this.diagnostics.verticalRuns += 1;
    const display = toDisplaySpace(this.pageBox, position.x, position.y);
    this.emissions.push({ kind: 'run', at: this.runs.length });
    this.runs.push({
      text: trimmed,
      x: display.x,
      y: display.y,
      fontSize: position.fontSize,
      fontResource: font.resourceName,
      fontBase: font.baseFont,
      estimatedAdvance: estimated,
      vertical,
    });
    if (this.isOutsidePage(display.x, display.y)) this.outsidePageCount += 1;
  }

  /** Position and effective size of the next glyph run, in user space. */
  private displayPosition(): { x: number; y: number; fontSize: number } {
    const composed = multiply(this.state.text.matrix, this.state.ctm);
    const point = applyMat(composed, 0, this.state.text.rise);
    const scale = Math.hypot(composed[0], composed[1]) || 1;
    return { x: point.x, y: point.y, fontSize: this.state.text.fontSize * scale };
  }

  private isOutsidePage(x: number, y: number): boolean {
    const rotated = this.pageBox.rotate === 90 || this.pageBox.rotate === 270;
    const width = rotated ? this.pageBox.height : this.pageBox.width;
    const height = rotated ? this.pageBox.width : this.pageBox.height;
    return x < -1 || y < -1 || x > width + 1 || y > height + 1;
  }

  /** Decodes codes → text, advancing the pen by each resolved glyph width. */
  private decodeAndAdvance(bytes: Uint8Array): {
    text: string;
    unmapped: number;
    estimated: boolean;
  } {
    const text = this.state.text;
    if (hasUtf16Bom(bytes)) {
      // A UTF-16BE byte-order mark means the string is already Unicode text;
      // the font's encoding does not apply and no widths are published for it.
      const decoded = decodeUtf16Be(bytes);
      this.advanceInTextSpace(
        (FALLBACK_WIDTH / 1000) * text.fontSize * text.horizScale * decoded.length,
      );
      return { text: decoded, unmapped: 0, estimated: true };
    }
    const step = text.font?.twoByteCodes ? 2 : 1;
    const vertical = text.font?.vertical === true;
    let out = '';
    let unmapped = 0;
    let estimated = false;
    for (let i = 0; i + step - 1 < bytes.length; i += step) {
      const code = step === 2 ? (bytes[i]! << 8) | bytes[i + 1]! : bytes[i]!;
      const mapped = text.font?.textFor(code) ?? '';
      const width = text.font?.widthOf(code) ?? null;
      if (width === null) estimated = true;
      if (mapped.length === 0) unmapped += 1;
      else out += mapped;
      // A vertical run advances by the font's vertical displacement (`/W2`,
      // falling back to `/DW2`, then to one em). Falling back to the default
      // is an estimate and is marked as one.
      const verticalWidth = vertical ? (text.font?.verticalAdvanceOf(code) ?? null) : null;
      if (vertical && verticalWidth === null) estimated = true;
      const advance = vertical
        ? ((verticalWidth ?? 1000) / 1000) * text.fontSize + text.charSpacing
        : ((width ?? FALLBACK_WIDTH) / 1000) * text.fontSize + text.charSpacing;
      if (text.font && code === text.font.spaceCode) {
        this.advanceInTextSpace((advance + text.wordSpacing) * text.horizScale);
        continue;
      }
      this.advanceInTextSpace(advance * text.horizScale);
    }
    return { text: out, unmapped, estimated };
  }

  private advanceInTextSpace(amount: number): void {
    if (amount === 0) return;
    // Vertical writing advances down the page (negative y in text space), so a
    // column of text is not laid out as one horizontal line.
    const step = this.state.text.font?.vertical ? translation(0, -amount) : translation(amount, 0);
    this.state.text.matrix = multiply(step, this.state.text.matrix);
  }

  // ── Paths ─────────────────────────────────────────────────────────────

  private handlePath(operator: string): boolean {
    switch (operator) {
      case 're':
        this.addRect();
        return true;
      case 'm':
      case 'l':
      case 'c':
      case 'v':
      case 'y':
      case 'h':
        // Any non-rectangle segment means `f` no longer paints plain rects.
        this.pathIsRectOnly = false;
        return true;
      case 'f':
      case 'F':
      case 'f*':
        this.paintFill();
        return true;
      case 'n':
        this.resetPath();
        return true;
      case 'S':
      case 's':
      case 'B':
      case 'B*':
      case 'b':
      case 'b*':
        this.diagnostics.strokedPaths += 1;
        this.resetPath();
        return true;
      default:
        return false;
    }
  }

  private addRect(): void {
    const numbers = numbersOf(this.operands);
    if (numbers.length < 4) return;
    this.path.push({ x: numbers[0]!, y: numbers[1]!, w: numbers[2]!, h: numbers[3]! });
  }

  private paintFill(): void {
    const fill = this.state.fill;
    if (fill && this.pathIsRectOnly && !this.state.alphaUnknown) {
      if (this.hiddenDepth > 0) {
        this.diagnostics.hiddenRects += this.path.length;
      } else {
        for (const rect of this.path) {
          if (this.rects.length >= MAX_RECTS) break;
          this.emissions.push({ kind: 'rect', at: this.rects.length });
          this.rects.push(this.toRectFill(rect, fill));
        }
      }
    }
    this.resetPath();
  }

  private toRectFill(
    rect: { x: number; y: number; w: number; h: number },
    fill: { r: number; g: number; b: number },
  ): RectFill {
    const corner = applyMat(this.state.ctm, rect.x, rect.y);
    const opposite = applyMat(this.state.ctm, rect.x + rect.w, rect.y + rect.h);
    const start = toDisplaySpace(this.pageBox, corner.x, corner.y);
    const end = toDisplaySpace(this.pageBox, opposite.x, opposite.y);
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
      r: fill.r,
      g: fill.g,
      b: fill.b,
      alpha: this.state.alpha,
    };
  }

  private resetPath(): void {
    this.path = [];
    this.pathIsRectOnly = true;
  }

  // ── Operand helpers ──────────────────────────────────────────────────

  private numberAt(index: number): number {
    const value = this.operands[index];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private nameAt(index: number): string {
    const value = this.operands[index];
    return typeof value === 'string' ? value.replace('/', '') : '';
  }

  private rgbFromOperands(): { r: number; g: number; b: number } {
    return {
      r: clamp01(this.numberAt(0)),
      g: clamp01(this.numberAt(1)),
      b: clamp01(this.numberAt(2)),
    };
  }
}

function freshGraphicsState(): GraphicsState {
  return {
    ctm: IDENTITY,
    fill: { r: 0, g: 0, b: 0 },
    alpha: 1,
    alphaUnknown: false,
    colorSpace: 'gray',
    text: {
      font: null,
      fontSize: 0,
      charSpacing: 0,
      wordSpacing: 0,
      horizScale: 1,
      leading: 0,
      rise: 0,
      renderMode: 0,
      matrix: IDENTITY,
      lineMatrix: IDENTITY,
    },
  };
}

function cloneState(state: GraphicsState): GraphicsState {
  return { ...state, text: { ...state.text }, fill: state.fill ? { ...state.fill } : null };
}

function matrixFrom(values: number[]): Mat {
  return [values[0]!, values[1]!, values[2]!, values[3]!, values[4]!, values[5]!];
}

function numbersOf(operands: Operand[]): number[] {
  return operands.filter((operand): operand is number => typeof operand === 'number');
}

/**
 * Text rendering modes that paint glyphs: 0 fill, 1 stroke, 2 fill+stroke,
 * 4-6 the same with clipping added. Modes 3 (invisible) and 7 (clip only)
 * leave no mark on the page.
 */
function paintsGlyphs(renderMode: number): boolean {
  return renderMode >= 0 && renderMode <= 6 && renderMode !== 3;
}

function grayFill(value: number): { r: number; g: number; b: number } {
  const level = clamp01(value);
  return { r: level, g: level, b: level };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function colorSpaceNamed(name: string): 'gray' | 'rgb' | 'cmyk' | 'unknown' {
  switch (name) {
    case 'DeviceGray':
    case 'CalGray':
    case 'G':
      return 'gray';
    case 'DeviceRGB':
    case 'CalRGB':
    case 'RGB':
      return 'rgb';
    case 'DeviceCMYK':
    case 'CMYK':
      return 'cmyk';
    default:
      return 'unknown';
  }
}

/**
 * Drop trailing whitespace and NUL padding. Content-stream strings are often
 * NUL-padded or newline-terminated inside a `TJ` array; those bytes are
 * spacing, not characters, and must not become part of the imported text.
 */
function trimTrailingSpace(content: string): string {
  let end = content.length;
  while (end > 0 && isSpaceOrNul(content.charCodeAt(end - 1))) end -= 1;
  return content.slice(0, end);
}

function isSpaceOrNul(code: number): boolean {
  return (
    code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c || code === 0
  );
}
