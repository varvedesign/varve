/**
 * Prototype screen geometry regressions.
 *
 * The contract under test: one derivation maps scene coordinates onto the
 * frame box, and the visible raster and every active region use it. The
 * pre-repair implementation derived hotspot boxes from
 * `node.transform[4..5] + nodeLocalBounds`, which ignored ancestor transforms,
 * ignored the raster's own normalisation, and emitted a region for every
 * enumerated child.
 */

import type { Document, NodeId, SceneNode } from '@varve/scene';
import type { Affine } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import {
  framePointToScene,
  hitTestPrototypeHotspots,
  identityScreenRaster,
  interactiveNodeIds,
  resolvePrototypeHotspots,
  sceneRectToFrame,
  screenFrameMapping,
} from './screenGeometry';

const SCREEN = 'screen' as NodeId;
const CARD = 'card' as NodeId;
const CTA = 'cta' as NodeId;
const DECOR = 'bg' as NodeId;
const OVERLAY = 'sheet' as NodeId;
const OVERLAY_BTN = 'sheet-cta' as NodeId;

function t(x: number, y: number): Affine {
  return [1, 0, 0, 1, x, y];
}

function interaction(id: string, nodeId: NodeId) {
  return {
    id,
    nodeId,
    name: id,
    trigger: { kind: 'onClick' },
    actions: [{ kind: 'goBack' }],
    enabled: true,
  };
}

/** Screen frame at (100, 200); a group at (20, 30) holding a 120x44 button. */
function screenDoc(overrides: { buttonEnabled?: boolean } = {}): Document {
  const nodes: Record<NodeId, SceneNode> = {
    [SCREEN]: {
      kind: 'frame',
      id: SCREEN,
      name: 'Home',
      transform: t(100, 200),
      w: 375,
      h: 812,
      clipContent: true,
      children: [DECOR, CARD],
    } as unknown as SceneNode,
    [DECOR]: {
      kind: 'shape',
      id: DECOR,
      name: 'Background',
      transform: t(0, 0),
      opacity: 1,
      shape: { kind: 'rect', x: 0, y: 0, w: 375, h: 812 },
    } as unknown as SceneNode,
    [CARD]: {
      kind: 'group',
      id: CARD,
      name: 'Card',
      transform: t(20, 30),
      children: [CTA],
    } as unknown as SceneNode,
    [CTA]: {
      kind: 'shape',
      id: CTA,
      name: 'Continue',
      transform: t(10, 15),
      opacity: 1,
      shape: { kind: 'rect', x: 0, y: 0, w: 120, h: 44 },
    } as unknown as SceneNode,
  };
  return {
    nodes,
    rootChildren: [SCREEN],
    pages: [],
    guides: [],
    interactions: {
      [CTA]: [interaction('ix-cta', CTA)],
      ...(overrides.buttonEnabled === false ? {} : {}),
    },
  } as unknown as Document;
}

function overlayDoc(): Document {
  const doc = screenDoc();
  const nodes = doc.nodes as Record<NodeId, SceneNode>;
  nodes[OVERLAY] = {
    kind: 'frame',
    id: OVERLAY,
    name: 'Sheet',
    transform: t(0, 500),
    w: 375,
    h: 312,
    clipContent: true,
    children: [OVERLAY_BTN],
  } as unknown as SceneNode;
  nodes[OVERLAY_BTN] = {
    kind: 'shape',
    id: OVERLAY_BTN,
    name: 'Dismiss',
    transform: t(16, 16),
    opacity: 1,
    shape: { kind: 'rect', x: 0, y: 0, w: 343, h: 48 },
  } as unknown as SceneNode;
  (doc as unknown as { interactions: Record<string, unknown> }).interactions = {
    [CTA]: [interaction('ix-cta', CTA)],
    [OVERLAY_BTN]: [interaction('ix-dismiss', OVERLAY_BTN)],
  };
  (doc as unknown as { rootChildren: NodeId[] }).rootChildren = [SCREEN, OVERLAY];
  return doc;
}

const RESOLVE_ARGS = { screenId: SCREEN, frameWidth: 375, frameHeight: 812 };

