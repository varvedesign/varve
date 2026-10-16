/**
 * Canvas replay for vertical text.
 *
 * Kept outside replay.ts because replay.ts is a deliberately complexity-capped
 * hot path. This module consumes the canonical snapshot and only owns the
 * vertical paint policy; horizontal replay remains unchanged.
 *
 * Sideways clusters paint as coherent rotated runs (one draw call per
 * consecutive same-format group) so kerning and ligatures of rotated Latin
 * survive; upright and combined cells paint per cluster.
 */

import { managedColorToRgba } from '@varve/shared';
import { resolveCanvasFontFamily, setCanvasFont, withEmojiFallback } from './canvasFontAliases';
import type { ReplayTarget } from './replayTypes';
import { shapeText } from './shaping';
import {
  buildTextLayoutSnapshot,
  type PositionedGlyph,
  type TextLayoutSnapshot,
} from './textLayoutSnapshot';
import type { CharacterFormat, EngineColor, RenderItem, RichText } from './types';

type TextPrimitive = Extract<RenderItem['primitive'], { kind: 'text' }>;

function rgba(c: EngineColor | readonly [number, number, number, number]): string {
  if (Array.isArray(c) || 'length' in c) {
    return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3] / 255})`;
  }
  const [r, g, b, a] = managedColorToRgba(c);
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

function richTextFormatAt(richText: RichText, offset: number): CharacterFormat {
  let cursor = 0;
  for (const paragraph of richText.paragraphs) {
    for (const run of paragraph.runs) {
      if (offset >= cursor && offset < cursor + run.text.length) return run.format ?? {};
      cursor += run.text.length;
    }
    cursor += 1;
  }
  return {};
}

function effectiveWeight(p: { fontWeight: number; variableAxes?: Record<string, number> }): number {
  const axis = p.variableAxes?.wght;
  const weight = typeof axis === 'number' && Number.isFinite(axis) ? axis : p.fontWeight;
  return Math.max(1, Math.min(1000, weight));
}

function verticalFontString(
  family: string,
  size: number,
  weight: number,
  style: string | undefined,
  features: import('@varve/shared').OpenTypeFeatureMap | undefined,
  axes: Record<string, number> | undefined,
  text?: string,
): string {
  const italic = style === 'italic' ? 'italic ' : '';
  const resolvedFamily = resolveCanvasFontFamily(family, features, axes, text);
  return `${italic}${Math.max(1, Math.min(1000, weight))} ${size}px ${withEmojiFallback(`"${resolvedFamily}"`)}`;
}

function verticalBoxOffset(
  p: TextPrimitive,
  snapshot: TextLayoutSnapshot,
): { x: number; y: number } {
  const x =
    p.textAlign === 'center'
      ? (p.w - snapshot.width) / 2
      : p.textAlign === 'right'
        ? p.w - snapshot.width
        : 0;
  const y =
    p.textAlignVertical === 'middle'
      ? (p.h - snapshot.height) / 2
      : p.textAlignVertical === 'bottom'
        ? p.h - snapshot.height
        : 0;
  return { x, y };
}

function paintCluster(
  target: ReplayTarget,
  cluster: string,
  x: number,
  y: number,
  orientation: 'upright' | 'sideways',
  drawText: (cluster: string) => void,
  /**
   * Tate-chu-yoko: draw the merged span horizontally, scaled to its measured
   * one-em fit, instead of applying the cluster orientation. The scale comes
   * from the layout snapshot; there is no fixed shrink factor here.
   */
  combinedScale?: number,
): void {
  target.save();
  target.translate(x, y);
  if (combinedScale != null) target.scale(combinedScale, combinedScale);
  else if (orientation === 'sideways') target.rotate(Math.PI / 2);
  drawText(cluster);
  target.restore();
}

function clusterTextOf(snapshot: TextLayoutSnapshot, glyph: PositionedGlyph): string | null {
  const cluster = snapshot.text.slice(glyph.clusterUtf16, glyph.sourceEnd);
  if (cluster.length === 0 || cluster.includes('\n')) return null;
  return cluster;
}

/**
 * Extend a sideways group from `start` while clusters stay sideways, unpainted,
 * source-contiguous, and (when `formatKeyOf` is supplied) format-identical.
 * Returns the exclusive end index; a lone cluster yields start + 1.
 */
function extendSidewaysGroup(
  snapshot: TextLayoutSnapshot,
  glyphs: readonly PositionedGlyph[],
  start: number,
  isPainted: (glyph: PositionedGlyph) => boolean,
  formatKeyOf?: (glyph: PositionedGlyph) => string,
): number {
  let end = start + 1;
  while (end < glyphs.length) {
    const previous = glyphs[end - 1]!;
    const candidate = glyphs[end]!;
    if (candidate.orientation !== 'sideways' || candidate.combinedScale != null) break;
    if (isPainted(candidate)) break;
    if (!clusterTextOf(snapshot, candidate)) break;
    if (candidate.clusterUtf16 !== previous.sourceEnd) break;
    if (formatKeyOf && formatKeyOf(candidate) !== formatKeyOf(glyphs[start]!)) break;
    end += 1;
  }
  return end;
}

/** Paint one coalesced sideways run: a single rotated draw at the group origin. */
function paintSidewaysGroup(
  target: ReplayTarget,
  first: PositionedGlyph,
  text: string,
  origin: { x: number; y: number },
  drawText: (text: string) => void,
): void {
  target.save();
  target.translate(
    origin.x + first.x + first.xOffset,
    origin.y + first.y - first.verticalAdvance! / 2,
  );
  target.rotate(Math.PI / 2);
  target.textAlign = 'left';
  drawText(text);
  target.restore();
}

/** Build the same canonical vertical snapshot used by fill replay. */
export function buildVerticalTextSnapshot(
  target: ReplayTarget,
  p: TextPrimitive,
): TextLayoutSnapshot | null {
  const shaping =
    p.shaping ??
    (target.measureText
      ? shapeText(p.text, p.fontFamily, p.fontSize, target as unknown as CanvasRenderingContext2D, {
          fontWeight: effectiveWeight(p),
          fontStyle: p.fontStyle,
          letterSpacing: p.letterSpacing,
          tracking: p.tracking,
          direction: p.direction ?? 'auto',
          language: p.language,
          openTypeFeatures: p.openTypeFeatures,
          variableAxes: p.variableAxes,
          writingMode: p.writingMode,
          textOrientation: p.textOrientation,
        })
      : undefined);
  if (!shaping) return null;
  return buildTextLayoutSnapshot(p.text, shaping, {
    maxWidth: p.textMode === 'area' ? p.h : 0,
    lineHeight: p.fontSize * (p.lineHeight ?? 1.4),
    language: p.language,
    writingMode: p.writingMode,
    textOrientation: p.textOrientation,
  });
}

export function paintVerticalCanonicalRichText(
  target: ReplayTarget,
  p: TextPrimitive,
  richText: RichText,
  snapshot: TextLayoutSnapshot,
): void {
  const offset = verticalBoxOffset(p, snapshot);
  const originalFillStyle = target.fillStyle;
  target.textAlign = 'center';
  target.textBaseline = 'middle';
  const painted = new Set<string>();
  const isPainted = (glyph: PositionedGlyph): boolean =>
    painted.has(`${glyph.clusterUtf16}:${glyph.sourceEnd}`);
  const formatKeyOf = (glyph: PositionedGlyph): string => {
    const format = richTextFormatAt(richText, glyph.clusterUtf16);
    return JSON.stringify([
      format.fontFamily,
      format.fontSize,
      format.fontWeight,
      format.fontStyle,
      format.color ? rgba(format.color) : '',
    ]);
  };
  for (const line of snapshot.lines) {
    for (const run of line.runs) {
      let index = 0;
      while (index < run.glyphs.length) {
        const glyph = run.glyphs[index]!;
        if (isPainted(glyph)) {
          index += 1;
          continue;
        }
        const cluster = clusterTextOf(snapshot, glyph);
        if (!cluster) {
          index += 1;
          continue;
        }
        const format = richTextFormatAt(richText, glyph.clusterUtf16);
        if (glyph.orientation === 'sideways' && glyph.combinedScale == null) {
          const groupEnd = extendSidewaysGroup(snapshot, run.glyphs, index, isPainted, formatKeyOf);
          if (groupEnd - index > 1) {
            const first = glyph;
            const last = run.glyphs[groupEnd - 1]!;
            const groupText = snapshot.text.slice(first.clusterUtf16, last.sourceEnd);
            const groupFormat = richTextFormatAt(richText, first.clusterUtf16);
            setCanvasFont(
              target,
              verticalFontString(
                groupFormat.fontFamily ?? run.sourceRun.fontFamily,
                groupFormat.fontSize ?? run.sourceRun.fontSize,
                groupFormat.fontWeight ?? run.sourceRun.fontWeight,
                groupFormat.fontStyle ?? run.sourceRun.fontStyle,
                groupFormat.openTypeFeatures ?? p.openTypeFeatures,
                groupFormat.variableFontSettings ?? p.variableAxes,
                groupText,
              ),
            );
            if (groupFormat.color) target.fillStyle = rgba(groupFormat.color);
            paintSidewaysGroup(
              target,
              first,
              groupText,
              { x: p.x + offset.x, y: p.y + offset.y },
              (value) => target.fillText(value, 0, 0),
            );
            if (groupFormat.color) target.fillStyle = originalFillStyle;
            for (let i = index; i < groupEnd; i++) painted.add(paintedKeyOf(run.glyphs[i]!));
            index = groupEnd;
            continue;
          }
        }
        painted.add(paintedKeyOf(glyph));
        setCanvasFont(
          target,
          verticalFontString(
            format.fontFamily ?? run.sourceRun.fontFamily,
            format.fontSize ?? run.sourceRun.fontSize,
            format.fontWeight ?? run.sourceRun.fontWeight,
            format.fontStyle ?? run.sourceRun.fontStyle,
            format.openTypeFeatures ?? p.openTypeFeatures,
            format.variableFontSettings ?? p.variableAxes,
            cluster,
          ),
        );
        if (format.color) target.fillStyle = rgba(format.color);
        paintCluster(
          target,
          cluster,
          p.x + offset.x + glyph.x + glyph.xOffset,
          p.y + offset.y + glyph.y + glyph.yOffset,
          glyph.orientation ?? 'sideways',
          (value) => target.fillText(value, 0, 0),
          glyph.combinedScale,
        );
        target.fillStyle = originalFillStyle;
        index += 1;
      }
    }
  }
}

function paintedKeyOf(glyph: PositionedGlyph): string {
  return `${glyph.clusterUtf16}:${glyph.sourceEnd}`;
}

export function paintVerticalCanonicalText(
  target: ReplayTarget,
  p: TextPrimitive,
  snapshot: TextLayoutSnapshot,
): void {
  const offset = verticalBoxOffset(p, snapshot);
  const originalFillStyle = target.fillStyle;
  target.textAlign = 'center';
  target.textBaseline = 'middle';
  const painted = new Set<string>();
  const isPainted = (glyph: PositionedGlyph): boolean => painted.has(paintedKeyOf(glyph));
  for (const line of snapshot.lines) {
    for (const run of line.runs) {
      const weight =
        p.variableAxes?.wght != null
          ? effectiveWeight(p)
          : Math.max(1, Math.min(1000, run.sourceRun.fontWeight));
      setCanvasFont(
        target,
        verticalFontString(
          run.sourceRun.fontFamily,
          run.sourceRun.fontSize,
          weight,
          run.sourceRun.fontStyle,
          p.openTypeFeatures,
          p.variableAxes,
          snapshot.text.slice(run.sourceStart, run.sourceEnd),
        ),
      );
      let index = 0;
      while (index < run.glyphs.length) {
        const glyph = run.glyphs[index]!;
        if (isPainted(glyph)) {
          index += 1;
          continue;
        }
        const cluster = clusterTextOf(snapshot, glyph);
        if (!cluster) {
          index += 1;
          continue;
        }
        if (glyph.orientation === 'sideways' && glyph.combinedScale == null) {
          const groupEnd = extendSidewaysGroup(snapshot, run.glyphs, index, isPainted);
          if (groupEnd - index > 1) {
            const first = glyph;
            const last = run.glyphs[groupEnd - 1]!;
            paintSidewaysGroup(
              target,
              first,
              snapshot.text.slice(first.clusterUtf16, last.sourceEnd),
              { x: p.x + offset.x, y: p.y + offset.y },
              (value) => target.fillText(value, 0, 0),
            );
            for (let i = index; i < groupEnd; i++) painted.add(paintedKeyOf(run.glyphs[i]!));
            index = groupEnd;
            continue;
          }
        }
        painted.add(paintedKeyOf(glyph));
        paintCluster(
          target,
          cluster,
          p.x + offset.x + glyph.x + glyph.xOffset,
          p.y + offset.y + glyph.y + glyph.yOffset,
          glyph.orientation ?? 'sideways',
          (value) => target.fillText(value, 0, 0),
          glyph.combinedScale,
        );
        index += 1;
      }
    }
    if (p.textDecoration === 'underline' || p.textDecoration === 'line-through') {
      const x = p.x + offset.x + (line.x ?? 0) + line.width * 0.76;
      const y =
        p.y +
        offset.y +
        line.top +
        (p.textDecoration === 'underline' ? line.width * 0.08 : line.width * 0.5);
      target.beginPath();
      target.moveTo(x, y);
      target.lineTo(x, y + line.height);
      target.strokeStyle = target.fillStyle;
      target.lineWidth = 1;
      target.stroke();
    }
  }
  target.fillStyle = originalFillStyle;
}

/** Paint a vertical text stroke from canonical cluster positions. */
export function paintVerticalCanonicalTextStroke(
  target: ReplayTarget,
  p: TextPrimitive,
  snapshot: TextLayoutSnapshot,
): void {
  if (!target.strokeText) return;
  const offset = verticalBoxOffset(p, snapshot);
  target.textAlign = 'center';
  target.textBaseline = 'middle';
  const painted = new Set<string>();
  const isPainted = (glyph: PositionedGlyph): boolean => painted.has(paintedKeyOf(glyph));
  for (const line of snapshot.lines) {
    const weight = effectiveWeight(p);
    for (const run of line.runs) {
      setCanvasFont(
        target,
        verticalFontString(
          p.fontFamily,
          p.fontSize,
          weight,
          run.sourceRun.fontStyle,
          p.openTypeFeatures,
          p.variableAxes,
          snapshot.text.slice(run.sourceStart, run.sourceEnd),
        ),
      );
      let index = 0;
      while (index < run.glyphs.length) {
        const glyph = run.glyphs[index]!;
        if (isPainted(glyph)) {
          index += 1;
          continue;
        }
        const cluster = clusterTextOf(snapshot, glyph);
        if (!cluster) {
          index += 1;
          continue;
        }
        if (glyph.orientation === 'sideways' && glyph.combinedScale == null) {
          const groupEnd = extendSidewaysGroup(snapshot, run.glyphs, index, isPainted);
          if (groupEnd - index > 1) {
            const first = glyph;
            const last = run.glyphs[groupEnd - 1]!;
            paintSidewaysGroup(
              target,
              first,
              snapshot.text.slice(first.clusterUtf16, last.sourceEnd),
              { x: p.x + offset.x, y: p.y + offset.y },
              (value) => target.strokeText?.(value, 0, 0),
            );
            for (let i = index; i < groupEnd; i++) painted.add(paintedKeyOf(run.glyphs[i]!));
            index = groupEnd;
            continue;
          }
        }
        painted.add(paintedKeyOf(glyph));
        paintCluster(
          target,
          cluster,
          p.x + offset.x + glyph.x + glyph.xOffset,
          p.y + offset.y + glyph.y + glyph.yOffset,
          glyph.orientation ?? 'sideways',
          (value) => target.strokeText?.(value, 0, 0),
        );
        index += 1;
      }
    }
  }
}
