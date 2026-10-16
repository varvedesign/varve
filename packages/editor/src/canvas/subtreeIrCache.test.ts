import type {
  Effect,
  EngineFill,
  SceneNode as EngineNode,
  FilterIR,
  RenderItem,
  Shape,
  Stroke,
} from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { cacheContentParts, SubtreeIrCache } from './subtreeIrCache';

function makeStroke(overrides: Partial<Stroke> = {}): Stroke {
  return {
    color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    weight: 1,
    align: 'center',
    dashPattern: [],
    dashOffset: 0,
    cap: 'butt',
    join: 'miter',
    miterLimit: 4,
    visible: true,
    ...overrides,
  };
}

function makeNode(overrides: Partial<EngineNode> = {}): EngineNode {
  return {
    id: 'n1',
    name: 'Node',
    transform: [1, 0, 0, 1, 0, 0],
    ...overrides,
  };
}

function report(en: EngineNode): string[] {
  return cacheContentParts(en).parts;
}

function sub(en: EngineNode) {
  return cacheContentParts(en).sub;
}

describe('SubtreeIrCache', () => {
  it('returns cached item when hash matches', () => {
    const cache = new SubtreeIrCache();
    const item = {
      id: 'n1',
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
      opacity: 1,
      blendMode: 'normal' as const,
      primitive: { kind: 'rect' as const, w: 10, h: 10 },
    } as unknown as RenderItem;
    const hash = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 0, 0], '');
    cache.set('n1', hash, item);
    expect(cache.get('n1', hash)).toEqual(item);
  });

  it('misses when hash changes', () => {
    const cache = new SubtreeIrCache();
    const item = {
      id: 'n1',
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
      opacity: 1,
      blendMode: 'normal' as const,
      primitive: { kind: 'rect' as const, w: 10, h: 10 },
    } as unknown as RenderItem;
    cache.set('n1', 'hash-a', item);
    expect(cache.get('n1', 'hash-b')).toBeNull();
  });

  it('invalidates all entries', () => {
    const cache = new SubtreeIrCache();
    const item = {
      id: 'n1',
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
      opacity: 1,
      blendMode: 'normal' as const,
      primitive: { kind: 'rect' as const, w: 10, h: 10 },
    } as unknown as RenderItem;
    cache.set('n1', 'h', item);
    cache.invalidate();
    expect(cache.get('n1', 'h')).toBeNull();
  });

  describe('nodeHash', () => {
    it('is stable for identical content across separate calls', () => {
      const a = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 5, 5], 'style-a', ['rect', '10', '10']);
      const b = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 5, 5], 'style-a', ['rect', '10', '10']);
      expect(a).toBe(b);
    });

    it('changes when transform, styleKey, or content parts differ', () => {
      const base = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 0, 0], 'style-a', ['rect']);
      const movedTransform = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 9, 0], 'style-a', ['rect']);
      const differentStyle = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 0, 0], 'style-b', ['rect']);
      const differentContent = SubtreeIrCache.nodeHash('n1', [1, 0, 0, 1, 0, 0], 'style-a', [
        'ellipse',
      ]);
      expect(movedTransform).not.toBe(base);
      expect(differentStyle).not.toBe(base);
      expect(differentContent).not.toBe(base);
    });
  });

  describe('cacheContentParts — geometry coverage', () => {
    it('captures rect shape (existing)', () => {
      const en = makeNode({
        shape: { kind: 'rect', x: 10, y: 20, w: 100, h: 200 } as Shape,
      });
      const parts = report(en);
      expect(parts.some((p) => p.includes('rect'))).toBe(true);
      expect(parts.some((p) => p.includes('"x":10'))).toBe(true);
      expect(parts.some((p) => p.includes('"w":100'))).toBe(true);
    });

    it('captures ellipse geometry (cx, cy, rx, ry) — CRITICAL gap closed', () => {
      const en = makeNode({
        shape: { kind: 'ellipse', cx: 50, cy: 60, rx: 100, ry: 80 } as Shape,
      });
      const p1 = report(en);
      const en2 = makeNode({
        shape: { kind: 'ellipse', cx: 50, cy: 60, rx: 120, ry: 80 } as Shape,
      });
      const p2 = report(en2);
      expect(p1).not.toEqual(p2);
    });

    it('captures circle geometry (cx, cy, r) — CRITICAL gap closed', () => {
      const en = makeNode({
        shape: { kind: 'circle', cx: 50, cy: 60, r: 30 } as Shape,
      });
      const p1 = report(en);
      const en2 = makeNode({
        shape: { kind: 'circle', cx: 50, cy: 60, r: 45 } as Shape,
      });
      const p2 = report(en2);
      expect(p1).not.toEqual(p2);
    });

    it('captures line geometry (from, to) — CRITICAL gap closed', () => {
      const en = makeNode({
        shape: {
          kind: 'line',
          from: [0, 0] as const,
          to: [100, 100] as const,
          tolerance: 0.5,
        } as Shape,
      });
      const p1 = report(en);
      const en2 = makeNode({
        shape: {
          kind: 'line',
          from: [0, 0] as const,
          to: [200, 100] as const,
          tolerance: 0.5,
        } as Shape,
      });
      const p2 = report(en2);
      expect(p1).not.toEqual(p2);
    });

    it('captures polygon geometry (sides, radius) — CRITICAL gap closed', () => {
      const en = makeNode({
        shape: { kind: 'polygon', cx: 0, cy: 0, radius: 50, sides: 6, rotation: 0 } as Shape,
      });
      const p1 = report(en);
      const en2 = makeNode({
        shape: { kind: 'polygon', cx: 0, cy: 0, radius: 50, sides: 8, rotation: 0 } as Shape,
      });
      const p2 = report(en2);
      expect(p1).not.toEqual(p2);
    });

    it('captures star geometry (points, radii) — CRITICAL gap closed', () => {
      const en = makeNode({
        shape: {
          kind: 'star',
          cx: 0,
          cy: 0,
          innerRadius: 20,
          outerRadius: 50,
          points: 5,
          rotation: 0,
        } as Shape,
      });
      const p1 = report(en);
      const en2 = makeNode({
        shape: {
          kind: 'star',
          cx: 0,
          cy: 0,
          innerRadius: 30,
          outerRadius: 50,
          points: 5,
          rotation: 0,
        } as Shape,
      });
      const p2 = report(en2);
      expect(p1).not.toEqual(p2);
    });

    it('captures arrow geometry (from, to, arrowheadSize) — CRITICAL gap closed', () => {
      const en = makeNode({
        shape: {
          kind: 'arrow',
          from: [0, 0] as const,
          to: [100, 100] as const,
          tolerance: 0.5,
          arrowheadSize: 10,
        } as Shape,
      });
      const p1 = report(en);
      const en2 = makeNode({
        shape: {
          kind: 'arrow',
          from: [0, 0] as const,
          to: [100, 100] as const,
          tolerance: 0.5,
          arrowheadSize: 20,
        } as Shape,
      });
      const p2 = report(en2);
      expect(p1).not.toEqual(p2);
    });

    it('captures path geometry (points, closed, holes, fillRule) — CRITICAL gap closed', () => {
      const points1 = [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 100, y: 0, handleIn: null, handleOut: null },
        { x: 100, y: 100, handleIn: null, handleOut: null },
      ];
      const points2 = [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 200, y: 0, handleIn: null, handleOut: null },
        { x: 200, y: 100, handleIn: null, handleOut: null },
      ];
      const en = makeNode({
        shape: {
          kind: 'path',
          points: points1,
          closed: true,
          tolerance: 0.5,
          fillRule: 'nonzero',
        } as Shape,
      });
      const p1 = report(en);
      const en2 = makeNode({
        shape: {
          kind: 'path',
          points: points2,
          closed: true,
          tolerance: 0.5,
          fillRule: 'nonzero',
        } as Shape,
      });
      const p2 = report(en2);
      expect(p1).not.toEqual(p2);

      // Closed toggling
      const en3 = makeNode({
        shape: {
          kind: 'path',
          points: points1,
          closed: false,
          tolerance: 0.5,
          fillRule: 'nonzero',
        } as Shape,
      });
      const p3 = report(en3);
      expect(p1).not.toEqual(p3);

      // fillRule toggling
      const en4 = makeNode({
        shape: {
          kind: 'path',
          points: points1,
          closed: true,
          tolerance: 0.5,
          fillRule: 'evenodd',
        } as Shape,
      });
      const p4 = report(en4);
      expect(p1).not.toEqual(p4);
    });

    it('captures node-level w/h separately from shape w/h', () => {
      const en = makeNode({
        kind: 'text',
        text: 'Hello',
        fontSize: 16,
        w: 200,
        h: 50,
      });
      const p1 = report(en);
      const en2 = makeNode({
        kind: 'text',
        text: 'Hello',
        fontSize: 16,
        w: 300,
        h: 50,
      });
      const p2 = report(en2);
      expect(p1).not.toEqual(p2);
    });

    it('captures shapeless toggle', () => {
      const en1 = report(makeNode({ shapeless: false }));
      const en2 = report(makeNode({ shapeless: true }));
      expect(en1).not.toEqual(en2);
    });

    it('captures kind field', () => {
      const en1 = report(makeNode({ kind: 'text' }));
      const en2 = report(makeNode({ kind: 'shape' }));
      expect(en1).not.toEqual(en2);
    });

    it('captures rasterLayerData content version summary', () => {
      const en1 = report(
        makeNode({
          kind: 'rasterLayer',
          rasterLayerData: {
            width: 100,
            height: 200,
            pixelMode: false,
            tiles: { '0:0': { pixels: [0, 0, 0, 255], version: 1 } },
          },
        }),
      );
      const en2 = report(
        makeNode({
          kind: 'rasterLayer',
          rasterLayerData: {
            width: 100,
            height: 200,
            pixelMode: false,
            tiles: { '0:0': { pixels: [255, 0, 0, 255], version: 2 } },
          },
        }),
      );
      expect(en1).not.toEqual(en2);
    });
  });

  describe('cacheContentParts — stroke coverage', () => {
    it('changes when stroke weight changes (not just stroke count)', () => {
      const before = report(makeNode({ strokes: [makeStroke({ weight: 1 })] }));
      const after = report(makeNode({ strokes: [makeStroke({ weight: 5 })] }));
      expect(before).not.toEqual(after);
    });

    it('changes when stroke align/dash/cap/join change', () => {
      const base = report(makeNode({ strokes: [makeStroke()] }));
      expect(report(makeNode({ strokes: [makeStroke({ align: 'inside' })] }))).not.toEqual(base);
      expect(report(makeNode({ strokes: [makeStroke({ dashPattern: [4, 2] })] }))).not.toEqual(
        base,
      );
      expect(report(makeNode({ strokes: [makeStroke({ cap: 'round' })] }))).not.toEqual(base);
      expect(report(makeNode({ strokes: [makeStroke({ join: 'round' })] }))).not.toEqual(base);
    });

    it('changes when arrowhead style changes', () => {
      const base = report(makeNode({ strokes: [makeStroke()] }));
      expect(report(makeNode({ strokes: [makeStroke({ arrowEnd: 'arrow' })] }))).not.toEqual(base);
      expect(report(makeNode({ strokes: [makeStroke({ arrowStart: 'circle' })] }))).not.toEqual(
        base,
      );
    });
  });

  describe('cacheContentParts — fill/effect visibility', () => {
    it('changes when a fill or effect toggles visibility', () => {
      const fill: EngineFill = {
        type: 'solid',
        color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      };
      const visible = report(makeNode({ fills: [fill] }));
      const hidden = report(makeNode({ fills: [{ ...fill, visible: false }] }));
      expect(visible).not.toEqual(hidden);

      const effect: Effect = {
        type: 'layerBlur',
        radius: 4,
        visible: true,
      };
      const effectVisible = report(makeNode({ effects: [effect] }));
      const effectHidden = report(makeNode({ effects: [{ ...effect, visible: false }] }));
      expect(effectVisible).not.toEqual(effectHidden);
    });
  });

  describe('cacheContentParts — text property coverage', () => {
    it('changes when text font properties change, and distinguishes equal-length text', () => {
      const base = report(makeNode({ text: 'Hello', fontSize: 16, fontFamily: 'Inter' }));
      expect(report(makeNode({ text: 'Hello', fontSize: 24, fontFamily: 'Inter' }))).not.toEqual(
        base,
      );
      expect(report(makeNode({ text: 'Hello', fontSize: 16, fontFamily: 'Georgia' }))).not.toEqual(
        base,
      );
      expect(report(makeNode({ text: 'World', fontSize: 16, fontFamily: 'Inter' }))).not.toEqual(
        base,
      );
    });

    it('captures all text layout properties', () => {
      const base = report(makeNode({ text: 'Test', fontSize: 16 }));
      expect(report(makeNode({ text: 'Test', fontSize: 16, lineHeight: 2 }))).not.toEqual(base);
      expect(report(makeNode({ text: 'Test', fontSize: 16, letterSpacing: 2 }))).not.toEqual(base);
      expect(report(makeNode({ text: 'Test', fontSize: 16, textAlign: 'center' }))).not.toEqual(
        base,
      );
      expect(report(makeNode({ text: 'Test', fontSize: 16, textCase: 'uppercase' }))).not.toEqual(
        base,
      );
      expect(
        report(makeNode({ text: 'Test', fontSize: 16, textDecoration: 'underline' })),
      ).not.toEqual(base);
    });
  });

  describe('cacheContentParts — mask coverage', () => {
    it('changes when alphaMask is added or its length changes', () => {
      const none = report(makeNode({}));
      const maskA = report(makeNode({ alphaMask: 'data:image/png;base64,AAAA' }));
      const maskB = report(makeNode({ alphaMask: 'data:image/png;base64,AAAAAAAA' }));
      expect(maskA).not.toEqual(none);
      expect(maskA).not.toEqual(maskB);
    });
  });

  describe('SubHashReport diagnostics', () => {
    it('marks geometry sub when shape changes', () => {
      const s = sub(makeNode({ shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 } as Shape }));
      expect(s.geometry).toBe(true);
      expect(s.paint).toBe(false);
    });

    it('marks paint sub when fill changes', () => {
      const s = sub(
        makeNode({
          fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        }),
      );
      expect(s.paint).toBe(true);
    });

    it('marks text sub when text changes', () => {
      const s = sub(makeNode({ text: 'Hello', fontSize: 16 }));
      expect(s.text).toBe(true);
    });

    it('marks effects sub when filters change', () => {
      const filter: FilterIR = { kind: 'blur', radius: 4, opacity: 1, blendMode: 'normal' };
      const s = sub(makeNode({ filters: [filter] }));
      expect(s.effects).toBe(true);
    });

    it('marks image sub when src changes', () => {
      const s = sub(makeNode({ src: 'https://example.com/img.png' }));
      expect(s.image).toBe(true);
    });

    it('marks mask sub when alphaMask present', () => {
      const s = sub(makeNode({ alphaMask: 'data:image/png;base64,AAAA' }));
      expect(s.mask).toBe(true);
    });
  });

  describe('estimateItemBytes', () => {
    it('returns positive byte estimate for a RenderItem', () => {
      const item = {
        id: 'n1',
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        opacity: 1,
        blendMode: 'normal',
        primitive: { kind: 'rect', w: 100, h: 100 },
      } as unknown as RenderItem;
      const bytes = SubtreeIrCache.estimateItemBytes(item);
      expect(bytes).toBeGreaterThan(0);
      expect(Number.isFinite(bytes)).toBe(true);
    });

    it('returns fallback for non-serializable item', () => {
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;
      const bytes = SubtreeIrCache.estimateItemBytes(circular as unknown as RenderItem);
      expect(bytes).toBe(1024);
    });
  });

  describe('byte-based budgeting', () => {
    function makeItem() {
      return {
        id: 'n1',
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        opacity: 1,
        blendMode: 'normal',
        primitive: { kind: 'rect', w: 100, h: 100 },
      } as unknown as RenderItem;
    }

    it('evicts by entry count when byte budget is ample', () => {
      const cache = new SubtreeIrCache(3, 1000000);
      cache.set('n1', 'h1', makeItem());
      cache.set('n2', 'h2', makeItem());
      cache.set('n3', 'h3', makeItem());
      cache.set('n4', 'h4', makeItem());
      expect(cache.entryCount).toBe(3);
      expect(cache.currentMemoryBytes).toBeGreaterThan(0);
    });

    it('evicts by byte budget before entry count', () => {
      const cache = new SubtreeIrCache(100, 500);
      cache.set('n1', 'h1', makeItem());
      cache.set('n2', 'h2', makeItem());
      cache.set('n3', 'h3', makeItem());
      expect(cache.entryCount).toBeLessThanOrEqual(3);
      expect(cache.currentMemoryBytes).toBeLessThanOrEqual(500);
    });

    it('accounts byte replacement correctly', () => {
      const cache = new SubtreeIrCache(10, 100000);
      cache.set('n1', 'h-a', makeItem());
      const bytesAfterFirst = cache.currentMemoryBytes;
      // Replace with different item — same key, different content
      cache.set('n1', 'h-b', makeItem());
      expect(cache.currentMemoryBytes).toBe(bytesAfterFirst);
      expect(cache.entryCount).toBe(1);
    });

    it('refuses entries exceeding soft budget', () => {
      // Tiny budget so any item is oversized
      const cache = new SubtreeIrCache(10, 10);
      cache.set('n1', 'h', makeItem());
      expect(cache.entryCount).toBe(0);
      expect(cache.currentMemoryBytes).toBe(0);
      expect(cache.recentEvictions.length).toBeGreaterThanOrEqual(1);
      expect(cache.recentEvictions[0]!.reason).toBe('oversized_entry');
    });

    it('reports diagnostics correctly', () => {
      const cache = new SubtreeIrCache(5, 10000, 20000);
      cache.set('n1', 'h', makeItem());
      const diag = cache.diagnostics();
      expect(diag.entries).toBe(1);
      expect(diag.softBudget).toBe(10000);
      expect(diag.hardBudget).toBe(20000);
      expect(diag.bytes).toBeGreaterThan(0);
      expect(diag.hits).toBe(0);
      expect(diag.misses).toBe(0);
      // One hit
      cache.get('n1', 'h');
      expect(cache.hits).toBe(1);
      expect(cache.diagnostics().hitRate).toBeGreaterThan(0);
    });

    it('clears byte accounting correctly', () => {
      const cache = new SubtreeIrCache(10, 100000);
      cache.set('n1', 'h', makeItem());
      expect(cache.currentMemoryBytes).toBeGreaterThan(0);
      cache.clear();
      expect(cache.currentMemoryBytes).toBe(0);
      expect(cache.entryCount).toBe(0);
      expect(cache.hits).toBe(0);
      expect(cache.misses).toBe(0);
    });

    it('decrements bytes on single-node invalidation', () => {
      const cache = new SubtreeIrCache(10, 100000);
      cache.set('n1', 'h', makeItem());
      cache.set('n2', 'h', makeItem());
      const before = cache.currentMemoryBytes;
      cache.invalidate('n1');
      expect(cache.currentMemoryBytes).toBeLessThan(before);
      expect(cache.entryCount).toBe(1);
    });
  });

  // Regression: image src data URLs (multiple MB) must not be hashed verbatim
  // every frame. Doing so made cacheContentParts + nodeHash cost O(image bytes)
  // per redraw — ~11ms/frame for a 2MB image — even on cache hits, making an
  // image-bearing canvas sluggish on every pan/zoom/edit.
  describe('image src is fingerprinted, not hashed verbatim', () => {
    const bigSrc = (seed: string) => `data:image/png;base64,${seed.repeat(500000)}`;

    it('does not embed the full src data URL in the content parts', () => {
      const src = bigSrc('AB'); // ~1MB
      const parts = report(makeNode({ kind: 'image', src }));
      const joined = parts.join('|');
      expect(joined).not.toContain(src);
      // Fingerprint is bounded regardless of image size.
      expect(joined.length).toBeLessThan(512);
    });

    it('does not embed a full image fill src data URL either', () => {
      const src = bigSrc('CD');
      const imageFill = {
        kind: 'image',
        src,
        fit: 'fill',
        assetId: 'asset_1',
      } as unknown as EngineFill;
      const parts = report(makeNode({ kind: 'shape', fills: [imageFill] }));
      const joined = parts.join('|');
      expect(joined).not.toContain(src);
      expect(joined).toContain('asset_1'); // identity kept in the hash
      expect(joined.length).toBeLessThan(512);
    });

    it('still distinguishes different images (no false cache hits)', () => {
      const a = SubtreeIrCache.nodeHash(
        'n',
        [1, 0, 0, 1, 0, 0],
        '',
        report(makeNode({ kind: 'image', src: bigSrc('AB') })),
      );
      const b = SubtreeIrCache.nodeHash(
        'n',
        [1, 0, 0, 1, 0, 0],
        '',
        report(makeNode({ kind: 'image', src: bigSrc('CD') })),
      );
      expect(a).not.toBe(b);
    });

    it('is stable for the same image (cache hits keep working)', () => {
      const src = bigSrc('AB');
      const a = SubtreeIrCache.nodeHash(
        'n',
        [1, 0, 0, 1, 0, 0],
        '',
        report(makeNode({ kind: 'image', src })),
      );
      const b = SubtreeIrCache.nodeHash(
        'n',
        [1, 0, 0, 1, 0, 0],
        '',
        report(makeNode({ kind: 'image', src })),
      );
      expect(a).toBe(b);
    });

    it('hashes short srcs (paths/URLs) verbatim', () => {
      const src = 'https://example.com/img.png';
      const parts = report(makeNode({ kind: 'image', src }));
      expect(parts.join('|')).toContain(src);
    });
  });

  // Regression: RenderItems for image fills embed the full src data URL, so
  // estimateItemBytes must not JSON.stringify it verbatim (O(image bytes) on
  // every cache store) — yet the byte estimate must still reflect the src size
  // so LRU eviction behaviour is unchanged.
  describe('estimateItemBytes bounds cost without changing accounting', () => {
    const bigSrc = (n: number) => `data:image/png;base64,${'A'.repeat(n)}`;
    const imageItem = (n: number) =>
      ({ type: 'image', src: bigSrc(n), x: 0, y: 0, w: 100, h: 100 }) as unknown as RenderItem;

    it('estimate still scales with embedded src size (eviction accounting preserved)', () => {
      const small = SubtreeIrCache.estimateItemBytes(imageItem(1_000));
      const large = SubtreeIrCache.estimateItemBytes(imageItem(2_000_000));
      // A ~2000x larger src yields a proportionally larger estimate: the src
      // length is still counted, just not walked into the JSON output.
      expect(large).toBeGreaterThan(small * 1000);
      expect(large).toBeGreaterThan(2_000_000 * 2); // ~UTF-16 bytes of the src
    });

    it('cost is bounded: many large-image estimates stay fast', () => {
      const item = imageItem(2_000_000); // ~2MB src
      const t0 = performance.now();
      for (let i = 0; i < 200; i++) SubtreeIrCache.estimateItemBytes(item);
      const elapsed = performance.now() - t0;
      // 200 estimates of a 2MB image would be ~400MB of stringify work under the
      // naive path; bounded, it is trivial. Generous ceiling to avoid flakiness.
      expect(elapsed).toBeLessThan(500);
    });

    it('short-src items are unaffected', () => {
      const item = { type: 'rect', x: 0, y: 0, w: 10, h: 10 } as unknown as RenderItem;
      expect(SubtreeIrCache.estimateItemBytes(item)).toBeGreaterThan(0);
    });
  });

  // Ten text-shaping inputs the IR builder reads were absent from the content
  // key: `replay.ts` turns `tracking` into per-cluster advance, applies
  // `glyphAdjustments`/`pairAdjustments` to glyph positions, keys shaping off
  // `direction`/`language`, switches layout on `writingMode`/`textOrientation`,
  // selects a face through `fontReference` and wraps against `textWrapShape`.
  //
  // A node edit is invalidated by object identity before this hash is consulted
  // (`computeInvalidationPlan` compares node references), so no stale frame was
  // demonstrated. The hash is the documented defence-in-depth layer for nodes
  // that were *not* explicitly invalidated, and it could not catch drift in any
  // of these; the test pins that it now can.
  describe('text-shaping inputs are part of the content key', () => {
    const base = makeNode({ kind: 'text', text: 'Hello' });

    const changes: Array<[string, Partial<EngineNode>]> = [
      ['tracking', { tracking: 25 }],
      ['direction', { direction: 'rtl' }],
      ['language', { language: 'ar' }],
      ['kerningMode', { kerningMode: 'none' }],
      ['writingMode', { writingMode: 'vertical-rl' }],
      ['textOrientation', { textOrientation: 'upright' }],
      [
        'glyphAdjustments',
        {
          glyphAdjustments: { 1: { dx: 2, dy: 0, advance: 1, rotation: 0, scaleX: 1, scaleY: 1 } },
        },
      ],
      ['pairAdjustments', { pairAdjustments: { 0: 4 } }],
      ['textWrapShape', { textWrapShape: 'ellipse' }],
      ['fontReference', { fontReference: { artifactHash: 'a'.repeat(64) } }],
    ];

    it.each(changes)('%s changes the content hash', (_name, patch) => {
      const identity = [1, 0, 0, 1, 0, 0] as const;
      const beforeParts = report(base);
      const afterParts = report({ ...base, ...patch } as EngineNode);
      expect(afterParts.join('|')).not.toBe(beforeParts.join('|'));
      expect(SubtreeIrCache.nodeHash('n1', identity, '', afterParts)).not.toBe(
        SubtreeIrCache.nodeHash('n1', identity, '', beforeParts),
      );
    });

    it('is unchanged when a text node is hashed twice with the same content', () => {
      const identity = [1, 0, 0, 1, 0, 0] as const;
      const a = SubtreeIrCache.nodeHash('n1', identity, '', report(base));
      const b = SubtreeIrCache.nodeHash('n1', identity, '', report(base));
      expect(a).toBe(b);
    });

    it('does not mark the sub-hash buckets for non-text nodes', () => {
      const { sub } = cacheContentParts(makeNode({ kind: 'rect' }));
      expect(sub.text).toBe(false);
    });
  });

  // A raster layer's tile payloads are references to the document's immutable
  // buffers, so estimateItemBytes must neither walk them (O(raster bytes) per
  // store, and roughly 450 KB of JSON for a 64 KB tile) nor charge them to a
  // cache that does not own them. The inflation was not cosmetic: it made any
  // layer above roughly 7 MiB of pixels look like an oversized entry, so `set`
  // refused it and raster layers got no IR reuse at all while still paying the
  // whole-layer conversion on every frame.
  describe('estimateItemBytes bounds tile pixel payloads', () => {
    const TILE_PIXELS = 128 * 128 * 4;

    const rasterItem = (tileCount: number): RenderItem =>
      ({
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
        primitive: {
          kind: 'rasterLayer',
          width: 128 * tileCount,
          height: 128,
          pixelMode: false,
          tiles: Object.fromEntries(
            Array.from({ length: tileCount }, (_, i) => [
              `${i}:0`,
              { pixels: new Uint8ClampedArray(TILE_PIXELS).fill(i & 0xff), version: 1 },
            ]),
          ),
        },
      }) as unknown as RenderItem;

    it('does not scale with pixel count', () => {
      const oneBytes = SubtreeIrCache.estimateItemBytes(rasterItem(1));
      const manyBytes = SubtreeIrCache.estimateItemBytes(rasterItem(64));
      // 64 tiles cost about 64 small charges, not 64 x 65,536 x ~7 bytes of
      // JSON. Under the naive path this ratio was roughly 64x plus a 28 MB term.
      expect(manyBytes).toBeLessThan(oneBytes * 100);
      expect(manyBytes).toBeLessThan(64 * 1024);
    });

    it('cost is bounded for a large raster layer (pixels are never visited)', () => {
      const item = rasterItem(256);
      const t0 = performance.now();
      for (let i = 0; i < 200; i++) SubtreeIrCache.estimateItemBytes(item);
      const elapsed = performance.now() - t0;
      // 200 estimates over 256 tiles is ~3.3M pixel entries under the naive
      // path. Generous ceiling so a loaded machine cannot make this flaky.
      expect(elapsed).toBeLessThan(500);
    });

    it('keeps a raster layer cacheable instead of refusing it as oversized', () => {
      const softBudget = 50 * 1024 * 1024;
      const cache = new SubtreeIrCache(500, softBudget);
      // 200 tiles = 12.8 MiB of pixels, above the old ~7 MiB refusal point.
      const item = rasterItem(200);
      cache.set('raster-node', 'h1', item);
      expect(cache.get('raster-node', 'h1')).toBe(item);
      const diag = cache.diagnostics();
      expect(diag.recentEvictions.filter((e) => e.reason === 'oversized_entry')).toHaveLength(0);
      expect(diag.bytes).toBeLessThan(softBudget);
    });

    it('still counts a plain number-array payload as referenced, not owned', () => {
      const item = {
        transform: [1, 0, 0, 1, 0, 0],
        primitive: {
          kind: 'rasterLayer',
          width: 128,
          height: 128,
          pixelMode: false,
          tiles: {
            '0:0': { pixels: new Array(TILE_PIXELS).fill(7), version: 1 },
          },
        },
      } as unknown as RenderItem;
      expect(SubtreeIrCache.estimateItemBytes(item)).toBeLessThan(4 * 1024);
    });

    // Frozen-history control. This is the *previous* estimate body, kept here
    // so the reason for the change is reproducible rather than described: it
    // charges tile bytes the entry does not own, so an ordinary layer is
    // refused as `oversized_entry`, is never stored, and pays the conversion
    // plus the stringify on every single frame. If the production estimate ever
    // regresses to walking pixels, `currentMemoryBytes` assertions above fail
    // and this control shows what the numbers become.
    it('control: the previous formula refuses a 4 MiB layer the current one stores', () => {
      const softBudget = 50 * 1024 * 1024;
      const item = rasterItem(64); // 4 MiB of pixels
      let longStringChars = 0;
      const json = JSON.stringify(item, (_key, value) => {
        if (typeof value === 'string' && value.length > 256) {
          longStringChars += value.length;
          return '';
        }
        return value;
      });
      const previousBytes = (json.length + longStringChars) * 2 + 64;

      expect(previousBytes).toBeGreaterThan(softBudget);

      const cache = new SubtreeIrCache(500, softBudget);
      cache.set('raster-node', 'h1', item);
      expect(cache.get('raster-node', 'h1')).toBe(item);
    });
  });
});

