import type {
  PresentationTransition,
  ResolvedPresentationSlide,
  Document as SceneDocument,
} from '@varve/scene';
import { useEffect, useRef } from 'react';
import { patchTextForHiddenParagraphs, sampleBuildOverrides } from './show/buildEffects';
import {
  drawBitmapFitted,
  type MorphPlan,
  planMorphTransition,
  type SlideLiveRenderer,
  type SlideOverridePatch,
  type SlideRenderRequest,
  sampleMorphFrame,
  slideTransitionOffsets,
  transitionEase,
  wipeClipRect,
} from './show/showStage';
import type { ShowDirector } from './show/showTiming';

/**
 * Audience stage.
 *
 * A single canvas that draws the deterministic show state each tick: static
 * phases draw the shared PNG capture; transitions composite two captures;
 * morph and build phases render live through the engine with per-node
 * overrides. The canvas itself stays transparent so the theme owns the
 * letterbox color.
 */

export interface StageBitmap {
  image: CanvasImageSource;
  width: number;
  height: number;
  /** Object URL of the static capture, for pixel-parity inspection. */
  src?: string;
}

export interface PresentationStageProps {
  document: SceneDocument;
  revision: number;
  slides: ResolvedPresentationSlide[];
  transitions: readonly PresentationTransition[];
  director: ShowDirector;
  /** Monotonic show clock in ms; pauses subtract from it. */
  clock: { now(): number };
  /** Null until the engine resolves; the stage then shows static captures. */
  renderer: SlideLiveRenderer | null;
  bitmaps: ReadonlyMap<string, StageBitmap>;
  /** Bumped whenever the bitmap map gains entries; restarts the draw loop. */
  bitmapsVersion: number;
  reducedMotion: boolean;
}

const MAX_LIVE_EDGE = 1920;

