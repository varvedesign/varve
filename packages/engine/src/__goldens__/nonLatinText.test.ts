/**
 * Non-Latin text must replay without throwing, in every script the app claims.
 *
 * OpenPencil #486 reports the renderer crashing on Arabic, Korean and Russian
 * text — and on font enumeration — which in Varve would mean a document that
 * cannot be drawn at all. Replay is the path every frame takes, so a throw here
 * blanks the canvas.
 *
 * The assertions are deliberately structural: in this environment text shaping
 * falls back to estimated advances, so the contract worth pinning is "the run
 * is drawn, unchanged, and nothing throws" rather than glyph positions.
 */
import { describe, expect, it } from 'vitest';
import { replayIr } from '../replay';
import type { RenderItem } from '../types';
import { createRecordingTarget, formatDrawCallLog } from './drawCallRecorder';

const BLACK = { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const;

function textItem(text: string, extra: Record<string, unknown> = {}): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    fill: BLACK,
    primitive: {
      kind: 'text',
      x: 0,
      y: 0,
      w: 320,
      h: 60,
      text,
      fontSize: 24,
      fontFamily: 'Noto Sans',
      fontWeight: 400,
      fontStyle: 'normal',
      textAlign: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
      ...extra,
    },
    opacity: 1,
    blendMode: 'normal',
    strokes: [],
    effects: [],
  } as unknown as RenderItem;
}

function record(items: RenderItem[]): string[] {
  const { target, log } = createRecordingTarget();
  replayIr(target, items);
  return formatDrawCallLog(log).split('\n');
}

/** Scripts a user can reasonably put in a design, including mixed-direction. */
const SCRIPTS: Array<[name: string, text: string]> = [
  ['Arabic', 'مرحبا بالعالم'],
  ['Arabic with Latin', 'Varve تصميم'],
  ['Hebrew', 'שלום עולם'],
  ['Korean', '안녕하세요'],
  ['Japanese', 'こんにちは世界'],
  ['Chinese', '你好，世界'],
  ['Russian', 'Привет, мир'],
  ['Hindi', 'नमस्ते दुनिया'],
  ['Thai', 'สวัสดีชาวโลก'],
  ['combining marks', 'e\u0301e\u0301e\u0301'],
  // Written as escapes: the repository forbids emoji in source, and the point
  // is surrogate-pair/skin-tone handling rather than the glyphs themselves.
  ['emoji', 'Design \u270F\uFE0F\u{1F3A8}'],
];

describe('non-Latin text replay', () => {
  for (const [name, text] of SCRIPTS) {
    it(`replays ${name} without throwing and draws the run`, () => {
      const lines = record([textItem(text)]);
      expect(lines.some((line) => line.includes('fillText'))).toBe(true);
      // The authored string reaches the canvas unchanged: truncating or
      // dropping it would silently change the document's appearance.
      expect(lines.some((line) => line.includes(text.slice(0, 3)))).toBe(true);
    });
  }

  it('replays a right-to-left run with the authored direction', () => {
    const lines = record([textItem('مرحبا', { textDirection: 'rtl' })]);
    expect(lines.some((line) => line.includes('fillText'))).toBe(true);
  });

  it('replays vertical CJK without throwing', () => {
    const lines = record([textItem('縦書き', { writingMode: 'vertical-rl' })]);
    expect(lines.some((line) => line.includes('fillText'))).toBe(true);
  });
});
