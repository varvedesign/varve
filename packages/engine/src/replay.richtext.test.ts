/** replayIr: rich-text span formatting, measurement, and paragraph flow. */
import { describe, expect, it } from 'vitest';
import { replayIr } from './replay';
import { MeasuredRecorder, Recorder } from './replay.test-helpers';
import type { RenderItem } from './types';

describe('replayIr', () => {
  it('renders rich text with per-run formatting', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        primitive: {
          kind: 'text',
          x: 0,
          y: 0,
          w: 200,
          h: 100,
          text: 'Hello World',
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
          richText: {
            paragraphs: [
              {
                runs: [
                  { text: 'Hello', format: { fontWeight: 400 } },
                  { text: ' World', format: { fontWeight: 700, fontSize: 20 } },
                ],
              },
            ],
          },
        },
      },
    ];
    const rec = new Recorder();
    replayIr(rec, items);
    const fillTextCalls = rec.calls.filter((c) => c.startsWith('fillText('));
    expect(fillTextCalls.some((c) => c.includes('Hello'))).toBe(true);
    expect(fillTextCalls.some((c) => c.includes('World'))).toBe(true);
  });

  it('uses the canonical snapshot for measured rich spans', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: {
        kind: 'text',
        x: 0,
        y: 0,
        w: 200,
        h: 40,
        text: 'AB',
        fontSize: 16,
        fontFamily: 'Inter',
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
        richText: {
          paragraphs: [
            {
              runs: [
                { text: 'A', format: { fontFamily: 'Inter', fontSize: 12, fontWeight: 400 } },
                { text: 'B', format: { fontFamily: 'Inter', fontSize: 24, fontWeight: 700 } },
              ],
            },
          ],
        },
      },
    };
    const rec = new MeasuredRecorder();
    replayIr(rec, [item]);
    expect(rec.calls).toContain('fillText("A",0,19.200000000000003)');
    expect(rec.calls).toContain('fillText("B",10,19.200000000000003)');
    expect(rec.calls).not.toContain('fillText("AB",0,0)');
  });

  it('does not wrap rich point text at its content width', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: {
        kind: 'text',
        x: 0,
        y: 0,
        // Smaller than the source on purpose. Point text must ignore this as
        // a wrapping constraint; it is a content-grown selection width.
        w: 10,
        h: 100,
        text: 'ABCD',
        fontSize: 16,
        fontFamily: 'Inter',
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
        textMode: 'point',
        richText: { paragraphs: [{ runs: [{ text: 'ABCD' }] }] },
      },
    };

    const rec = new MeasuredRecorder();
    replayIr(rec, [item]);
    const textCalls = rec.calls.filter((call) => call.startsWith('fillText('));
    // A whole source run is intentionally painted in one call. Splitting it
    // into four character calls would disable ligatures and contextual forms.
    expect(textCalls).toHaveLength(1);
    expect(textCalls[0]).toContain('"ABCD"');

    // The browser-less fallback uses the same no-wrap sentinel. A point
    // paragraph containing breakable words must stay one line there too.
    const fallbackItem: RenderItem = {
      ...item,
      primitive: {
        ...(item.primitive as Extract<RenderItem['primitive'], { kind: 'text' }>),
        text: 'A B C D',
        richText: { paragraphs: [{ runs: [{ text: 'A B C D' }] }] },
      },
    };
    const fallback = new Recorder();
    replayIr(fallback, [fallbackItem]);
    const fallbackTextCalls = fallback.calls.filter((call) => call.startsWith('fillText('));
    expect(fallbackTextCalls.length).toBeGreaterThan(1);
    expect(new Set(fallbackTextCalls.map((call) => call.split(',').at(-1))).size).toBe(1);
  });

  it('keeps rich paragraph spacing in the painted line positions', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: {
        kind: 'text',
        x: 0,
        y: 0,
        w: 200,
        h: 100,
        text: 'A\nB',
        fontSize: 16,
        fontFamily: 'Inter',
        fontWeight: 400,
        fontStyle: 'normal',
        textAlign: 'left',
        textAlignVertical: 'top',
        letterSpacing: 0,
        lineHeight: 1.2,
        paragraphSpacing: 12,
        textCase: 'none',
        textDecoration: 'none',
        textOverflow: 'visible',
        listStyle: 'none',
        textMode: 'area',
        richText: {
          paragraphs: [{ runs: [{ text: 'A' }] }, { runs: [{ text: 'B' }] }],
        },
      },
    };
    const rec = new MeasuredRecorder();
    replayIr(rec, [item]);
    const yPositions = rec.calls
      .filter((call) => call.startsWith('fillText('))
      .map((call) => Number(call.slice(0, -1).split(',').at(-1)));
    expect(yPositions).toHaveLength(2);
    expect(yPositions[1]! - yPositions[0]!).toBeCloseTo(16 * 1.2 + 12);
  });

  it('uses the tallest rich run line height for the next paragraph', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: {
        kind: 'text',
        x: 0,
        y: 0,
        w: 200,
        h: 100,
        text: 'A\nB',
        fontSize: 16,
        fontFamily: 'Inter',
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
        textMode: 'area',
        richText: {
          paragraphs: [
            { runs: [{ text: 'A', format: { fontSize: 24, lineHeight: 2 } }] },
            { runs: [{ text: 'B' }] },
          ],
        },
      },
    };
    const rec = new MeasuredRecorder();
    replayIr(rec, [item]);
    const yPositions = rec.calls
      .filter((call) => call.startsWith('fillText('))
      .map((call) => Number(call.slice(0, -1).split(',').at(-1)));
    expect(yPositions).toHaveLength(2);
    // The second baseline must move past the first line's 48px line box. The
    // exact baseline delta also includes the two runs' different ascents.
    expect(yPositions[1]! - yPositions[0]!).toBeGreaterThan(32);
  });
});
