// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetImageCache } from './imageCache';
import type { ReplayTarget } from './replay';
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
  it('dropShadow saves, transforms offset, sets fillStyle, draws shape', () => {
    const rec = recorder();
    const item: RenderItem = {
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
    };
    replayIr(rec.target, [item]);
    // dropShadow: save → transform(1,0,0,1,2,4) → set fillStyle → fillRect → restore
    const saves = rec.calls.filter((c) => c.startsWith('save'));
    const restores = rec.calls.filter((c) => c.startsWith('restore'));
    expect(rec.calls.some((c) => c.startsWith('set fillStyle'))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('fillRect'))).toBe(true);
    // Effects pass does one save/restore per shadow effect
    expect(saves.length).toBeGreaterThanOrEqual(2);
    expect(restores.length).toBeGreaterThanOrEqual(2);
  });

  it('layerBlur uses single offscreen pass (filter + drawImage, no double fillRect)', () => {
    const rec = recorder();
    let drawImageCount = 0;
    (rec.target as { drawImage?: (...args: unknown[]) => void }).drawImage = (
      ...args: unknown[]
    ) => {
      drawImageCount++;
      rec.calls.push(`drawImage(${args.length})`);
    };
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 128 },
      fills: [
        {
          type: 'solid',
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 128 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
      effects: [{ type: 'layerBlur', radius: 4, visible: true }],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    // Offscreen fill is not duplicated on main target — only one drawImage composite
    expect(drawImageCount).toBe(1);
    const filterCalls = rec.calls.filter((c) => c === 'set filter');
    expect(filterCalls.length).toBeGreaterThanOrEqual(1);
    // Main target should not receive a second fillRect from layerBlur
    expect(rec.calls.filter((c) => c.startsWith('fillRect')).length).toBe(0);
  });

  it('pads layer blur surfaces so the blur kernel is not cropped at object bounds', () => {
    const rec = recorder();
    let compositeArgs: unknown[] | null = null;
    rec.target.drawImage = (...args: unknown[]) => {
      compositeArgs = args;
    };
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      primitive: { kind: 'rect', x: 20, y: 30, w: 40, h: 50 },
      effects: [{ type: 'layerBlur', radius: 4, visible: true }],
    };

    replayIr(rec.target, [item]);

    expect(compositeArgs).not.toBeNull();
    expect(compositeArgs?.[1]).toBe(8);
    expect(compositeArgs?.[2]).toBe(18);
    expect(compositeArgs?.[3]).toBe(64);
    expect(compositeArgs?.[4]).toBe(74);
  });

  it('innerShadow uses source-over (not destination-over)', () => {
    const rec = recorder();
    const compositeOps: string[] = [];
    const target: ReplayTarget = {
      ...rec.target,
      drawImage: (...args: unknown[]) => {
        rec.calls.push(`drawImage(${args.length})`);
      },
      get globalCompositeOperation() {
        return (rec.props.globalCompositeOperation as string) ?? 'source-over';
      },
      set globalCompositeOperation(v: string) {
        compositeOps.push(v);
        rec.props.globalCompositeOperation = v;
        rec.calls.push('set globalCompositeOperation');
      },
    };
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
      effects: [
        {
          type: 'innerShadow',
          x: 2,
          y: 4,
          blur: 8,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          opacity: 0.8,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(target, [item]);
    expect(compositeOps).not.toContain('destination-over');
    expect(compositeOps).toContain('source-over');
  });

  it('innerShadow uses alpha-masked silhouette compositing', () => {
    const rec = recorder();
    let drawImageCalled = false;
    const target: ReplayTarget = {
      ...rec.target,
      drawImage: (...args: unknown[]) => {
        drawImageCalled = true;
        rec.calls.push(`drawImage(${args.length})`);
      },
    };
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      effects: [
        {
          type: 'innerShadow',
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
    };
    replayIr(target, [item]);
    expect(drawImageCalled).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('clip'))).toBe(false);
  });

  it('backgroundBlur captures before fill (fillRect after backdrop drawImage)', () => {
    const callOrder: string[] = [];
    const mockCanvas = { width: 200, height: 200 } as HTMLCanvasElement;

    const target: ReplayTarget = {
      ...recorder().target,
      canvas: mockCanvas,
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      drawImage: (..._args: unknown[]) => {
        callOrder.push('drawImage');
      },
      fillRect: (..._args: unknown[]) => {
        callOrder.push('fillRect');
      },
    };

    const item: RenderItem = {
      transform: [1, 0, 0, 1, 10, 10],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      effects: [{ type: 'backgroundBlur', radius: 4, visible: true }],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(target, [item]);
    const firstDrawImage = callOrder.indexOf('drawImage');
    const firstFillRect = callOrder.indexOf('fillRect');
    expect(firstDrawImage).toBeGreaterThanOrEqual(0);
    expect(firstFillRect).toBeGreaterThanOrEqual(0);
    expect(firstDrawImage).toBeLessThan(firstFillRect);
  });

  it('backgroundBlur gracefully handles unavailable OffscreenCanvas', () => {
    // In test environments where OffscreenCanvas.getContext returns null,
    // backgroundBlur should silently fall through without crashing.
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      effects: [
        {
          type: 'backgroundBlur',
          radius: 8,
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    expect(() => replayIr(rec.target, [item])).not.toThrow();
  });

  it('invisible dropShadow does not draw shadow shape', () => {
    const rec = recorder();
    const item: RenderItem = {
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
          visible: false,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    // Only the main fill's fillRect, no extra save/restore for invisible effects
    const fillRects = rec.calls.filter((c) => c.startsWith('fillRect'));
    expect(fillRects.length).toBe(1);
  });

  it('visible dropShadow renders shadow shape in its own save/restore scope', () => {
    const rec = recorder();
    const item: RenderItem = {
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
    };
    replayIr(rec.target, [item]);
    // Shadow effect adds 1 save/1 restore + the main item save/restore
    const saves = rec.calls.filter((c) => c.startsWith('save'));
    expect(saves.length).toBeGreaterThanOrEqual(2);
  });
});
