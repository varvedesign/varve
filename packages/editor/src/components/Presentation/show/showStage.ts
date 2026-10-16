import {
  applyRasterizationTransform,
  awaitExportsReady,
  type Engine,
  type SceneNode as EngineSceneNode,
  type ExportFontRequest,
  inheritedFontReference,
} from '@varve/engine';
import type { Document } from '@varve/scene';
import {
  type Affine,
  DEFAULT_ARTWORK_FONT_FAMILY,
  getEasingFn,
  tryInvertAffine,
} from '@varve/shared';
import { settleEngineImageResources } from '../../../export/resourceReadiness';
import { replayStructuredScene } from '../../../render/replayScene';
import { flattenSceneToEngine } from '../../../render/sceneToEngine';
import { nodeWorldTransform } from '../../../scene/world';
import type { BuildNodeOverride } from './buildEffects';
import {
  collectMorphViews,
  type MorphFrameGeometry,
  type MorphMatch,
  matchMorphNodes,
  sampleMorphPairOverride,
  unmatchedMorphOpacity,
} from './morphMatch';

/**
 * Live slide rendering for delivery.
 *
 * A slide's flattened engine scene is prepared once (fonts and image
 * resources settled), then frames are rendered synchronously with per-node
 * overrides for build effects and morph interpolation. Static phases use the
 * shared PNG capture instead; only animated phases pay the per-tick cost.
 */

export interface SlideOverridePatch extends BuildNodeOverride {
  fills?: EngineSceneNode['fills'];
}

export interface SlideRenderRequest {
  document: Document;
  frameId: string;
  overrides?: ReadonlyMap<string, SlideOverridePatch>;
  /** Node ids excluded from the render entirely (matched morph departures). */
  skipNodeIds?: ReadonlySet<string>;
  /** Fill the slide rect with the opaque slide paper before replay. */
  backdrop?: boolean;
}

function collectEngineFonts(nodes: readonly EngineSceneNode[]): ExportFontRequest[] {
  const requests: ExportFontRequest[] = [];
  for (const current of nodes) {
    if (current.kind !== 'text') continue;
    const family = current.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY;
    const weight = current.fontWeight ?? 400;
    const style = current.fontStyle === 'italic' ? 'italic' : 'normal';
    requests.push({
      family,
      weight,
      style,
      text: current.text ?? '',
      ...(current.fontReference ? { fontReference: current.fontReference } : {}),
    });
    for (const paragraph of current.richText?.paragraphs ?? []) {
      for (const run of paragraph.runs) {
        const runFamily = run.format?.fontFamily ?? family;
        const runReference = inheritedFontReference(
          family,
          current.fontReference,
          run.format?.fontFamily,
          run.format?.fontReference,
        );
        requests.push({
          family: runFamily,
          weight: run.format?.fontWeight ?? weight,
          style: run.format?.fontStyle === 'italic' ? 'italic' : style,
          text: run.text,
          ...(runReference ? { fontReference: runReference } : {}),
        });
      }
    }
  }
  return requests;
}

interface PreparedSlide {
  documentId: string;
  revision: number;
  frameId: string;
  frameW: number;
  frameH: number;
  frameWorld: Affine;
  frameInverse: Affine | null;
  ids: readonly string[];
  nodes: readonly EngineSceneNode[];
}

export class SlideLiveRenderer {
  private readonly engine: Engine;
  private readonly prepared = new Map<string, PreparedSlide>();
  private readonly pending = new Map<string, Promise<PreparedSlide>>();

  constructor(engine: Engine) {
    this.engine = engine;
  }

  /** True when the frame is prepared for this exact document revision. */
  isPrepared(frameId: string, revision: number): boolean {
    const cached = this.prepared.get(frameId);
    return cached !== undefined && cached.revision === revision;
  }

  /** Flattens and settles resources once per frame per document revision. */
  prepare(
    document: Document,
    frameId: string,
    revision: number,
    signal: AbortSignal,
  ): Promise<PreparedSlide> {
    const cached = this.prepared.get(frameId);
    if (cached && cached.revision === revision && cached.documentId === document.id) {
      return Promise.resolve(cached);
    }
    const inflight = this.pending.get(frameId);
    if (inflight) return inflight;
    const task = this.prepareInner(document, frameId, revision, signal)
      .then((prepared) => {
        this.pending.delete(frameId);
        this.prepared.set(frameId, prepared);
        return prepared;
      })
      .catch((error) => {
        this.pending.delete(frameId);
        throw error;
      });
    this.pending.set(frameId, task);
    return task;
  }