export function PresentationStage({
  document,
  revision,
  slides,
  transitions,
  director,
  clock,
  renderer,
  bitmaps,
  bitmapsVersion,
  reducedMotion,
}: PresentationStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratchARef = useRef<HTMLCanvasElement | null>(null);
  const scratchBRef = useRef<HTMLCanvasElement | null>(null);
  const morphPlanRef = useRef<{ key: string; plan: MorphPlan | null } | null>(null);
  const lastKeyRef = useRef('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || slides.length === 0) return;
    let cancelled = false;
    let busy = false;
    let raf = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(parent.clientWidth * dpr));
      const h = Math.max(1, Math.round(parent.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    const scratchFor = (slot: 'a' | 'b', w: number, h: number): HTMLCanvasElement | null => {
      const ref = slot === 'a' ? scratchARef.current : scratchBRef.current;
      if (!ref) return null;
      const scale = Math.min(1, MAX_LIVE_EDGE / Math.max(w, h, 1));
      const pw = Math.max(1, Math.round(w * scale));
      const ph = Math.max(1, Math.round(h * scale));
      if (ref.width !== pw || ref.height !== ph) {
        ref.width = pw;
        ref.height = ph;
      }
      return ref;
    };

    const drawStatic = (index: number, alpha = 1) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const slide = slides[index];
      const bitmap = slide ? bitmaps.get(slide.entry.id) : undefined;
      if (alpha >= 1) {
        canvas.dataset.presentationCaptureSrc = bitmap?.src ?? '';
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      if (bitmap) {
        drawBitmapFitted(
          ctx,
          bitmap.image,
          bitmap.width,
          bitmap.height,
          canvas.width,
          canvas.height,
          { backdrop: alpha >= 1 },
        );
      }
      ctx.restore();
    };

    const renderLive = async (
      request: SlideRenderRequest,
      scratch: HTMLCanvasElement | null,
    ): Promise<boolean> => {
      if (!scratch || !renderer) return false;
      return renderer.renderTo(scratch, request);
    };

    const tick = () => {
      if (cancelled) return;
      resize();
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const now = clock.now();
      const sample = director.sample(now);
      const slide = slides[sample.slideIndex];
      const nextSlide = slides[sample.slideIndex + 1];
      const transition = sample.transition;
      const anyActiveBuild = sample.builds.some((build) => build.state === 'active');
      const hasPendingBuilds = sample.builds.some((build) => build.state === 'pending');
      const stabilityKey = reducedMotion
        ? `rm:${sample.slideIndex}:${sample.phase}:${sample.startedGroups}`
        : `${sample.slideIndex}:${sample.phase}:${sample.startedGroups}:${anyActiveBuild ? 'a' : 's'}:${
            transition ? Math.round(transition.progress * 500) : 'x'
          }:${Math.round((sample.builds.find((b) => b.state === 'active')?.progress ?? 0) * 500)}`;

      if (transition && slide && nextSlide) {
        const e = transitionEase(transitions[sample.slideIndex]?.easing, transition.progress);
        const toBitmap = bitmaps.get(nextSlide.entry.id);
        const fromBitmap = bitmaps.get(slide.entry.id);
        const paint = () => {
          canvas.dataset.presentationCaptureSrc = '';
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          switch (transition.kind) {
            case 'fade': {
              drawStatic(sample.slideIndex);
              drawStatic(sample.slideIndex + 1, e);
              break;
            }
            case 'slide':
            case 'push': {
              const offsets = slideTransitionOffsets(
                transition.kind,
                transition.direction,
                e,
                canvas.width,
                canvas.height,
              );
              if (fromBitmap) {
                drawBitmapFitted(
                  ctx,
                  fromBitmap.image,
                  fromBitmap.width,
                  fromBitmap.height,
                  canvas.width,
                  canvas.height,
                  { offsetX: offsets.fromOffset.x, offsetY: offsets.fromOffset.y, backdrop: true },
                );
              }
              if (toBitmap) {
                drawBitmapFitted(
                  ctx,
                  toBitmap.image,
                  toBitmap.width,
                  toBitmap.height,
                  canvas.width,
                  canvas.height,
                  { offsetX: offsets.toOffset.x, offsetY: offsets.toOffset.y, backdrop: true },
                );
              }
              break;
            }
            case 'wipe': {
              drawStatic(sample.slideIndex);
              if (toBitmap) {
                drawBitmapFitted(
                  ctx,
                  toBitmap.image,
                  toBitmap.width,
                  toBitmap.height,
                  canvas.width,
                  canvas.height,
                  {
                    clip: wipeClipRect(transition.direction, e, canvas.width, canvas.height),
                    backdrop: true,
                  },
                );
              }
              break;
            }
            case 'morph': {
              // Live pair render; prepared lazily, crossfade fallback when
              // the plan is missing so the show never stalls or blanks.
              const planState = morphPlanRef.current;
              const planKey = `${sample.slideIndex}:${revision}`;
              if (planState?.plan && planState.key === planKey) {
                const framePlan = sampleMorphFrame(planState.plan, e);
                busy = true;
                void (async () => {
                  try {
                    const fromOk = await renderLive(
                      {
                        document,
                        frameId: slide.entry.frameId,
                        overrides: framePlan.fromOverrides,
                        skipNodeIds: framePlan.skipFromIds,
                        backdrop: true,
                      },
                      scratchFor(
                        'a',
                        planFrameWidth(document, slide.entry.frameId),
                        planFrameHeight(document, slide.entry.frameId),
                      ),
                    );
                    const toOk = await renderLive(
                      {
                        document,
                        frameId: nextSlide.entry.frameId,
                        overrides: framePlan.toOverrides,
                        backdrop: true,
                      },
                      scratchFor(
                        'b',
                        planFrameWidth(document, nextSlide.entry.frameId),
                        planFrameHeight(document, nextSlide.entry.frameId),
                      ),
                    );
                    if (cancelled) return;
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    const a = scratchARef.current;
                    const b = scratchBRef.current;
                    if (fromOk && a) {
                      drawBitmapFitted(ctx, a, a.width, a.height, canvas.width, canvas.height);
                    } else if (fromBitmap) {
                      drawBitmapFitted(
                        ctx,
                        fromBitmap.image,
                        fromBitmap.width,
                        fromBitmap.height,
                        canvas.width,
                        canvas.height,
                        { backdrop: true },
                      );
                    }
                    if (toOk && b) {
                      drawBitmapFitted(ctx, b, b.width, b.height, canvas.width, canvas.height);
                    }
                  } finally {
                    busy = false;
                  }
                })();
              } else {
                drawStatic(sample.slideIndex);
                drawStatic(sample.slideIndex + 1, e);
              }
              break;
            }
            default:
              drawStatic(sample.slideIndex + 1);
          }
        };
        if (!busy) paint();
        return;
      }

      // Shown phase. Settled slides repaint only when their key changes:
      // an idle show must not burn redraws (and shadowBlur) at refresh rate.
      if (!slide) return;
      if (!hasPendingBuilds && !anyActiveBuild) {
        if (lastKeyRef.current !== stabilityKey) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          drawStatic(sample.slideIndex);
          lastKeyRef.current = stabilityKey;
        }
        return;
      }
      // Builds: live-render with overrides; nodes hidden by entrance steps
      // keep opacity 0 through the override map. Until the first live frame
      // lands, the previous stable frame stays on screen (never blank).
      if (!renderer) {
        lastKeyRef.current = stabilityKey;
        return;
      }
      const preparedPromise = renderer.prepare(
        document,
        slide.entry.frameId,
        revision,
        new AbortController().signal,
      );
      busy = true;
      void (async () => {
        try {
          const prepared = await preparedPromise;
          const nodesById = new Map(prepared.nodes.map((node) => [node.id, node]));
          const frame = document.nodes[slide.entry.frameId];
          const context = {
            frameWidth: frame?.kind === 'frame' ? (frame.w ?? 0) : 0,
            frameHeight: frame?.kind === 'frame' ? (frame.h ?? 0) : 0,
          };
          const sampled = sampleBuildOverrides(sample.builds, nodesById, context);
          const overrides = new Map<string, SlideOverridePatch>();
          for (const [nodeId, patch] of sampled.overrides) overrides.set(nodeId, patch);
          for (const [nodeId, ranges] of sampled.hiddenParagraphs) {
            const node = nodesById.get(nodeId);
            if (!node) continue;
            overrides.set(nodeId, {
              ...overrides.get(nodeId),
              ...patchTextForHiddenParagraphs(node, ranges),
            });
          }
          const scratch = scratchFor('a', context.frameWidth, context.frameHeight);
          const ok = await renderLive(
            { document, frameId: slide.entry.frameId, overrides, backdrop: true },
            scratch,
          );
          if (cancelled) return;
          if (ok && scratch) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            drawBitmapFitted(
              ctx,
              scratch,
              scratch.width,
              scratch.height,
              canvas.width,
              canvas.height,
            );
          }
        } catch {
          // Hold the previous frame; never paint an empty stage mid-show.
        } finally {
          busy = false;
        }
      })();
      lastKeyRef.current = stabilityKey;
    };

    const loop = () => {
      if (cancelled) return;
      ensureMorphPlan();
      if (!busy) tick();
      raf = requestAnimationFrame(loop);
    };

    // Build the morph plan once per cursor change while a morph is active.
    const ensureMorphPlan = () => {
      const sample = director.sample(clock.now());
      const slide = slides[sample.slideIndex];
      const nextSlide = slides[sample.slideIndex + 1];
      if (sample.transition?.kind !== 'morph' || !slide || !nextSlide) {
        morphPlanRef.current = null;
        return;
      }
      const key = `${sample.slideIndex}:${revision}`;
      if (morphPlanRef.current?.key === key) return;
      if (!renderer) return;
      void (async () => {
        try {
          const controller = new AbortController();
          const fromPrepared = await renderer.prepare(
            document,
            slide.entry.frameId,
            revision,
            controller.signal,
          );
          const toPrepared = await renderer.prepare(
            document,
            nextSlide.entry.frameId,
            revision,
            controller.signal,
          );
          if (cancelled) return;
          morphPlanRef.current = {
            key,
            plan: planMorphTransition(
              fromPrepared.nodes,
              toPrepared.nodes,
              slide.entry.frameId,
              nextSlide.entry.frameId,
              fromPrepared.frameWorld,
              toPrepared.frameWorld,
            ),
          };
        } catch {
          morphPlanRef.current = { key, plan: null };
        }
      })();
    };

    ensureMorphPlan();
    loop();
    const observer = new ResizeObserver(() => resize());
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [
    bitmaps,
    bitmapsVersion,
    clock,
    director,
    document,
    reducedMotion,
    renderer,
    revision,
    slides,
    transitions,
  ]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="presentation-audience__canvas"
        role="img"
        aria-label={
          slides[director.slideIndex]?.entry.altText ??
          slides[director.slideIndex]?.entry.title ??
          'Slide stage'
        }
      />
      <canvas ref={scratchARef} className="presentation-audience__scratch" hidden />
      <canvas ref={scratchBRef} className="presentation-audience__scratch" hidden />
    </>
  );
}

function planFrameWidth(document: SceneDocument, frameId: string): number {
  const frame = document.nodes[frameId];
  return frame?.kind === 'frame' ? (frame.w ?? 0) : 0;
}

function planFrameHeight(document: SceneDocument, frameId: string): number {
  const frame = document.nodes[frameId];
  return frame?.kind === 'frame' ? (frame.h ?? 0) : 0;
}
