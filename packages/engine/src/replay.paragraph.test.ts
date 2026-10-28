/** replayIr: lists, justification, area wrapping, ellipsis, and first-line indent. */
import { describe, expect, it } from 'vitest';
import { replayIr } from './replay';
import { Recorder } from './replay.test-helpers';
import type { RenderItem } from './types';

describe('replayIr', () => {
  it('renders bulleted list with disc prefix', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'Item 1\nItem 2',
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
          listStyle: 'disc' as const,
          x: 0,
          y: 0,
          w: 200,
          h: 60,
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    // Bullet list renders each line prefixed with •
    const fillCalls = rec.calls.filter((c) => c.startsWith('fillText'));
    expect(fillCalls.length).toBe(2);
    expect(rec.calls.some((c) => c.includes('•'))).toBe(true);
  });

  it('justifies text by distributing extra space between words', () => {
    // With a wide frame (500px) and short text "Hello World", justification
    // should render each word separately with extra spacing.
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'Hello World',
          fontSize: 16,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontStyle: 'normal' as const,
          textAlign: 'justify' as const,
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
          w: 500,
          h: 20,
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    // With justify, each word is rendered as a separate fillText call
    const fillCalls = rec.calls.filter((c) => c.startsWith('fillText'));
    expect(fillCalls.length).toBeGreaterThanOrEqual(2);
    // Words should be at different x positions (not at the same x origin)
    expect(fillCalls[0]).toContain('"Hello"');
    expect(fillCalls[1]).toContain('"World"');
  });

  it('wraps area text to its explicit container width', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: {
        kind: 'text',
        text: 'one two three four',
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
        textOverflow: 'clip',
        listStyle: 'none',
        textMode: 'area',
        x: 0,
        y: 0,
        w: 70,
        h: 100,
      },
    };
    const rec = new Recorder();
    replayIr(rec, [item]);
    const fillCalls = rec.calls.filter((call) => call.startsWith('fillText'));
    expect(fillCalls.length).toBeGreaterThan(1);
    expect(fillCalls[0]).not.toContain('one two three four');
  });

  it('keeps ellipsis text inside the area frame', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: {
        kind: 'text',
        text: 'one\ntwo\nthree',
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
        textOverflow: 'ellipsis',
        listStyle: 'none',
        textMode: 'area',
        x: 0,
        y: 0,
        w: 100,
        h: 30,
      },
    };
    const rec = new Recorder();
    replayIr(rec, [item]);
    const fillCalls = rec.calls.filter((call) => call.startsWith('fillText'));

    expect(rec.calls).toContain('clip');
    expect(fillCalls).toHaveLength(1);
    expect(fillCalls[0]).toContain('one…');
  });

  it('applies firstLineIndent to the first line only', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          text: 'First\nSecond',
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
          w: 200,
          h: 60,
          firstLineIndent: 40,
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    const fillCalls = rec.calls.filter((c) => c.startsWith('fillText'));
    // First line should be at x=40 (left + firstLineIndent), second line at x=0
    expect(fillCalls.length).toBe(2);
    // fillText format: fillText("text",x,y)
    expect(fillCalls[0]).toMatch(/fillText\("[^"]+",40,/);
    expect(fillCalls[1]).toMatch(/fillText\("[^"]+",0,/);
  });
});