describe('cacheContentParts raster layer identity', () => {
  const rasterNode = (
    tiles: Record<string, { pixels: number[]; version: number; contentId?: number }>,
  ): EngineNode =>
    makeNode({
      kind: 'rasterLayer',
      rasterLayerData: { width: 256, height: 128, pixelMode: false, tiles },
    });
  const px = (fill: number) => new Array(8).fill(fill);

  it('separates tiles that share a count and a version sum but not their pixels', () => {
    // Same tile count (2) and same version sum (3): the old summary was equal.
    const a = rasterNode({
      '0:0': { pixels: px(1), version: 1, contentId: 11 },
      '1:0': { pixels: px(2), version: 2, contentId: 12 },
    });
    const b = rasterNode({
      '0:0': { pixels: px(9), version: 2, contentId: 21 },
      '1:0': { pixels: px(8), version: 1, contentId: 22 },
    });
    expect(report(a)).not.toEqual(report(b));
  });

  it('separates two layers whose versions match but whose content identities differ', () => {
    const a = rasterNode({ '0:0': { pixels: px(1), version: 2, contentId: 31 } });
    const b = rasterNode({ '0:0': { pixels: px(5), version: 2, contentId: 32 } });
    expect(report(a)).not.toEqual(report(b));
  });

  it('is unchanged for identical tiles, so unaffected layers keep hitting the cache', () => {
    const a = rasterNode({ '0:0': { pixels: px(1), version: 2, contentId: 41 } });
    const b = rasterNode({ '0:0': { pixels: px(1), version: 2, contentId: 41 } });
    expect(report(a)).toEqual(report(b));
  });

  it('does not depend on tile key insertion order', () => {
    const a = rasterNode({
      '0:0': { pixels: px(1), version: 1, contentId: 1 },
      '1:0': { pixels: px(2), version: 2, contentId: 2 },
    });
    const b = rasterNode({
      '1:0': { pixels: px(2), version: 2, contentId: 2 },
      '0:0': { pixels: px(1), version: 1, contentId: 1 },
    });
    expect(report(a)).toEqual(report(b));
  });
});
