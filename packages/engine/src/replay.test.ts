/**
 * Tests for replayIr — particularly the text rendering case not covered by
 * the existing engine.test.ts (which tests the stub engine, not replayIr).
 */
import { describe, expect, it } from 'vitest';
import { replayIr } from './replay';
import { Recorder, recorder } from './replay.test-helpers';
import type { RenderItem } from './types';

describe('replayIr', () => {
  it('renders text primitive with correct font settings', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 10, 20] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'Hello',
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
    expect(rec.font).toContain('400');
    expect(rec.font).toContain('16px');
    expect(rec.font).toContain('"Inter"');
    expect(rec.textAlign).toBe('left');
    expect(rec.textBaseline).toBe('top');
    expect(rec.calls).toContain('fillText("Hello",0,0)');
    expect(rec.calls).toContain('save');
    expect(rec.calls).toContain('restore');
  });

  it('renders italic text with correct font prefix', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'Italic',
          fontSize: 20,
          fontFamily: 'Serif',
          fontWeight: 700,
          fontStyle: 'italic' as const,
          textAlign: 'center' as const,
          textAlignVertical: 'top' as const,
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
          h: 20,
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    expect(rec.font).toMatch(/^italic /);
  });

  it('renders kerning-off text as one fillText per cluster via replayIr', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'TO',
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
          textDecoration: 'none' as const,
          textOverflow: 'visible' as const,
          listStyle: 'none' as const,
          x: 0,
          y: 0,
          w: 100,
          h: 20,
          kerningMode: 'none',
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    expect(rec.calls).not.toContain('fillText("TO",0,0)');
    expect(rec.calls.some((c) => c.startsWith('fillText("T"'))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('fillText("O"'))).toBe(true);
  });

  it('keeps a likely standard ligature intact when cluster edits are present', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0] as const,
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
      primitive: {
        kind: 'text',
        text: 'office',
        fontSize: 16,
        fontFamily: 'Inter',
        fontWeight: 400,
        fontStyle: 'normal',
        textAlign: 'left',
        textAlignVertical: 'top',
        letterSpacing: 0,
        lineHeight: 1.4,
        paragraphSpacing: 0,
        textCase: 'none',
        textDecoration: 'none',
        textOverflow: 'visible',
        listStyle: 'none',
        x: 0,
        y: 0,
        w: 200,
        h: 24,
        glyphAdjustments: {
          1: { dx: 3, dy: 0, advance: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        },
      },
    };
    const rec = new Recorder();
    replayIr(rec, [item]);
    expect(rec.calls).toContain('fillText("office",0,0)');
    expect(rec.calls.some((call) => call.includes('fillText("f"'))).toBe(false);
  });

  it('keeps a likely standard ligature intact when tracking is requested', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0] as const,
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
      primitive: {
        kind: 'text',
        text: 'fi',
        fontSize: 16,
        fontFamily: 'Inter',
        fontWeight: 400,
        fontStyle: 'normal',
        textAlign: 'left',
        textAlignVertical: 'top',
        letterSpacing: 0,
        tracking: 40,
        lineHeight: 1.4,
        paragraphSpacing: 0,
        textCase: 'none',
        textDecoration: 'none',
        textOverflow: 'visible',
        listStyle: 'none',
        x: 0,
        y: 0,
        w: 100,
        h: 24,
      },
    };
    const rec = new Recorder();
    replayIr(rec, [item]);
    expect(rec.calls).toContain('fillText("fi",0,0)');
    expect(rec.calls.some((call) => call.includes('fillText("f"'))).toBe(false);
  });

  it('falls back to ordinary text when a path reference is missing', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0] as const,
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
      primitive: {
        kind: 'text',
        text: 'Detached safely',
        fontSize: 16,
        fontFamily: 'Inter',
        fontWeight: 400,
        fontStyle: 'normal',
        textAlign: 'left',
        textAlignVertical: 'top',
        letterSpacing: 0,
        lineHeight: 1.4,
        paragraphSpacing: 0,
        textCase: 'none',
        textDecoration: 'none',
        textOverflow: 'visible',
        listStyle: 'none',
        x: 0,
        y: 0,
        w: 200,
        h: 24,
        textMode: 'path',
        pathTextSettings: { pathNodeId: 'deleted-path' },
      },
    };
    const rec = new Recorder();
    replayIr(rec, [item]);
    expect(rec.calls.some((call) => call.includes('fillText("Detached safely"'))).toBe(true);
  });

  it('handles empty string text gracefully', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: '',
          fontSize: 12,
          fontFamily: 'Inter',
          fontWeight: 400,
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
          x: 0,
          y: 0,
          w: 100,
          h: 20,
        },
      },
    ];
    const rec2 = new Recorder();
    expect(() => replayIr(rec2, items)).not.toThrow();
    expect(rec2.calls).toContain('fillText("",0,0)');
  });

  it('clamps fontWeight to valid CSS range', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'test',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 9999,
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
          x: 0,
          y: 0,
          w: 100,
          h: 20,
        },
      },
    ];
    const rec3 = new Recorder();
    replayIr(rec3, items);
    // Clamped to 1000
    expect(rec3.font).toContain('1000');
  });

  it('renders a text primitive via fillText', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: {
        kind: 'text',
        x: 0,
        y: 0,
        w: 100,
        h: 20,
        text: 'Hello',
        fontSize: 14,
        fontFamily: 'sans-serif',
        fontWeight: 400,
        fontStyle: 'normal',
        textAlign: 'left',
        textAlignVertical: 'top',
        letterSpacing: 0,
        lineHeight: 1.4,
        paragraphSpacing: 0,
        textCase: 'none',
        textDecoration: 'none',
        textOverflow: 'visible',
        listStyle: 'none',
      },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('fillText(3)');
    expect(String(rec.props.font ?? '')).toContain('14px');
  });

  it('replays pre-shaped RTL glyphs in visual order without reversing source text', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: {
        kind: 'text',
        x: 0,
        y: 0,
        w: 100,
        h: 30,
        text: 'אב',
        fontSize: 16,
        fontFamily: 'Noto Sans Hebrew',
        fontWeight: 400,
        fontStyle: 'normal',
        textAlign: 'left',
        textAlignVertical: 'top',
        letterSpacing: 0,
        lineHeight: 1.2,
        paragraphSpacing: 0,
        textCase: 'none',
        textDecoration: 'none',
        textOverflow: 'visible',
        listStyle: 'none',
        direction: 'rtl',
        shaping: {
          runs: [
            {
              fontFamily: 'Noto Sans Hebrew',
              fontSize: 16,
              fontWeight: 400,
              fontStyle: 'normal',
              direction: 'rtl',
              level: 1,
              script: 'hebr',
              glyphs: [
                { glyphId: 11, xAdvance: 10, yAdvance: 0, xOffset: 0, yOffset: 0, clusterUtf16: 0 },
                { glyphId: 12, xAdvance: 11, yAdvance: 0, xOffset: 0, yOffset: 0, clusterUtf16: 1 },
              ],
              width: 21,
              ascent: 12,
              descent: 4,
            },
          ],
          width: 21,
          height: 16,
          baseDirection: 'rtl',
          direction: 'rtl',
        },
      },
    };
    const rec = new Recorder();
    replayIr(rec, [item]);
    // The logical source is kept intact so the browser's native bidi shaper
    // can preserve joining/context; it must not be painted as isolated glyphs.
    expect(rec.calls).toContain('fillText("אב",0,12)');
  });
});