describe('screenFrameMapping', () => {
  it('maps the frame rectangle onto the frame box at 1 CSS px per scene unit', () => {
    const raster = identityScreenRaster({ x: 100, y: 200, w: 375, h: 812 });
    const mapping = screenFrameMapping(375, 812, raster);
    expect(mapping.scale).toBe(1);
    expect(mapping.offsetX).toBe(0);
    expect(mapping.offsetY).toBe(0);
    expect(mapping.letterboxed).toBe(false);
  });

  it('composes the frame normalisation with the engine scale', () => {
    // A 2x raster of the same rectangle: the mapping is unchanged in effect.
    const raster = {
      sourceBounds: { x: 100, y: 200, w: 375, h: 812 },
      outputWidth: 750,
      outputHeight: 1624,
      scaleFactor: 2,
    };
    const mapping = screenFrameMapping(375, 812, raster);
    expect(mapping.scale).toBe(1);
    const rect = sceneRectToFrame(mapping, raster, { x: 130, y: 245, w: 120, h: 44 });
    expect(rect).toEqual({ x: 30, y: 45, w: 120, h: 44 });
  });

  it('letterboxes rather than distorting when the raster aspect differs', () => {
    const raster = {
      sourceBounds: { x: 0, y: 0, w: 100, h: 100 },
      outputWidth: 100,
      outputHeight: 100,
      scaleFactor: 1,
    };
    const mapping = screenFrameMapping(200, 100, raster);
    // Uniform scale of 1 keeps the square square, centred in the wide box.
    expect(mapping.scale).toBe(1);
    expect(mapping.offsetX).toBe(50);
    expect(mapping.offsetY).toBe(0);
    expect(mapping.letterboxed).toBe(true);
  });

  it('inverts to the scene point that produced a frame point', () => {
    const raster = identityScreenRaster({ x: 100, y: 200, w: 375, h: 812 });
    const mapping = screenFrameMapping(375, 812, raster);
    const scene = framePointToScene(mapping, raster, { x: 30, y: 45 });
    expect(scene).toEqual({ x: 130, y: 245 });
  });
});

describe('resolvePrototypeHotspots', () => {
  it('places a nested region using composed ancestor transforms', () => {
    const { hotspots } = resolvePrototypeHotspots({
      ...RESOLVE_ARGS,
      document: screenDoc(),
    });
    expect(hotspots).toHaveLength(1);
    expect(hotspots[0]?.nodeId).toBe(CTA);
    expect(hotspots[0]?.rect).toEqual({ x: 30, y: 45, w: 120, h: 44 });
    expect(hotspots[0]?.sceneRect).toEqual({ x: 130, y: 245, w: 120, h: 44 });
  });

  it('produces a region only for nodes carrying an enabled interaction', () => {
    const { hotspots } = resolvePrototypeHotspots({ ...RESOLVE_ARGS, document: screenDoc() });
    const ids = hotspots.map((h) => h.nodeId);
    expect(ids).not.toContain(DECOR);
    expect(ids).not.toContain(CARD);
  });

  it('ignores an interaction that is disabled', () => {
    const doc = screenDoc();
    const ix = (doc.interactions as Record<string, { enabled: boolean }[]>)[CTA];
    if (ix?.[0]) ix[0].enabled = false;
    const { hotspots } = resolvePrototypeHotspots({ ...RESOLVE_ARGS, document: doc });
    expect(hotspots).toHaveLength(0);
  });

  it('clips a region away entirely when an ancestor frame clips it out', () => {
    const doc = screenDoc();
    const nodes = doc.nodes as Record<NodeId, SceneNode>;
    // Pull the card far outside the screen; clipContent stays true.
    (nodes[CARD] as unknown as { transform: Affine }).transform = t(2000, 3000);
    const { hotspots } = resolvePrototypeHotspots({ ...RESOLVE_ARGS, document: doc });
    expect(hotspots).toHaveLength(0);
  });

  it('keeps the visible sliver of a region an overflowing ancestor lets escape', () => {
    const doc = screenDoc();
    const nodes = doc.nodes as Record<NodeId, SceneNode>;
    (nodes[SCREEN] as unknown as { clipContent: boolean }).clipContent = false;
    (nodes[CARD] as unknown as { transform: Affine }).transform = t(300, 30);
    const { hotspots } = resolvePrototypeHotspots({ ...RESOLVE_ARGS, document: doc });
    // Scene 410..530 mapped onto a 375-wide box: the surviving part is
    // 310..375, i.e. 65 CSS px wide.
    expect(hotspots).toHaveLength(1);
    expect(hotspots[0]?.rect).toEqual({ x: 310, y: 45, w: 65, h: 44 });
  });

  it('drops a region whose whole footprint sits outside the frame box', () => {
    const doc = screenDoc();
    const nodes = doc.nodes as Record<NodeId, SceneNode>;
    (nodes[SCREEN] as unknown as { clipContent: boolean }).clipContent = false;
    (nodes[CARD] as unknown as { transform: Affine }).transform = t(600, 30);
    const { hotspots } = resolvePrototypeHotspots({ ...RESOLVE_ARGS, document: doc });
    expect(hotspots).toHaveLength(0);
  });

  it('skips a fully transparent node', () => {
    const doc = screenDoc();
    const nodes = doc.nodes as Record<NodeId, SceneNode>;
    (nodes[CTA] as unknown as { opacity: number }).opacity = 0;
    const { hotspots } = resolvePrototypeHotspots({ ...RESOLVE_ARGS, document: doc });
    expect(hotspots).toHaveLength(0);
  });

  it('orders overlay regions above the screen regions, topmost overlay first', () => {
    const { hotspots } = resolvePrototypeHotspots({
      ...RESOLVE_ARGS,
      document: overlayDoc(),
      overlayStack: [OVERLAY],
    });
    expect(hotspots.map((h) => h.nodeId)).toEqual([OVERLAY_BTN, CTA]);
    expect(hotspots[0]?.layer).toBe('overlay');
    expect(hotspots[0]?.overlayId).toBe(OVERLAY);
  });

  it('prefers the later sibling when two regions overlap', () => {
    const doc = screenDoc();
    const nodes = doc.nodes as Record<NodeId, SceneNode>;
    (nodes[DECOR] as unknown as { shape: unknown }).shape = {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 300,
      h: 300,
    };
    const interactions = doc.interactions as Record<string, unknown>;
    interactions[DECOR] = [interaction('ix-bg', DECOR)];
    const { hotspots } = resolvePrototypeHotspots({ ...RESOLVE_ARGS, document: doc });
    // Background paints first, the card's button paints later: the button wins.
    expect(hotspots[0]?.nodeId).toBe(CTA);
    const hit = hitTestPrototypeHotspots(
      hotspots,
      { x: 40, y: 55 },
      screenFrameMapping(375, 812, identityScreenRaster({ x: 100, y: 200, w: 375, h: 812 })),
      identityScreenRaster({ x: 100, y: 200, w: 375, h: 812 }),
    );
    expect(hit?.nodeId).toBe(CTA);
  });
});

