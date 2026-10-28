// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetImageCache } from './imageCache';
import { replayIr } from './replay';
import { recorder } from './replay-fill.test-helpers';
import type { RenderItem } from './types';

beforeEach(() => {
  resetImageCache();
});

afterEach(() => {
  resetImageCache();
});
describe('effects rendering', () => {
  it('layerBlur with radius > 32 uses software separable blur (no CSS filter set on target)', () => {
    const rec = recorder();
    // Spy on filter sets
    const filterSetValues: string[] = [];
    Object.defineProperty(rec.target, 'filter', {
      get() {
        return ((rec.props as Record<string, unknown>).filter as string) ?? 'none';
      },
      set(v: string) {
        (rec.props as Record<string, unknown>).filter = v;
        filterSetValues.push(v);
        rec.calls.push('set filter');
      },
      configurable: true,
    });
    let drawImageCount = 0;
    (rec.target as { drawImage?: (...args: unknown[]) => void }).drawImage = (
      ...args: unknown[]
    ) => {
      drawImageCount++;
      rec.calls.push(`drawImage(${args.length})`);
    };
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 100, g: 150, b: 200, a: 255 },
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      effects: [{ type: 'layerBlur', radius: 50, visible: true }],
    };
    replayIr(rec.target, [item]);
    expect(drawImageCount).toBe(1);
    // Software path should NOT set a blur CSS filter on the target.
    // The blur is applied via ImageData manipulation on the offscreen canvas
    // before drawing to the target. No 'blur(...)' string should appear.
    expect(filterSetValues.some((v) => v.includes('blur'))).toBe(false);
  });

  it('multiple effects: dropShadow + layerBlur both render', () => {
    const rec = recorder();
    (rec.target as { drawImage?: (...args: unknown[]) => void }).drawImage = (
      ...args: unknown[]
    ) => {
      rec.calls.push(`drawImage(${args.length})`);
    };
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      effects: [
        {
          type: 'dropShadow',
          x: 2,
          y: 4,
          blur: 6,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
        {
          type: 'layerBlur',
          radius: 3,
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    // Content effects render fills into an offscreen surface. The recorder
    // therefore sees the composited drawImage, not a direct target fill.
    expect(rec.calls.some((c) => c.startsWith('drawImage'))).toBe(true);
    const filterSets = rec.calls.filter((c) => c === 'set filter');
    expect(filterSets.length).toBeGreaterThanOrEqual(1);
  });

  it('effect state reset after each item', () => {
    const rec = recorder();
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        effects: [
          {
            type: 'dropShadow',
            x: 2,
            y: 4,
            blur: 8,
            spread: 0,
            color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
            opacity: 0.5,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      },
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      },
    ];
    replayIr(rec.target, items);
    expect(rec.props.shadowColor).toBe('transparent');
    expect(rec.props.shadowBlur).toBe(0);
    expect(rec.props.filter).toBe('none');
    // Each item's internal effect pass may set and unset shadowColor
    // We just verify the final state is reset
    expect(rec.props.shadowColor).toBe('transparent');
  });

  it('dropShadow with spread increases effective blur', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      effects: [
        {
          type: 'dropShadow',
          x: 0,
          y: 0,
          blur: 4,
          spread: 8,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    // Spread adds to blur: spread/2 = 4, so total blur = 4 + 4 = 8
    // Should see filter set to blur(8px) during the shadow pass
    expect(rec.calls.some((c) => c === 'set filter')).toBe(true);
  });

  it('dropShadow blendMode applied per-effect', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      effects: [
        {
          type: 'dropShadow',
          x: 0,
          y: 0,
          blur: 4,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'multiply',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    // blendMode 'multiply' should set globalCompositeOperation to 'multiply'
    const blendCalls = rec.calls.filter((c) => c.startsWith('set globalCompositeOperation'));
    expect(blendCalls.length).toBeGreaterThanOrEqual(2); // set and reset
  });

  it('two drop shadows are rendered independently', () => {
    const rec = recorder();
    rec.target.drawImage = (...args: unknown[]) => {
      rec.calls.push(`drawImage(${args.length})`);
    };
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 127, g: 127, b: 127, a: 255 },
      effects: [
        {
          type: 'dropShadow',
          x: -5,
          y: 5,
          blur: 4,
          spread: 0,
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 128 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
        {
          type: 'dropShadow',
          x: 5,
          y: -5,
          blur: 4,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 255, a: 128 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: {
        kind: 'text',
        text: 'Aa',
        fontSize: 20,
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
        w: 50,
        h: 50,
      },
    };
    replayIr(rec.target, [item]);
    // The text source forces the alpha-aware path. The target receives one
    // independent shadow-only surface per effect; text itself is painted with
    // fillText rather than drawImage.
    expect(rec.calls.filter((call) => call.startsWith('drawImage')).length).toBeGreaterThanOrEqual(
      2,
    );
    const blendCalls = rec.calls.filter((call) => call === 'set globalCompositeOperation');
    expect(blendCalls.length).toBeGreaterThanOrEqual(2);
  });
});
