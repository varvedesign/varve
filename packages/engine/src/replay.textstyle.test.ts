/** replayIr: text case, baseline, decoration, glyph strokes, and vertical clusters. */
import { describe, expect, it } from 'vitest';
import { replayIr } from './replay';
import { MeasuredRecorder, Recorder } from './replay.test-helpers';
import type { RenderItem } from './types';

describe('replayIr', () => {
  // ── Phase C: Renderer Completion Tests ─────────────────────────────────

  it('renders uppercase textCase via transformed text', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'hello',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal' as const,
          textAlign: 'left' as const,
          textAlignVertical: 'top' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'uppercase' as const,
          textDecoration: 'none' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          x: 0,
          y: 0,
          w: 100,
          h: 20,
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    expect(rec.calls).toContain('fillText("HELLO",0,0)');
  });

  it('sets textBaseline from textAlignVertical', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'Test',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal' as const,
          textAlign: 'center' as const,
          textAlignVertical: 'middle' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'none' as const,
          textDecoration: 'none' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          x: 0,
          y: 0,
          w: 100,
          h: 40,
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    expect(rec.textBaseline).toBe('middle');
  });

  it('renders underline decoration', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'Underlined',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal' as const,
          textAlign: 'left' as const,
          textAlignVertical: 'top' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'none' as const,
          textDecoration: 'underline' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          x: 0,
          y: 0,
          w: 100,
          h: 20,
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    // Underline draws a line: moveTo + lineTo + stroke
    expect(rec.calls.some((c) => c.startsWith('moveTo'))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('lineTo'))).toBe(true);
    expect(rec.calls.some((c) => c === 'stroke')).toBe(true);
  });

  it('renders editable text strokes through glyph outlines instead of the text box', () => {
    const rec = new Recorder();
    replayIr(rec, [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        strokes: [
          {
            color: { space: 'rgb', r: 0, g: 120, b: 255, a: 255 } as const,
            weight: 2,
            align: 'center' as const,
            dashPattern: [],
            dashOffset: 0,
            cap: 'round' as const,
            join: 'round' as const,
            miterLimit: 4,
            visible: true,
          },
        ],
        primitive: {
          kind: 'text',
          text: 'Outlined',
          fontSize: 18,
          fontFamily: 'Inter',
          fontWeight: 500,
          fontStyle: 'normal' as const,
          textAlign: 'left' as const,
          textAlignVertical: 'top' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'none' as const,
          textDecoration: 'none' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          x: 12,
          y: 8,
          w: 180,
          h: 30,
        },
      },
    ]);
    expect(rec.calls.some((call) => call.startsWith('strokeText("Outlined"'))).toBe(true);
    expect(rec.calls.some((call) => call.startsWith('rect('))).toBe(false);
  });

  it('strokes vertical text at canonical cluster positions and orientations', () => {
    const rec = new MeasuredRecorder();
    replayIr(rec, [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        strokes: [
          {
            color: { space: 'rgb', r: 0, g: 120, b: 255, a: 255 } as const,
            weight: 2,
            align: 'center' as const,
            dashPattern: [],
            dashOffset: 0,
            cap: 'round' as const,
            join: 'round' as const,
            miterLimit: 4,
            visible: true,
          },
        ],
        primitive: {
          kind: 'text',
          text: 'Aあ',
          fontSize: 18,
          fontFamily: 'Inter',
          fontWeight: 500,
          fontStyle: 'normal' as const,
          textAlign: 'left' as const,
          textAlignVertical: 'top' as const,
          writingMode: 'vertical-rl' as const,
          textOrientation: 'mixed' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'none' as const,
          textDecoration: 'none' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          x: 12,
          y: 8,
          w: 80,
          h: 80,
        },
      },
    ]);
    expect(rec.calls.filter((call) => call.startsWith('strokeText'))).toHaveLength(2);
    expect(rec.calls.filter((call) => call.startsWith('rotate('))).toHaveLength(2);
    expect(rec.calls.some((call) => call === 'strokeText("A",0,0)')).toBe(true);
    expect(rec.calls.some((call) => call === 'strokeText("あ",0,0)')).toBe(true);
  });

  it('paints consecutive sideways clusters as one coalesced rotated run', () => {
    const rec = new MeasuredRecorder();
    replayIr(rec, [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        strokes: [],
        primitive: {
          kind: 'text',
          text: 'AB',
          fontSize: 18,
          fontFamily: 'Inter',
          fontWeight: 500,
          fontStyle: 'normal' as const,
          textAlign: 'left' as const,
          textAlignVertical: 'top' as const,
          writingMode: 'vertical-rl' as const,
          textOrientation: 'mixed' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'none' as const,
          textDecoration: 'none' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          x: 12,
          y: 8,
          w: 80,
          h: 80,
        },
      },
    ]);
    // One rotated draw for the whole sideways run — kerning survives — and
    // no per-cluster split draws.
    expect(rec.calls.some((call) => call === 'fillText("AB",0,0)')).toBe(true);
    expect(rec.calls.some((call) => call === 'fillText("A",0,0)')).toBe(false);
    expect(rec.calls.some((call) => call === 'fillText("B",0,0)')).toBe(false);
    expect(rec.calls.filter((call) => call.startsWith('rotate('))).toHaveLength(1);
    expect(rec.calls.filter((call) => call.startsWith('scale('))).toHaveLength(0);
  });

  it('paints upright clusters individually between sideways runs', () => {
    const rec = new MeasuredRecorder();
    replayIr(rec, [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        strokes: [],
        primitive: {
          kind: 'text',
          text: 'AあB',
          fontSize: 18,
          fontFamily: 'Inter',
          fontWeight: 500,
          fontStyle: 'normal' as const,
          textAlign: 'left' as const,
          textAlignVertical: 'top' as const,
          writingMode: 'vertical-rl' as const,
          textOrientation: 'mixed' as const,
          letterSpacing: 0,
          lineHeight: 1.4,
          paragraphSpacing: 0,
          textCase: 'none' as const,
          textDecoration: 'none' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          x: 12,
          y: 8,
          w: 80,
          h: 80,
        },
      },
    ]);
    // The upright あ splits the sideways run: A and B paint separately, あ
    // paints unrotated in its own cell.
    expect(rec.calls.some((call) => call === 'fillText("A",0,0)')).toBe(true);
    expect(rec.calls.some((call) => call === 'fillText("B",0,0)')).toBe(true);
    expect(rec.calls.some((call) => call === 'fillText("あ",0,0)')).toBe(true);
    expect(rec.calls.filter((call) => call.startsWith('rotate('))).toHaveLength(2);
  });
});
