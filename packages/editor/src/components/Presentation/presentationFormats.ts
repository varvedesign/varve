import type { PresentationHandoutOptions, PresentationHandoutPage } from '@varve/scene';
import { zipSync, zlibSync } from 'fflate';

export interface PresentationRasterPage {
  width: number;
  height: number;
  pixels: Uint8Array | Uint8ClampedArray;
}

interface CompressedPage {
  width: number;
  height: number;
  rgb: Uint8Array;
  alpha: Uint8Array;
}

const MAX_COMPRESSED_PDF_BYTES = 256 * 1024 * 1024;

function validatePage(page: PresentationRasterPage): void {
  const pixels = page.width * page.height;
  if (
    !Number.isInteger(page.width) ||
    !Number.isInteger(page.height) ||
    page.width <= 0 ||
    page.height <= 0 ||
    !Number.isSafeInteger(pixels) ||
    pixels > 64_000_000 ||
    page.pixels.length !== pixels * 4
  ) {
    throw new Error('Presentation slide exceeds the 64 million pixel delivery limit');
  }
}

function buildPdf(pages: readonly CompressedPage[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let position = 0;
  const bytes = (chunk: Uint8Array) => {
    chunks.push(chunk);
    position += chunk.length;
  };
  const text = (value: string) => bytes(encoder.encode(value));
  const object = (id: number, content: string) => {
    offsets[id] = position;
    text(`${id} 0 obj\n${content}\nendobj\n`);
  };
  const stream = (id: number, dictionary: string, data: Uint8Array) => {
    offsets[id] = position;
    text(`${id} 0 obj\n<< ${dictionary} /Length ${data.length} >>\nstream\n`);
    bytes(data);
    text('\nendstream\nendobj\n');
  };

  text('%PDF-1.4\n');
  bytes(new Uint8Array([37, 128, 129, 130, 131, 10]));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const pageIds = pages.map((_, index) => 3 + index * 4);
  object(
    2,
    `<< /Type /Pages /Kids [ ${pageIds.map((id) => `${id} 0 R`).join(' ')} ] /Count ${pages.length} >>`,
  );

  for (const [index, page] of pages.entries()) {
    const pageId = pageIds[index]!;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const alphaId = pageId + 3;
    const widthPt = (page.width * 72) / 96;
    const heightPt = (page.height * 72) / 96;
    object(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${widthPt} ${heightPt} ] /Contents ${contentId} 0 R /Resources << /XObject << /Im0 ${imageId} 0 R >> >> >>`,
    );
    stream(contentId, '', encoder.encode(`q\n${widthPt} 0 0 ${heightPt} 0 0 cm\n/Im0 Do\nQ`));
    stream(
      imageId,
      `/Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask ${alphaId} 0 R`,
      page.rgb,
    );
    stream(
      alphaId,
      `/Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
      page.alpha,
    );
  }

  const xref = position;
  text(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1)) {
    text(`${String(offset).padStart(10, '0')} 00000 n \n`);
  }
  text(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const output = new Uint8Array(position);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

/**
 * Encodes pages as they arrive, retaining only compressed image streams. This
 * lets export release each decoded pixel buffer before capturing the next slide.
 */
export class PresentationPdfBuilder {
  private readonly pages: CompressedPage[] = [];
  private compressedBytes = 0;

  get pageCount(): number {
    return this.pages.length;
  }

  addPage(page: PresentationRasterPage): void {
    validatePage(page);
    const pixelCount = page.width * page.height;
    const rgb = new Uint8Array(pixelCount * 3);
    const alpha = new Uint8Array(pixelCount);
    for (let pixel = 0; pixel < pixelCount; pixel++) {
      const source = pixel * 4;
      const target = pixel * 3;
      rgb[target] = page.pixels[source]!;
      rgb[target + 1] = page.pixels[source + 1]!;
      rgb[target + 2] = page.pixels[source + 2]!;
      alpha[pixel] = page.pixels[source + 3]!;
    }
    const compressedRgb = zlibSync(rgb, { level: 6 });
    const compressedAlpha = zlibSync(alpha, { level: 6 });
    const nextByteCount = this.compressedBytes + compressedRgb.length + compressedAlpha.length;
    if (nextByteCount > MAX_COMPRESSED_PDF_BYTES) {
      throw new Error(
        'Presentation PDF exceeds the 256 MB compressed image limit. Export fewer slides.',
      );
    }
    this.compressedBytes = nextByteCount;
    this.pages.push({
      width: page.width,
      height: page.height,
      rgb: compressedRgb,
      alpha: compressedAlpha,
    });
  }

  finish(): Uint8Array {
    if (this.pages.length === 0)
      throw new Error('Add at least one included slide before exporting');
    return buildPdf(this.pages);
  }
}

/** Create a compressed, raster-only screen PDF. Each slide keeps its own page size. */
export function makePresentationPdf(pages: readonly PresentationRasterPage[]): Uint8Array {
  const builder = new PresentationPdfBuilder();
  for (const page of pages) builder.addPage(page);
  return builder.finish();
}

function safeSlideName(name: string): string {
  const clean = name
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replaceAll('\u0000', '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return clean || 'slide';
}

/** Create an ordered PNG archive; the numeric prefix preserves deck order in file browsers. */
export function makePresentationPngArchive(
  slides: readonly { title: string; png: Uint8Array }[],
): Uint8Array {
  if (slides.length === 0) throw new Error('Add at least one included slide before exporting');
  const files: Record<string, Uint8Array> = {};
  for (const [index, slide] of slides.entries()) {
    const sequence = String(index + 1).padStart(Math.max(2, String(slides.length).length), '0');
    const fileName = `${sequence}-${safeSlideName(slide.title)}.png`;
    if (files[fileName]) throw new Error(`Slide filenames are not unique: ${fileName}`);
    files[fileName] = slide.png;
  }
  return zipSync(files, { level: 6 });
}

interface CompressedSlide {
  width: number;
  height: number;
  rgb: Uint8Array;
  alpha: Uint8Array;
}

// The handout's chrome font is Helvetica under WinAnsiEncoding, which covers
// Latin-1 plus a few extras. TextEncoder emits UTF-8 bytes, which the font
// would misread for anything outside that set — so chrome text maps to
// WinAnsi byte values and marks genuinely unencodable characters instead of
// writing mojibake into the page.
const WINANSI_EXTRA = new Set([
  0x2022, 0x2020, 0x2021, 0x2026, 0x2018, 0x2019, 0x201c, 0x201d, 0x2013, 0x2014, 0x20ac,
]);

function toWinAnsiBytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0x3f;
    if (code === 0x0a || code === 0x0d) {
      bytes.push(0x20);
    } else if (code <= 0xff && (code >= 0x20 || code === 0x09)) {
      bytes.push(code);
    } else if (WINANSI_EXTRA.has(code)) {
      bytes.push(0x3f);
    } else {
      bytes.push(0x3f);
    }
  }
  return Uint8Array.from(bytes);
}

