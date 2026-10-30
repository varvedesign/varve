// COMPLEXITY: 650 cyclo — replayIr is a hot path; see AGENTS.md §"The clean version is not always the fast version"
/**
 * Canvas2D replay of the render IR (the webview side of ADR-0001).
 *
 * This is the exact strategy the task-0.2 spike measured at 86 fps: native Rust
 * computes the scene and emits a compact IR; the webview replays it to a canvas.
 * `ReplayTarget` is a structural slice of CanvasRenderingContext2D so tests can
 * pass a recorder without a real DOM/canvas.
 *
 * F6 (Phase 2): opacity, blend modes, per-fill compositing, stacked strokes
 * and effects, plus arrow/path/image primitive rendering.
 */

import { mapBlendMode } from './compositeCanvas';
import { applyFilterWithCompositing } from './filterCompositor';
import { withoutIdentityFilters } from './filterIdentity';
import { applyFilterChain, filterChainToCss, filterToCss } from './filters';
import type { ReplayImagePolicy } from './mockup/warpReplay';
import {
  paintBackgroundBlur,
  paintGlassMaterial,
  paintGlassMaterialEdgeHighlight,
  shadowOps,
} from './replay/backdrop';
import { backdropCache } from './replay/backdropCache';
import { paintContentEffects } from './replay/effect';
import { reportUnsupportedEffectMasks } from './replay/effectDiagnostics';
import { paintFillsAndStrokes } from './replay/fill';
import { replayItemOnIsolatedSurface, treatmentSpaceForReplayItem } from './replay/isolatedSurface';
import type {
  ChromaticAberrationEffect,
  DepthBlurEffect,
  EffectDiagnostic,
  EffectMaskResolver,
  GlitchEffect,
  LayerBlurEffect,
  ReplayColorOptions,
  SpatialContentBlurEffect,
} from './replay/types';
import { primeCanvasTypographyAliases } from './replay/typography';
import { advanceGradientCacheFrame } from './replayGradient';
import type { ReplayTarget } from './replayTypes';
import {
  itemNeedsAlphaShadow,
  paintAlphaAwareDropShadow,
  paintAlphaAwareInsetEffect,
  paintAlphaAwareOuterGlow,
  paintGeometricDropShadow,
} from './shadowSource';
import type { RenderItem } from './types';

export { resetGradientCacheForTest } from './replayGradient';

export type { ReplayGradient, ReplayPattern, ReplayTarget } from './replayTypes';

/** Replay `ir` into `target` (a 2D context). Clears nothing; caller manages. */
/**
 * Module-level image lookup for the current replayIr call.
 * Set before calling internal paint functions, used by paintImageFill.
 * This avoids threading a parameter through 7 levels of function calls.
 */
export let imageLookupForCurrentReplay: ((src: string) => CanvasImageSource | undefined) | null =
  null;
export let effectMaskResolverForCurrentReplay: EffectMaskResolver | null = null;
export let imagePolicyForCurrentReplay: ReplayImagePolicy | undefined;

export let effectDiagnosticSinkForCurrentReplay: ((diagnostic: EffectDiagnostic) => void) | null =
  null;

/**
 * Replay a list of render items to the given canvas target.
 * @param imageLookup Optional callback for resolving image source URLs to
 *   CanvasImageSource (used by render workers that receive ImageBitmaps
 *   via Structured Clone and cannot use `new Image()`).
 * @param imagePolicy Optional interactive image representation policy. Export
 *   and print callers omit this argument and therefore always use full source
 *   fidelity.
 */