  private async prepareInner(
    document: Document,
    frameId: string,
    revision: number,
    signal: AbortSignal,
  ): Promise<PreparedSlide> {
    if (signal.aborted) throw new DOMException('Presentation render cancelled', 'AbortError');
    const frame = document.nodes[frameId];
    if (frame?.kind !== 'frame') {
      throw new Error(`Slide frame is missing or invalid: ${frameId}`);
    }
    const flattened = flattenSceneToEngine(document, [frameId]);
    await awaitExportsReady(collectEngineFonts(flattened.nodes));
    await settleEngineImageResources(flattened.nodes, { signal });
    const frameWorld = nodeWorldTransform(document, frameId) as Affine;
    return {
      documentId: document.id,
      revision,
      frameId,
      frameW: frame.w ?? 0,
      frameH: frame.h ?? 0,
      frameWorld,
      frameInverse: tryInvertAffine(frameWorld),
      ids: flattened.ids,
      nodes: flattened.nodes,
    };
  }

  /**
   * Renders one frame synchronously into the canvas. Returns false when the
   * frame is not prepared; the stage falls back to the static capture path.
   */
  async renderTo(canvas: HTMLCanvasElement, request: SlideRenderRequest): Promise<boolean> {
    const prepared = this.prepared.get(request.frameId);
    if (!prepared || prepared.documentId !== request.document.id) return false;
    const overrides = request.overrides;
    const skip = request.skipNodeIds;
    const nodes =
      !overrides && !skip
        ? prepared.nodes
        : prepared.nodes
            .filter((node) => !skip?.has(node.id))
            .map((node) => {
              const patch = overrides?.get(node.id);
              return patch ? { ...node, ...patch } : node;
            });
    const ir = await this.engine.buildIr({ nodes: [...nodes] });
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (request.backdrop) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (prepared.frameW > 0 && prepared.frameH > 0) {
      applyRasterizationTransform(
        ctx,
        { x: 0, y: 0, width: prepared.frameW, height: prepared.frameH },
        { width: canvas.width, height: canvas.height },
      );
    }
    if (prepared.frameInverse) {
      ctx.transform(...prepared.frameInverse);
      ctx.save();
      ctx.transform(...prepared.frameWorld);
      ctx.beginPath();
      ctx.rect(0, 0, prepared.frameW, prepared.frameH);
      ctx.clip();
      ctx.restore();
    }
    replayStructuredScene(ctx, {
      document: request.document,
      rootIds: [request.frameId],
      flattenedIds: prepared.ids,
      items: ir,
    });
    return true;
  }

  release(frameId: string): void {
    this.prepared.delete(frameId);
    this.pending.delete(frameId);
  }
}

export interface FittedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Contain-fit a bitmap of natural size into a stage rect, centered. */
export function fittedRect(stageW: number, stageH: number, bw: number, bh: number): FittedRect {
  if (bw <= 0 || bh <= 0 || stageW <= 0 || stageH <= 0) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const scale = Math.min(stageW / bw, stageH / bh);
  const w = bw * scale;
  const h = bh * scale;
  return { x: (stageW - w) / 2, y: (stageH - h) / 2, w, h };
}

export interface BitmapDrawOptions {
  alpha?: number;
  offsetX?: number;
  offsetY?: number;
  /** Clip in stage pixel coordinates; the bitmap draw is confined to it. */
  clip?: FittedRect;
  /**
   * Paint the opaque slide paper under the bitmap. Slide captures are
   * transparent PNGs; the audience stage shows them over paper, matching the
   * previous `<img>` presentation (same literal the delivery CSS used).
   */
  backdrop?: boolean;
}

export function drawBitmapFitted(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  naturalW: number,
  naturalH: number,
  stageW: number,
  stageH: number,
  options: BitmapDrawOptions = {},
): void {
  const rect = fittedRect(stageW, stageH, naturalW, naturalH);
  if (rect.w <= 0 || rect.h <= 0) return;
  if (options.backdrop) {
    ctx.save();
    ctx.shadowColor = 'rgb(0 0 0 / 0.28)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(rect.x + (options.offsetX ?? 0), rect.y + (options.offsetY ?? 0), rect.w, rect.h);
    ctx.restore();
  }
  ctx.save();
  if (options.alpha !== undefined) ctx.globalAlpha = Math.max(0, Math.min(1, options.alpha));
  if (options.clip) {
    ctx.beginPath();
    ctx.rect(options.clip.x, options.clip.y, options.clip.w, options.clip.h);
    ctx.clip();
  }
  ctx.drawImage(
    image,
    rect.x + (options.offsetX ?? 0),
    rect.y + (options.offsetY ?? 0),
    rect.w,
    rect.h,
  );
  ctx.restore();
}

