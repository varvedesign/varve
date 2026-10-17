// @vitest-environment jsdom
/**
 * Pencil stroke-quality contracts that the tool itself owns.
 *
 * `fitting.*` covers the geometry pipeline in isolation. These tests cover what
 * the *tool* hands that pipeline and what it commits through `createShapeAt`,
 * which is where a correct algorithm can still be wired up wrongly:
 *
 *   - stabilization Off must be identity, not "less smoothing";
 *   - the animation-frame sampler must not invent samples from elapsed time;
 *   - a tap must target the same parent a stroke would;
 *   - a straight light–heavy–light stroke must reach the document with its
 *     pressure profile intact.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PencilTool } from '../PencilTool';
import type { ToolContext } from '../types';

let nextPointerTime = performance.now();

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    document: { nodes: {}, rootChildren: [], name: 'Test' } as unknown as ToolContext['document'],
    selection: [],
    zoom: 1,
    pan: { x: 0, y: 0 },
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    pointerType: 'mouse',
    pointerPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    tangentialPressure: 0,
    pointerWidth: 1,
    pointerHeight: 1,
    altitudeAngle: Math.PI / 2,
    azimuthAngle: 0,
    hasCoalescedEvents: false,
    hasPredictedEvents: false,
    sourceEvents: [],
    foregroundColor: [0, 0, 0, 255] as [number, number, number, number],
    maskPreviewMode: 'none',
    setMaskPreviewMode: vi.fn(),
    snapEnabled: false,
    snapGrid: 8,
    nodeEditTargetId: null,
    createShapeAt: vi.fn(),
    createTextNodeAt: vi.fn(),
    setSelection: vi.fn(),
    toggleSelection: vi.fn(),
    isSelected: vi.fn(() => false),
    setNodePosition: vi.fn(),
    setNodePositions: vi.fn(),
    updateNodes: vi.fn(),
    setNodeSize: vi.fn(),
    updateNode: vi.fn(),
    removeSelected: vi.fn(),
    duplicateSelected: vi.fn(),
    reparentNode: vi.fn(),
    setCamera: vi.fn(),
    setPan: vi.fn(),
    setZoom: vi.fn(),
    setTool: vi.fn(),
    setNodeEditTargetId: vi.fn(),
    setNodeEditSelectedAnchors: vi.fn(),
    setTextEditTargetId: vi.fn(),
    announce: vi.fn(),
    announceSelection: vi.fn(),
    announceOperation: vi.fn(),
    setDraft: vi.fn(),
    rootNodes: vi.fn(() => []),
    getNode: vi.fn(),
    canvasToWorld: vi.fn((cx: number, cy: number) => ({ x: cx, y: cy })),
    worldToCanvas: vi.fn((wx: number, wy: number) => ({ x: wx, y: wy })),
    canvasDeltaToWorld: vi.fn((dx: number, dy: number) => ({ dx, dy })),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    findContainingFrame: vi.fn(() => null),
    setDropTargetFrame: vi.fn(),
    nodeWorldBounds: vi.fn(() => null),
    engine: null,
    hitTest: vi.fn(() => null),
    canvasElement: null,
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    abortTransaction: vi.fn(),
    snapPosition: vi.fn((b: { x: number; y: number; w: number; h: number }) => ({
      x: b.x,
      y: b.y,
      guides: [],
    })),
    createRasterLayer: vi.fn(() => null),
    touchMultiSelect: { active: false, suspended: false },
    ...overrides,
  };
}

function makePointerEvent(
  x: number,
  y: number,
  overrides: Partial<PointerEvent> = {},
): PointerEvent {
  nextPointerTime += 16;
  return {
    pointerId: 1,
    clientX: x,
    clientY: y,
    pressure: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    button: 0,
    pointerType: 'mouse',
    timeStamp: nextPointerTime,
    ...overrides,
  } as unknown as PointerEvent;
}

function committedAnchors(ctx: ToolContext): Array<{ x: number; y: number; pressure?: number }> {
  const call = vi.mocked(ctx.createShapeAt).mock.calls[0];
  return (call?.[3] ?? []) as Array<{ x: number; y: number; pressure?: number }>;
}

describe('PencilTool stabilizer', () => {
  let rafCb: FrameRequestCallback;

  beforeEach(() => {
    nextPointerTime = performance.now();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      rafCb = cb;
      return 0;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stabilization Off is an identity pass-through of the sampled position', () => {
    const tool = new PencilTool();
    tool.setStabilization(0);
    const ctx = makeCtx();

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerMove?.(makePointerEvent(200, 100), ctx);
    rafCb?.(0);
    tool.onPointerMove?.(makePointerEvent(300, 100), ctx);
    rafCb?.(0);
    tool.onPointerUp?.(makePointerEvent(300, 100), ctx);

    const anchors = committedAnchors(ctx);
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    // Off means the drawn positions are the input positions. The previous
    // mapping still ran the one-euro filter with a 11 Hz cutoff, which at a
    // 60 Hz sample rate kept only ~54 % of each new sample.
    expect(anchors[0]?.x).toBeCloseTo(100, 6);
    expect(anchors[anchors.length - 1]?.x).toBeCloseTo(300, 6);
  });

  it('ends a smoothed stroke under the released pointer instead of short of it', () => {
    const run = (strength: number) => {
      const tool = new PencilTool();
      tool.setStabilization(strength);
      const ctx = makeCtx();
      tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
      for (let x = 140; x <= 340; x += 40) {
        tool.onPointerMove?.(makePointerEvent(x, 100), ctx);
        rafCb?.(0);
      }
      tool.onPointerUp?.(makePointerEvent(340, 100), ctx);
      const anchors = committedAnchors(ctx);
      return { anchors, last: anchors[anchors.length - 1]?.x ?? Number.NaN };
    };

    // A lag filter's output always trails the pointer. Committing the lagged
    // sample on release shortened every smoothed stroke: a 240 px drag at full
    // strength ended ~12 px before the pen actually left the surface.
    for (const strength of [0, 0.3, 1]) {
      const { last } = run(strength);
      expect(Math.abs(340 - last)).toBeLessThan(0.001);
    }
  });

  it('keeps the interior of the path at the drawn positions when Off', () => {
    const tool = new PencilTool();
    tool.setStabilization(0);
    const ctx = makeCtx();

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    for (const x of [140, 180, 220, 260]) {
      tool.onPointerMove?.(makePointerEvent(x, 100), ctx);
      rafCb?.(0);
    }
    tool.onPointerUp?.(makePointerEvent(260, 100), ctx);

    const anchors = committedAnchors(ctx);
    expect(anchors[0]?.x).toBeCloseTo(100, 6);
    expect(anchors[anchors.length - 1]?.x).toBeCloseTo(260, 6);
    // Nothing in the committed path may sit outside the drawn span.
    for (const anchor of anchors) {
      expect(anchor.x).toBeGreaterThanOrEqual(100 - 1e-9);
      expect(anchor.x).toBeLessThanOrEqual(260 + 1e-9);
    }
  });

  it('does not invent samples from animation frames while the pointer is still', () => {
    const collect = (frames: number) => {
      const tool = new PencilTool();
      const ctx = makeCtx();
      tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
      tool.onPointerMove?.(makePointerEvent(200, 100), ctx);
      for (let i = 0; i < frames; i++) rafCb?.(0);
      tool.onPointerUp?.(makePointerEvent(200, 100), ctx);
      const anchors = committedAnchors(ctx);
      return { count: anchors.length, last: anchors[anchors.length - 1] };
    };

    // Frame count is a rendering property, not an input property. Re-sampling
    // an unchanged position let the stabilizer drift on elapsed time alone and
    // deposit a nibble the user never drew.
    const few = collect(1);
    const many = collect(60);
    expect(many.count).toBe(few.count);
    expect(many.last?.x).toBeCloseTo(few.last?.x ?? Number.NaN, 9);
  });
});

describe('PencilTool commit contracts', () => {
  let rafCb: FrameRequestCallback;

  beforeEach(() => {
    nextPointerTime = performance.now();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      rafCb = cb;
      return 0;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes a tap to the same containing frame a stroke would use', () => {
    const tool = new PencilTool();
    const ctx = makeCtx({ findContainingFrame: vi.fn(() => 'frame-7') });

    tool.onPointerDown?.(makePointerEvent(150, 150), ctx);
    tool.onPointerUp?.(makePointerEvent(150, 150), ctx);

    const call = vi.mocked(ctx.createShapeAt).mock.calls[0];
    expect(call?.[2]).toBe('frame-7');
  });

  it('keeps the pressure profile of a straight light-heavy-light stroke', () => {
    const tool = new PencilTool();
    const ctx = makeCtx({ pointerType: 'pen', pressureEnabled: true, pressureCurve: 1 });

    // Perfectly collinear along y = 0, so geometry alone has nothing to keep.
    const pressures = [0.1, 0.25, 0.45, 0.7, 0.9, 0.7, 0.45, 0.25, 0.1];
    tool.onPointerDown?.(
      makePointerEvent(0, 0, { pointerType: 'pen', pressure: pressures[0]! }),
      ctx,
    );
    for (let i = 1; i < pressures.length; i++) {
      tool.onPointerMove?.(
        makePointerEvent(i * 20, 0, { pointerType: 'pen', pressure: pressures[i]! }),
        ctx,
      );
      rafCb?.(0);
    }
    tool.onPointerUp?.(
      makePointerEvent((pressures.length - 1) * 20, 0, {
        pointerType: 'pen',
        pressure: pressures[pressures.length - 1]!,
      }),
      ctx,
    );

    const anchors = committedAnchors(ctx);
    const values = anchors.map((a) => a.pressure ?? 0);
    expect(anchors.length).toBeGreaterThan(2);
    expect(Math.max(...values)).toBeGreaterThan(0.8);
    expect(values[0]).toBeLessThan(0.2);
    expect(values[values.length - 1]).toBeLessThan(0.2);
  });

  it('maps a constant-pressure click-drag onto the nominal width, not a mid value', () => {
    const tool = new PencilTool();
    const ctx = makeCtx({ pointerType: 'pen', pressureEnabled: false });

    tool.onPointerDown?.(makePointerEvent(0, 0, { pointerType: 'pen', pressure: 0.1 }), ctx);
    tool.onPointerMove?.(makePointerEvent(60, 0, { pointerType: 'pen', pressure: 0.1 }), ctx);
    rafCb?.(0);
    tool.onPointerUp?.(makePointerEvent(60, 0, { pointerType: 'pen', pressure: 0.1 }), ctx);

    const anchors = committedAnchors(ctx);
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    for (const anchor of anchors) expect(anchor.pressure).toBe(0.5);
  });
});