export function replayIr(
  target: ReplayTarget,
  ir: readonly RenderItem[],
  imageLookup?: (src: string) => CanvasImageSource | undefined,
  effectMaskResolver?: EffectMaskResolver,
  imagePolicy?: ReplayImagePolicy,
  colorOptions?: ReplayColorOptions,
  onEffectDiagnostic?: (diagnostic: EffectDiagnostic) => void,
): void {
  // Backdrop pixels are sampled from the target canvas, so a cache entry is
  // valid only within this replay. Keeping it across document revisions can
  // show a stale backdrop for up to the TTL even when the scene is unchanged
  // at the current camera.
  backdropCache.clear();
  // Frame-based gradient cache eviction
  advanceGradientCacheFrame();
  const previousImageLookup = imageLookupForCurrentReplay;
  const previousEffectMaskResolver = effectMaskResolverForCurrentReplay;
  const previousImagePolicy = imagePolicyForCurrentReplay;
  const previousEffectDiagnosticSink = effectDiagnosticSinkForCurrentReplay;
  imageLookupForCurrentReplay = imageLookup ?? previousImageLookup;
  effectMaskResolverForCurrentReplay = effectMaskResolver ?? previousEffectMaskResolver;
  imagePolicyForCurrentReplay = imagePolicy ?? previousImagePolicy;
  effectDiagnosticSinkForCurrentReplay = onEffectDiagnostic ?? previousEffectDiagnosticSink;
  try {
    primeCanvasTypographyAliases(target, ir);
    for (const item of ir) {
      reportUnsupportedEffectMasks(item);
      if (
        replayItemOnIsolatedSurface(
          target,
          item,
          imageLookupForCurrentReplay ?? undefined,
          effectMaskResolverForCurrentReplay ?? undefined,
          imagePolicyForCurrentReplay ?? undefined,
          colorOptions,
        )
      ) {
        continue;
      }
      target.save();
      try {
        // Apply item-level transform
        target.transform(
          item.transform[0],
          item.transform[1],
          item.transform[2],
          item.transform[3],
          item.transform[4],
          item.transform[5],
        );

        // ── Item-level opacity and blend ─────────────────────────────
        const itemAlpha = item.opacity ?? 1;
        if (itemAlpha < 1) {
          target.globalAlpha = itemAlpha;
        }
        const itemBlend =
          item.blendMode && item.blendMode !== 'normal'
            ? mapBlendMode(item.blendMode)
            : 'source-over';
        if (itemBlend !== 'source-over') {
          target.globalCompositeOperation = itemBlend;
        }

        // ── Filters pass (nondestructive adjustments) ──────────────────
        // CSS-compatible filters with opacity=1 and blendMode=normal are applied
        // via ctx.filter for GPU-accelerated rendering of fills + strokes.
        // Non-CSS filters and filters requiring per-filter opacity/blendMode
        // are handled after rendering via offscreen canvas compositing.
        // Determine if any filter requires post-render offscreen compositing:
        // - Filters with non-normal blend mode
        // - Filters with opacity < 1
        // - Filters without a CSS equivalent (curves, levels, selectiveColor, etc.)
        // Neutral entries are dropped first so a reset control cannot force the
        // offscreen path and change antialiased pixels for no reason.
        const activeFilters =
          item.filters && item.filters.length > 0
            ? withoutIdentityFilters(item.filters)
            : (item.filters ?? []);
        const needsPostRenderFilters = activeFilters.some(
          (f) =>
            !f.blendMode || f.blendMode !== 'normal' || (f.opacity ?? 1) < 1 || !filterToCss(f),
        );
        if (activeFilters.length > 0) {
          if (needsPostRenderFilters) {
            // Simple CSS filters are applied before fills for GPU rendering.
            // Complex filters are deferred to post-render compositing.
            const simpleFilters = activeFilters.filter(
              (f) => f.blendMode === 'normal' && (f.opacity ?? 1) >= 1,
            );
            const simpleCss = filterChainToCss(simpleFilters);
            if (simpleCss) target.filter = simpleCss;
          } else {
            applyFilterChain(target, activeFilters);
          }
        }

        // Collect content effects that need to be applied to the rendered shape
        // (layerBlur, chromaticAberration, glitch) in the order they are listed.
        const contentEffects =
          item.effects?.filter(
            (
              e,
            ): e is
              | LayerBlurEffect
              | DepthBlurEffect
              | SpatialContentBlurEffect
              | ChromaticAberrationEffect
              | GlitchEffect =>
              e.visible &&
              (e.type === 'layerBlur' ||
                e.type === 'depthBlur' ||
                e.type === 'gaussianBlur' ||
                e.type === 'fieldBlur' ||
                e.type === 'irisBlur' ||
                e.type === 'tiltShiftBlur' ||
                e.type === 'pathBlur' ||
                e.type === 'spinBlur' ||
                e.type === 'chromaticAberration' ||
                e.type === 'glitch'),
          ) ?? [];

        // ── Backdrop-based effects (before fills — captures true backdrop) ───
        // Both backgroundBlur and glassMaterial render the backdrop behind the item.
        // glassMaterial additionally applies tint, saturation, brightness, and noise.
        if (item.effects) {
          for (const effect of item.effects) {
            if (!effect.visible) continue;
            if (effect.type === 'backgroundBlur') {
              paintBackgroundBlur(target, item, effect);
            } else if (effect.type === 'glassMaterial') {
              paintGlassMaterial(target, item, effect);
            }
          }
        }

        // Outer appearance effects belong between the backdrop and the item
        // content. Painting them after fills lets a displaced shadow/glow
        // overlap the source pixels and makes stacking depend on blur/offset;
        // this order keeps the source authoritative while preserving the
        // shadow's interaction with the existing backdrop.
        if (item.effects) {
          for (const effect of item.effects) {
            if (!effect.visible) continue;
            if (effect.type === 'dropShadow') {
              if (itemNeedsAlphaShadow(item) || effect.spread !== 0) {
                paintAlphaAwareDropShadow(target, item, effect, shadowOps);
              } else {
                paintGeometricDropShadow(target, item, effect, shadowOps);
              }
            } else if (effect.type === 'outerGlow') {
              paintAlphaAwareOuterGlow(target, item, effect, shadowOps);
            }
          }
        }

        // ── Fills + strokes pass (offscreen when content effects present) ───
        if (contentEffects.length > 0) {
          paintContentEffects(
            target,
            item,
            contentEffects,
            itemAlpha,
            itemBlend,
            effectMaskResolverForCurrentReplay ?? undefined,
          );
        } else {
          paintFillsAndStrokes(target, item, itemAlpha, itemBlend);
        }

        // ── Effects pass (per-effect save/restore compositing) ────────
        if (item.effects && item.effects.length > 0) {
          for (const effect of item.effects) {
            if (!effect.visible) continue;
            if (
              effect.type === 'layerBlur' ||
              effect.type === 'depthBlur' ||
              effect.type === 'gaussianBlur' ||
              effect.type === 'fieldBlur' ||
              effect.type === 'irisBlur' ||
              effect.type === 'tiltShiftBlur' ||
              effect.type === 'pathBlur' ||
              effect.type === 'spinBlur' ||
              effect.type === 'backgroundBlur' ||
              effect.type === 'chromaticAberration' ||
              effect.type === 'glitch'
            )
              continue;
            if (effect.type === 'glassMaterial') continue; // backdrop handled before fills
            if (effect.type === 'innerShadow') {
              // Always derive inset effects from rendered alpha so spread and
              // antialiased/transparent content behave identically for text,
              // images, raster layers, and vector shapes.
              paintAlphaAwareInsetEffect(target, item, effect, 'shadow', shadowOps);
            } else if (effect.type === 'innerGlow') {
              paintAlphaAwareInsetEffect(target, item, effect, 'glow', shadowOps);
            }
          }
        }

        // ── Glass material edge highlight (after fills, before filters) ──
        if (item.effects) {
          for (const effect of item.effects) {
            if (effect.visible && effect.type === 'glassMaterial' && effect.edgeHighlight) {
              paintGlassMaterialEdgeHighlight(target, item, effect);
            }
          }
        }

        // ── Post-render filter compositing ────────────────────────────
        // Apply complex filters (non-CSS, or requiring per-filter opacity/blend)
        // via offscreen canvas compositing on the fully rendered item.
        if (needsPostRenderFilters && activeFilters.length > 0) {
          const complexFilters = activeFilters.filter(
            (f) => f.blendMode !== 'normal' || (f.opacity ?? 1) < 1 || !filterToCss(f),
          );
          if (complexFilters.length > 0) {
            const targetCanvas = target as unknown as CanvasRenderingContext2D;
            // Adjustment layers reach the IR as zero-geometry items whose
            // filters composite over the whole surface. The current transform
            // maps doc units to device pixels (camera + floating origin), so
            // it is the correct coordSpace for zoom-stable effect parameters
            // (dither cells, split offsets, bloom radii). On nested surfaces
            // the transform is identity and parameters interpret in the
            // surface's own pixel space, which is self-consistent.
            let coordSpace:
              | {
                  scale: number;
                  originX: number;
                  originY: number;
                  regionX: number;
                  regionY: number;
                }
              | undefined;
            try {
              const cam = targetCanvas.getTransform();
              coordSpace = {
                scale: Math.abs(cam.a) || 1,
                originX: cam.e,
                originY: cam.f,
                regionX: 0,
                regionY: 0,
              };
            } catch {
              coordSpace = undefined;
            }
            const treatmentSpace = targetCanvas.getTransform
              ? treatmentSpaceForReplayItem(targetCanvas.getTransform(), item)
              : undefined;
            applyFilterWithCompositing(
              targetCanvas,
              complexFilters,
              targetCanvas.canvas?.width ?? 100,
              targetCanvas.canvas?.height ?? 100,
              { coordSpace, treatmentSpace },
            );
          }
        }

        // Reset per-item state (shadow, filter, etc.)
        target.shadowColor = 'transparent';
        target.shadowBlur = 0;
        target.shadowOffsetX = 0;
        target.shadowOffsetY = 0;
        target.filter = 'none';
        target.globalAlpha = 1;
        target.globalCompositeOperation = 'source-over';
      } finally {
        // Canvas state is stack-based. A failed image/filter/effect must not
        // poison every later item or the caller's camera transform.
        target.restore();
      }
    }
  } finally {
    imageLookupForCurrentReplay = previousImageLookup;
    effectMaskResolverForCurrentReplay = previousEffectMaskResolver;
    imagePolicyForCurrentReplay = previousImagePolicy;
    effectDiagnosticSinkForCurrentReplay = previousEffectDiagnosticSink;
  }
}
export { renderAlphaMask } from './replay/alphaMask';
export { __clearBackdropCache, __getBackdropCacheSize } from './replay/backdropCache';
export { contentEffectPadding } from './replay/effect';
export { primitiveBounds } from './replay/primitiveBounds';
export { drawClusters } from './replay/textPath';
export type {
  ContentEffect,
  EffectDiagnostic,
  EffectDiagnosticCode,
  EffectMaskResolver,
  ReplayColorOptions,
} from './replay/types';
