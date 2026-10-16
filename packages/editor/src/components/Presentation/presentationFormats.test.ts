import { strFromU8, unzipSync, unzlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  makePresentationPdf,
  makePresentationPngArchive,
  type PresentationRasterPage,
} from './presentationFormats';

function findBytes(bytes: Uint8Array, needle: string, start = 0): number {
  const encoded = new TextEncoder().encode(needle);
  outer: for (let index = start; index <= bytes.length - encoded.length; index++) {
    for (let offset = 0; offset < encoded.length; offset++) {
      if (bytes[index + offset] !== encoded[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function page(width: number, height: number, rgba: number[]): PresentationRasterPage {
  return { width, height, pixels: new Uint8Array(rgba) };
}

describe('presentation output encoders', () => {
  it('builds a compressed raster PDF with one mixed-size page per slide', () => {
    const output = makePresentationPdf([
      page(2, 1, [255, 0, 0, 255, 0, 255, 0, 128]),
      page(1, 2, [0, 0, 255, 255, 255, 255, 255, 0]),
    ]);
    const source = strFromU8(output);

    expect(source).toContain('%PDF-1.4');
    expect(source).toContain('/Count 2');
    expect(source).toContain('/MediaBox [ 0 0 1.5 0.75 ]');
    expect(source).toContain('/MediaBox [ 0 0 0.75 1.5 ]');
    expect(source.match(/\/Filter \/FlateDecode/g)).toHaveLength(4);
    expect(source).toContain('startxref');
    expect(source.endsWith('%%EOF\n')).toBe(true);
  });

  it('rejects empty decks and unsafe raster dimensions', () => {
    expect(() => makePresentationPdf([])).toThrow(/at least one/);
    expect(() => makePresentationPdf([page(2, 2, [0, 0, 0, 255])])).toThrow(/64 million pixel/);
  });

  it('writes an ordered PNG archive with collision-safe slide names', () => {
    const output = makePresentationPngArchive([
      { title: 'Opening / Overview', png: new Uint8Array([1, 2, 3]) },
      { title: 'Opening: Overview', png: new Uint8Array([4, 5, 6]) },
      { title: 'Conclusion', png: new Uint8Array([7, 8, 9]) },
    ]);
    const files = unzipSync(output);
    expect(Object.keys(files)).toEqual([
      '01-Opening-Overview.png',
      '02-Opening-Overview.png',
      '03-Conclusion.png',
    ]);
    expect([...files['02-Opening-Overview.png']!]).toEqual([4, 5, 6]);
  });

  it('writes zlib-compressed PDF samples that decode to the captured page pixels', () => {
    const output = makePresentationPdf([page(1, 1, [12, 34, 56, 78])]);
    const imageStart = findBytes(output, '/ColorSpace /DeviceRGB');
    const lengthStart = findBytes(output, '/Length ', imageStart) + '/Length '.length;
    const lengthEnd = findBytes(output, ' >>\nstream\n', lengthStart);
    const imageStreamLength = Number(
      new TextDecoder().decode(output.slice(lengthStart, lengthEnd)),
    );
    const streamStart = lengthEnd + ' >>\nstream\n'.length;
    const compressed = output.slice(streamStart, streamStart + imageStreamLength);
    expect([...unzlibSync(compressed)]).toEqual([12, 34, 56]);
  });
});

describe('presentation handout PDF', () => {
  const WIDE = { width: 320, height: 180 };

  function solidPage(width: number, height: number): PresentationRasterPage {
    const pixels = new Uint8Array(width * height * 4);
    for (let index = 0; index < width * height; index++) {
      pixels[index * 4] = 200;
      pixels[index * 4 + 1] = 210;
      pixels[index * 4 + 2] = 220;
      pixels[index * 4 + 3] = 255;
    }
    return { width, height, pixels };
  }

  it('imposes slides into planned slots with ruled lines and real page-number text', async () => {
    const { planPresentationHandout } = await import('@varve/scene');
    const { makePresentationHandoutPdf } = await import('./presentationFormats');
    const slides = Array.from({ length: 6 }, () => solidPage(WIDE.width, WIDE.height));
    const plan = planPresentationHandout(
      slides.map(() => ({ wPx: 1920, hPx: 1080 })),
      {
        layout: '3-up',
        paper: 'a4',
        orientation: 'portrait',
        marginPt: 36,
        gapPt: 18,
        slideNumbers: true,
        noteLines: true,
      },
    );
    expect(plan).toHaveLength(2);
    const bytes = makePresentationHandoutPdf(slides, plan, {
      slideNumbers: true,
      footerText: 'Quarterly review',
    });
    const raw = Buffer.from(bytes).toString('latin1');
    expect(raw.startsWith('%PDF-1.4')).toBe(true);
    expect(raw).toContain('/BaseFont /Helvetica');
    // Page numbers and footer are real text operators.
    expect(raw).toContain('(1) Tj');
    expect(raw).toContain('(Quarterly review) Tj');
    // Ruled note lines are vector strokes.
    expect(raw).toContain('\nS');
    // Two pages, three slides each; every slide is an RGB image plus its
    // alpha soft mask.
    expect(raw.match(/\/Type \/Page[^s]/g)).toHaveLength(2);
    expect(raw.match(/\/Subtype \/Image/g)).toHaveLength(12);
    expect(raw.match(/\/SMask /g)).toHaveLength(6);
    const bytes2 = makePresentationHandoutPdf(slides.slice(0, 3), plan.slice(0, 1), {
      slideNumbers: true,
    });
    const raw2 = Buffer.from(bytes2).toString('latin1');
    expect(raw2.match(/\/Subtype \/Image/g)).toHaveLength(6);
    expect(raw2.match(/\/SMask /g)).toHaveLength(3);
  });

  it('refuses to build a handout with no slides', async () => {
    const { planPresentationHandout } = await import('@varve/scene');
    const { makePresentationHandoutPdf } = await import('./presentationFormats');
    const plan = planPresentationHandout([], {
      layout: '1-up',
      paper: 'a4',
      orientation: 'portrait',
      marginPt: 36,
      gapPt: 18,
      slideNumbers: true,
      noteLines: false,
    });
    expect(() => makePresentationHandoutPdf([], plan, { slideNumbers: true })).toThrow(
      /at least one slide/,
    );
  });
});

describe('handout chrome text encoding', () => {
  it('maps non-WinAnsi footer text to safe byte values instead of UTF-8 mojibake', async () => {
    const { planPresentationHandout } = await import('@varve/scene');
    const { makePresentationHandoutPdf } = await import('./presentationFormats');
    const page = { width: 320, height: 180, pixels: new Uint8Array(320 * 180 * 4).fill(255) };
    const plan = planPresentationHandout([{ wPx: 1920, hPx: 1080 }], {
      layout: '1-up',
      paper: 'a4',
      orientation: 'portrait',
      marginPt: 36,
      gapPt: 18,
      slideNumbers: true,
      noteLines: false,
    });
    const bytes = makePresentationHandoutPdf([page], plan, {
      slideNumbers: true,
      footerText: '设计评审 Réunion',
    });
    const raw = Buffer.from(bytes).toString('latin1');
    // The four CJK characters become explicit '?' replacements, and no
    // multi-byte UTF-8 sequence for the first character (0xE8 0xAE 0xBE)
    // leaks into the single-byte-encoded text operator.
    expect(raw).toContain('(???? R');
    const utf8She = Buffer.from('设', 'utf8');
    let foundUtf8 = false;
    for (let index = 0; index <= bytes.length - 3; index++) {
      if (
        bytes[index] === utf8She[0] &&
        bytes[index + 1] === utf8She[1] &&
        bytes[index + 2] === utf8She[2]
      ) {
        foundUtf8 = true;
        break;
      }
    }
    expect(foundUtf8).toBe(false);
    expect(raw).toContain('Tj');
  });
});