function encodePdfChromeText(value: string): string {
  let out = '';
  for (const byte of toWinAnsiBytes(value)) {
    const char = String.fromCharCode(byte);
    if (char === '\\' || char === '(' || char === ')') out += `\\${char}`;
    else out += char;
  }
  return out;
}

/**
 * Assembles a handout PDF from an imposition plan and captured slide rasters.
 *
 * Slides draw as images into their planned slots; ruled note lines are vector
 * strokes; page numbers and header/footer text use the standard Helvetica
 * base-14 font, so the handout keeps real (searchable) chrome text even
 * though slide content itself is raster. The appearance-only disclosure for
 * slide content still applies and is surfaced by the export dialog.
 */
export class PresentationHandoutPdfBuilder {
  private readonly slides: CompressedSlide[] = [];
  private compressedBytes = 0;

  get slideCount(): number {
    return this.slides.length;
  }

  addSlide(page: PresentationRasterPage): void {
    validatePage(page);
    const pixelCount = page.width * page.height;
    const rgb = new Uint8Array(pixelCount * 3);
    const alpha = new Uint8Array(pixelCount);
    for (let pixel = 0; pixel < pixelCount; pixel++) {
      const source = pixel * 4;
      const target = pixel * 3;
      rgb[target] = page.pixels[source]!;
      rgb[target + 1] = page.pixels[source + 1]!;
      rgb[target + 2] = page.pixels[source + 2]!;
      alpha[pixel] = page.pixels[source + 3]!;
    }
    const compressedRgb = zlibSync(rgb, { level: 6 });
    const compressedAlpha = zlibSync(alpha, { level: 6 });
    const next = this.compressedBytes + compressedRgb.length + compressedAlpha.length;
    if (next > MAX_COMPRESSED_PDF_BYTES) {
      throw new Error('Handout exceeds the 256 MB compressed image limit. Export fewer slides.');
    }
    this.compressedBytes = next;
    this.slides.push({
      width: page.width,
      height: page.height,
      rgb: compressedRgb,
      alpha: compressedAlpha,
    });
  }