/** Eased transition progress; authored easing is honored when parseable. */
export function transitionEase(
  easing: Parameters<typeof getEasingFn>[0] | undefined,
  linearProgress: number,
): number {
  const t = Math.max(0, Math.min(1, linearProgress));
  if (!easing) return easeInOut(t);
  try {
    return getEasingFn(easing)(t);
  } catch {
    return easeInOut(t);
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

/**
 * Computes transition draw state for the stage: where each side sits and at
 * what opacity, in stage pixel coordinates. Morph is handled separately by
 * the live renderers.
 */
export function slideTransitionOffsets(
  kind: 'fade' | 'slide' | 'push' | 'wipe' | 'none',
  direction: 'left' | 'right' | 'up' | 'down' | undefined,
  e: number,
  stageW: number,
  stageH: number,
): { fromOffset: { x: number; y: number }; toOffset: { x: number; y: number }; toAlpha: number } {
  const sign = (base: number) => (direction === 'right' || direction === 'down' ? -base : base);
  switch (kind) {
    case 'slide':
    case 'push': {
      const dx = direction === 'up' || direction === 'down' ? 0 : sign(stageW) * (1 - e);
      const dy = direction === 'up' || direction === 'down' ? sign(stageH) * (1 - e) : 0;
      return {
        fromOffset: { x: -dx, y: -dy },
        toOffset: { x: dx, y: dy },
        toAlpha: 1,
      };
    }
    case 'fade':
      return { fromOffset: { x: 0, y: 0 }, toOffset: { x: 0, y: 0 }, toAlpha: e };
    default:
      return { fromOffset: { x: 0, y: 0 }, toOffset: { x: 0, y: 0 }, toAlpha: 1 };
  }
}

/** Stage-space clip rect for a wipe arriving from the named direction. */
export function wipeClipRect(
  direction: 'left' | 'right' | 'up' | 'down' | undefined,
  e: number,
  stageW: number,
  stageH: number,
): FittedRect {
  const w = direction === 'up' || direction === 'down' ? stageW : stageW * e;
  const h = direction === 'up' || direction === 'down' ? stageH * e : stageH;
  const x = direction === 'right' ? stageW - w : 0;
  const y = direction === 'down' ? stageH - h : 0;
  return { x, y, w, h };
}

export interface MorphPlan {
  match: MorphMatch;
  fromById: Map<string, EngineSceneNode>;
  toById: Map<string, EngineSceneNode>;
  geometry: MorphFrameGeometry;
}

export function planMorphTransition(
  fromNodes: readonly EngineSceneNode[],
  toNodes: readonly EngineSceneNode[],
  fromFrameId: string,
  toFrameId: string,
  frameWorldFrom: Affine,
  frameWorldTo: Affine,
): MorphPlan {
  const viewsFrom = collectMorphViews(fromNodes, fromFrameId);
  const viewsTo = collectMorphViews(toNodes, toFrameId);
  return {
    match: matchMorphNodes(viewsFrom, viewsTo),
    fromById: new Map(fromNodes.map((node) => [node.id, node])),
    toById: new Map(toNodes.map((node) => [node.id, node])),
    geometry: { frameWorldFrom, frameWorldTo },
  };
}

export interface MorphFramePlan {
  toOverrides: Map<string, SlideOverridePatch>;
  fromOverrides: Map<string, SlideOverridePatch>;
  skipFromIds: Set<string>;
}

/**
 * Samples both slides' overrides for one morph tick. Matched objects move on
 * the incoming slide; matched departures are removed from the outgoing slide
 * so they do not ghost beneath their interpolating counterparts; unmatched
 * objects fade in place on their own slide.
 */
export function sampleMorphFrame(plan: MorphPlan, e: number): MorphFramePlan {
  const toOverrides = new Map<string, SlideOverridePatch>();
  const fromOverrides = new Map<string, SlideOverridePatch>();
  const skipFromIds = new Set<string>();
  for (const pair of plan.match.pairs) {
    skipFromIds.add(pair.fromId);
    const fromNode = plan.fromById.get(pair.fromId);
    const toNode = plan.toById.get(pair.toId);
    if (!fromNode || !toNode) continue;
    const sampled = sampleMorphPairOverride(fromNode, toNode, plan.geometry, e);
    if (sampled.transform) {
      toOverrides.set(pair.toId, { transform: sampled.transform as Affine });
    }
  }
  for (const id of plan.match.unmatchedToIds) {
    toOverrides.set(id, { opacity: unmatchedMorphOpacity('to', e) });
  }
  for (const id of plan.match.unmatchedFromIds) {
    fromOverrides.set(id, { opacity: unmatchedMorphOpacity('from', e) });
  }
  return { toOverrides, fromOverrides, skipFromIds };
}