describe('hitTestPrototypeHotspots', () => {
  const raster = identityScreenRaster({ x: 100, y: 200, w: 375, h: 812 });
  const mapping = screenFrameMapping(375, 812, raster);

  it('resolves a point inside the region and misses outside it', () => {
    const { hotspots } = resolvePrototypeHotspots({ ...RESOLVE_ARGS, document: screenDoc() });
    expect(hitTestPrototypeHotspots(hotspots, { x: 40, y: 55 }, mapping, raster)?.nodeId).toBe(CTA);
    expect(hitTestPrototypeHotspots(hotspots, { x: 340, y: 780 }, mapping, raster)).toBeNull();
  });

  it('resolves a rotated region in the node own space, not against its world AABB', () => {
    const doc = screenDoc();
    const nodes = doc.nodes as Record<NodeId, SceneNode>;
    // A 120x44 rect rotated 90 degrees about its own origin becomes a 44x120
    // footprint. A point that lies inside the world AABB but outside the
    // rotated rect must miss.
    (nodes[CTA] as unknown as { transform: Affine }).transform = [0, 1, -1, 0, 10, 15];
    const { hotspots } = resolvePrototypeHotspots({ ...RESOLVE_ARGS, document: doc });
    expect(hotspots).toHaveLength(1);
    const hotspot = hotspots[0];
    if (!hotspot) throw new Error('expected a hotspot');
    expect(hotspot.inverseWorldTransform).not.toBeNull();

    // Scene point just outside the rotated rect but inside the AABB corner.
    const worldCorner = { x: 20 + 10 + 4, y: 30 + 15 + 4 };
    const local = framePointToScene(mapping, raster, { x: 0, y: 0 });
    expect(local).not.toBeNull();
    const framePoint = {
      x: worldCorner.x - 100,
      y: worldCorner.y - 200,
    };
    expect(hitTestPrototypeHotspots(hotspots, framePoint, mapping, raster)).toBeNull();
  });
});

describe('interactiveNodeIds', () => {
  it('collects enabled interaction ids per node', () => {
    const ids = interactiveNodeIds(screenDoc(), [CTA, DECOR]);
    expect(ids.get(CTA)).toEqual(['ix-cta']);
    expect(ids.has(DECOR)).toBe(false);
  });

  it('excludes disabled interactions', () => {
    const doc = screenDoc();
    const ix = (doc.interactions as Record<string, { enabled: boolean }[]>)[CTA];
    if (ix?.[0]) ix[0].enabled = false;
    const ids = interactiveNodeIds(doc, [CTA]);
    expect(ids.has(CTA)).toBe(false);
  });
});