  finish(
    pages: readonly PresentationHandoutPage[],
    options: Pick<PresentationHandoutOptions, 'slideNumbers' | 'headerText' | 'footerText'>,
  ): Uint8Array {
    if (pages.length === 0) throw new Error('Add at least one slide before exporting a handout');
    if (this.slides.length === 0)
      throw new Error('Add at least one slide before exporting a handout');
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    const offsets: number[] = [0];
    let position = 0;
    const bytes = (chunk: Uint8Array) => {
      chunks.push(chunk);
      position += chunk.length;
    };
    const text = (value: string) => bytes(encoder.encode(value));
    const object = (id: number, content: string) => {
      offsets[id] = position;
      text(`${id} 0 obj\n${content}\nendobj\n`);
    };
    const stream = (id: number, dictionary: string, data: string) => {
      const data8 = encoder.encode(data);
      offsets[id] = position;
      text(`${id} 0 obj\n<< ${dictionary} /Length ${data8.length} >>\nstream\n`);
      bytes(data8);
      text('\nendstream\nendobj\n');
    };
    const imageStream = (id: number, dictionary: string, data: Uint8Array) => {
      offsets[id] = position;
      text(`${id} 0 obj\n<< ${dictionary} /Length ${data.length} >>\nstream\n`);
      bytes(data);
      text('\nendstream\nendobj\n');
    };

    text('%PDF-1.4\n');
    bytes(new Uint8Array([37, 128, 129, 130, 131, 10]));
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    // Object layout: 3 = shared Helvetica; then per page: page, content, and
    // two objects per slide image (RGB + alpha mask).
    object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const perPageObjects = 2;
    let cursor = 4;
    const pageIds: number[] = [];
    for (const _page of pages) {
      const imageCount = _page.slots.reduce(
        (total, slot) => total + (this.slides[slot.slideIndex] ? 1 : 0),
        0,
      );
      pageIds.push(cursor);
      cursor += perPageObjects + imageCount * 2;
    }
    object(
      2,
      `<< /Type /Pages /Kids [ ${pageIds.map((id) => `${id} 0 R`).join(' ')} ] /Count ${pages.length} >>`,
    );

    let slideCursor = 4;
    for (const [pageIndex, page] of pages.entries()) {
      const pageId = pageIds[pageIndex]!;
      const contentId = pageId + 1;
      const drawParts: string[] = [];
      const resources: string[] = [];
      // Paper fill so slides never sit on a transparent page.
      drawParts.push(
        `0.956862745 0.956862745 0.956862745 rg\n0 0 ${page.widthPt} ${page.heightPt} re\nf`,
      );
      page.slots.forEach((slot, slotIndex) => {
        const slide = this.slides[slot.slideIndex];
        if (!slide) return;
        const imageId = pageId + 2 + slotIndex * 2;
        const alphaId = imageId + 1;
        resources.push(`/Im${slotIndex} ${imageId} 0 R`);
        imageStream(
          imageId,
          `/Type /XObject /Subtype /Image /Width ${slide.width} /Height ${slide.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask ${alphaId} 0 R`,
          slide.rgb,
        );
        imageStream(
          alphaId,
          `/Type /XObject /Subtype /Image /Width ${slide.width} /Height ${slide.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
          slide.alpha,
        );
        // PDF's origin is bottom-left; the planner is top-left.
        const yPdf = page.heightPt - slot.yPt - slot.hPt;
        drawParts.push(
          `q\n${slot.wPt} 0 0 ${slot.hPt} ${slot.xPt} ${yPdf} cm\n/Im${slotIndex} Do\nQ`,
        );
      });
      if (page.noteLines) {
        const lines: string[] = ['0.5 w', '0.6 0.6 0.6 RG'];
        for (let line = 0; line < page.noteLines.lineCount; line++) {
          const yPdf = page.heightPt - page.noteLines.yPt - line * page.noteLines.spacingPt;
          lines.push(
            `${page.noteLines.xPt} ${yPdf} m\n${page.noteLines.xPt + page.noteLines.wPt} ${yPdf} l\nS`,
          );
        }
        drawParts.push(lines.join('\n'));
      }
      const drawText = (value: string, xPt: number, yPt: number, size: number) => {
        drawParts.push(
          `BT\n/F1 ${size} Tf\n1 0 0 1 ${xPt} ${yPt} Tm\n(${encodePdfChromeText(value)}) Tj\nET`,
        );
      };
      if (options.headerText) {
        drawText(options.headerText, 36, page.heightPt - 24, 9);
      }
      if (options.footerText) {
        drawText(options.footerText, 36, 18, 9);
      }
      if (options.slideNumbers) {
        // Slide numbers print under each slot in deck order.
        page.slots.forEach((slot) => {
          drawText(
            String(slot.slideIndex + 1),
            slot.xPt,
            page.heightPt - slot.yPt - slot.hPt - 12,
            8,
          );
        });
      }
      object(
        pageId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${page.widthPt} ${page.heightPt} ] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> /XObject << ${resources.join(' ')} >> >> >>`,
      );
      stream(contentId, '', drawParts.join('\n'));
      slideCursor += perPageObjects;
      void slideCursor;
    }

    const xref = position;
    text(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
    for (const offset of offsets.slice(1)) {
      text(`${String(offset).padStart(10, '0')} 00000 n \n`);
    }
    text(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const output = new Uint8Array(position);
    let out = 0;
    for (const chunk of chunks) {
      output.set(chunk, out);
      out += chunk.length;
    }
    return output;
  }
}

/** One-shot handout assembly: capture slides, plan pages, then build. */
export function makePresentationHandoutPdf(
  slides: readonly PresentationRasterPage[],
  plan: readonly PresentationHandoutPage[],
  options: Pick<PresentationHandoutOptions, 'slideNumbers' | 'headerText' | 'footerText'>,
): Uint8Array {
  const builder = new PresentationHandoutPdfBuilder();
  for (const slide of slides) builder.addSlide(slide);
  return builder.finish(plan, options);
}
