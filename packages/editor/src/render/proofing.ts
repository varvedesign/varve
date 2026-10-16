/**
 * Proof transform applied to render IR before canvas replay (display only).
 *
 * Applies the proof transform to every color-bearing field of a RenderItem:
 * fills, gradient stops, strokes, effects, and rich-text run colors. The
 * result is used exclusively for on-canvas preview; exports never pass
 * through this module and document colors are never mutated.
 *
 * When proofing is unavailable (no profile converter registered for the
 * runtime), the IR is returned unchanged and callers are expected to
 * disclose the limitation.
 */

import type { RenderItem } from '@varve/engine';
import {
  applyProofToNormalized,
  applyProofToRgba,
  managedColorToNormalized,
  managedColorToRgba,
  type ProofTransformConfig,
} from '@varve/shared';

type DisplayProofColor = import('@varve/shared').ManagedColorShim & {
  profile?: string;
  profileFingerprint?: string;
};

/**
 * Build a proofed display colour: the source colour's identity, alpha and
 * unrelated fields, with the proofed sRGB channels substituted.
 *
 * The result must not retain the source profile metadata: doing so would make
 * replay resolve, for example, already-proofed sRGB numbers as Display P3 and
 * transform them a second time. This copy is display-only and never reaches
 * the document.
 */
export function displaySrgbProofColor(
  source: import('@varve/shared').ManagedColorShim,
  rgba: readonly [number, number, number, number],
  bitDepth?: 'uint8' | 'float32',
): import('@varve/shared').ManagedColorShim {
  const result: DisplayProofColor = {
    ...source,
    space: 'rgb',
    ...(bitDepth ? { bitDepth } : {}),
    r: rgba[0],
    g: rgba[1],
    b: rgba[2],
    a: rgba[3],
  } as DisplayProofColor;
  delete result.profile;
  delete result.profileFingerprint;
  return result;
}

/** Map an array only when one of its values changes identity. */
function mapIfChanged<T>(
  values: readonly T[] | undefined,
  mapper: (value: T) => T,
): T[] | undefined {
  if (!values) return undefined;
  let changed = false;
  const mapped = values.map((value) => {
    const next = mapper(value);
    if (next !== value) changed = true;
    return next;
  });
  return changed ? mapped : (values as T[]);
}

function proofColor(
  color: import('@varve/shared').ManagedColorShim,
  config: ProofTransformConfig,
): import('@varve/shared').ManagedColorShim {
  const normalized = managedColorToNormalized(color);
  const normalizedResult = applyProofToNormalized(normalized, config);
  if (normalizedResult.kind !== 'unavailable') {
    return displaySrgbProofColor(color, normalizedResult.rgba, 'float32');
  }

  const rgba = managedColorToRgba(color);
  const result = applyProofToRgba(rgba, config);
  if (result.kind === 'unavailable') return color;
  return displaySrgbProofColor(color, result.rgba);
}

/**
 * Every colour-bearing field of a render item, in traversal order.
 *
 * Derived from the walker itself rather than re-listing the fields, so the two
 * can never disagree: if `mapItemColors` gains a colour field, this sees it
 * automatically. The batched provider uses this to decide what to transform,
 * then hands the results back through the same walker.
 */
export function colorSlotsOfItem(item: RenderItem): unknown[] {
  const seen = new Set<unknown>();
  const ordered: unknown[] = [];
  mapItemColors(item, (color) => {
    // A colour field may legitimately be absent (an unfilled shape, a text run
    // without an explicit colour). Those are not colours to transform.
    if (color == null) return color;
    if (!seen.has(color)) {
      seen.add(color);
      ordered.push(color);
    }
    return color;
  });
  return ordered;
}

export function mapFrameColors(
  items: readonly RenderItem[],
  mapper: (
    color: import('@varve/shared').ManagedColorShim,
  ) => import('@varve/shared').ManagedColorShim,
): RenderItem[] {
  let anyChanged = false;
  const out = items.map((item) => {
    const next = mapItemColors(item, mapper);
    if (next !== item) anyChanged = true;
    return next;
  });
  return anyChanged ? (out as RenderItem[]) : (items as RenderItem[]);
}

/** Apply a colour mapping to one render item (see {@link mapFrameColors}). */
function mapItemColors(
  item: RenderItem,
  mapper: (
    color: import('@varve/shared').ManagedColorShim,
  ) => import('@varve/shared').ManagedColorShim,
): RenderItem {
  let next: RenderItem = item;

  const fill = mapper(item.fill);
  if (fill !== item.fill) next = { ...next, fill };

  const filled = mapIfChanged(next.fills, (f) => {
    if (f.type === 'solid') {
      const c = mapper(f.color);
      return c === f.color ? f : { ...f, color: c };
    }
    if (f.type === 'gradient') {
      const stops = mapIfChanged(f.stops, (s) => {
        const c = mapper(s.color);
        return c === s.color ? s : { ...s, color: c };
      });
      return stops === f.stops ? f : { ...f, stops: stops ?? [] };
    }
    return f;
  });
  if (filled !== next.fills) next = { ...next, fills: filled };

  const stroked = mapIfChanged(next.strokes, (s) => {
    const c = mapper(s.color);
    return c === s.color ? s : { ...s, color: c };
  });
  if (stroked !== next.strokes) next = { ...next, strokes: stroked };

  const effected = mapIfChanged(next.effects, (e) => {
    if ('color' in e && e.color) {
      const c = mapper(e.color);
      return c === e.color ? e : { ...e, color: c };
    }
    if (e.type === 'glassMaterial') {
      const tint = mapper(e.tint);
      const edge = mapper(e.edgeHighlightColor);
      if (tint === e.tint && edge === e.edgeHighlightColor) return e;
      return { ...e, tint, edgeHighlightColor: edge };
    }
    return e;
  });
  if (effected !== next.effects) next = { ...next, effects: effected };

  const primitive = next.primitive;
  if (primitive && primitive.kind === 'text' && primitive.richText) {
    let runsChanged = false;
    const paragraphs = primitive.richText.paragraphs.map((para) => {
      const runs = para.runs.map((run) => {
        if (!run.format?.color) return run;
        const c = mapper(run.format.color);
        if (c === run.format.color) return run;
        runsChanged = true;
        return { ...run, format: { ...run.format, color: c } };
      });
      return runs === para.runs ? para : { ...para, runs };
    });
    if (runsChanged) {
      next = {
        ...next,
        primitive: {
          ...primitive,
          richText: { ...primitive.richText, paragraphs },
        },
      };
    }
  }

  return next;
}

/**
 * Apply the proof transform to a full render item. Returns the SAME object
 * when proofing is unavailable or nothing changed, so callers can skip
 * re-render work on the hot path.
 */
export function applyProofToItem(item: RenderItem, config: ProofTransformConfig): RenderItem {
  return mapItemColors(item, (color) => proofColor(color, config));
}

/** Apply the proof transform to a full IR frame (see {@link mapFrameColors}). */
export function applyProofToIr(items: RenderItem[], config: ProofTransformConfig): RenderItem[] {
  return mapFrameColors(items, (color) => proofColor(color, config));
}
