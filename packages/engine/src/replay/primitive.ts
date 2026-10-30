import { getImageCache } from '../imageCache';
import { paintWarpedImage, resolveReplayImage } from '../mockup/warpReplay';
import { pathFillRule, pathRings } from '../pathCompound';
import { imageLookupForCurrentReplay } from '../replay';
import type { ReplayTarget } from '../replayTypes';
import { tracePathRing } from '../strokeReplay';
import type { RenderItem } from '../types';
import { paintRasterLayer } from './raster';
import { paintTable } from './table';
import { paintText } from './text';

const TAU = Math.PI * 2;

/**
 * Trace a squircle (continuous-corner rect) path.
 * smoothing=0 → identical to roundRect; smoothing=1 → fully smooth iOS-style corners.
 *
 * Uses cubic bezier approximation: the arc endpoints are "pulled" further along
 * each straight edge by `r * s * 0.55`, while bezier handle length stays at
 * `r * 0.5523` (the standard circle-arc approximation constant). This produces
 * the characteristic wide, smooth corner that fills more of the bounding box.
 */
function traceSquirclePath(
  target: ReplayTarget,
  x: number,
  y: number,
  w: number,
  h: number,
  cornerRadius: number | [number, number, number, number],
  smoothing: number,
): void {
  const maxR = Math.min(w, h) / 2;
  let [tl, tr, br, bl] = (
    Array.isArray(cornerRadius)
      ? cornerRadius
      : [cornerRadius, cornerRadius, cornerRadius, cornerRadius]
  ).map((v) => Math.max(0, Math.min(v, maxR))) as [number, number, number, number];

  // Clamp adjacent corners so they don't overlap on the same edge.
  // Each edge's two corners (extended by smoothing) must not exceed the edge length.
  const s = Math.max(0, Math.min(1, smoothing));
  const extFactor = 1 + s * 0.55;
  const clampPair = (a: number, b: number, edgeLen: number): [number, number] => {
    const extA = a * extFactor;
    const extB = b * extFactor;
    if (extA + extB <= edgeLen) return [a, b];
    const ratio = edgeLen / (extA + extB);
    return [a * ratio, b * ratio];
  };
  [tl, tr] = clampPair(tl, tr, w);
  [tr, br] = clampPair(tr, br, h);
  [br, bl] = clampPair(br, bl, w);
  [bl, tl] = clampPair(bl, tl, h);

  // How far from the corner vertex the straight edge ends (> r when s > 0).
  const ext = (r: number) => Math.min(r * extFactor, maxR);
  // Bezier handle length for the arc (circle-arc approximation constant × r).
  const hnd = (r: number) => r * 0.5523;

  target.beginPath();
  target.moveTo(x + ext(tl), y);
  // Top edge →
  target.lineTo(x + w - ext(tr), y);
  // Top-right corner
  target.bezierCurveTo(
    x + w - ext(tr) + hnd(tr),
    y,
    x + w,
    y + ext(tr) - hnd(tr),
    x + w,
    y + ext(tr),
  );
  // Right edge ↓
  target.lineTo(x + w, y + h - ext(br));
  // Bottom-right corner
  target.bezierCurveTo(
    x + w,
    y + h - ext(br) + hnd(br),
    x + w - ext(br) + hnd(br),
    y + h,
    x + w - ext(br),
    y + h,
  );
  // Bottom edge ←
  target.lineTo(x + ext(bl), y + h);
  // Bottom-left corner
  target.bezierCurveTo(
    x + ext(bl) - hnd(bl),
    y + h,
    x,
    y + h - ext(bl) + hnd(bl),
    x,
    y + h - ext(bl),
  );
  // Left edge ↑
  target.lineTo(x, y + ext(tl));
  // Top-left corner
  target.bezierCurveTo(x, y + ext(tl) - hnd(tl), x + ext(tl) - hnd(tl), y, x + ext(tl), y);
  target.closePath();
}

/** Paint the primitive shape fill (without fillStyle). */
export function paintShapeFill(target: ReplayTarget, item: RenderItem): void {
  const p = item.primitive;
  switch (p.kind) {
    case 'rect':
      if (p.cornerRadius && p.cornerSmoothing && p.cornerSmoothing > 0) {
        traceSquirclePath(target, p.x, p.y, p.w, p.h, p.cornerRadius, p.cornerSmoothing);
        target.fill();
      } else if (p.cornerRadius && target.roundRect) {
        target.beginPath();
        target.roundRect(p.x, p.y, p.w, p.h, p.cornerRadius);
        target.fill();
      } else {
        target.fillRect(p.x, p.y, p.w, p.h);
      }
      break;
    case 'ellipse':
      target.beginPath();
      target.ellipse(p.cx, p.cy, p.rx, p.ry, 0, 0, TAU);
      target.fill();
      break;
    case 'circle':
      target.beginPath();
      target.arc(p.cx, p.cy, p.r, 0, TAU);
      target.fill();
      break;
    case 'line':
    case 'arrow':
      // Lines and arrows are stroke-only primitives; the fill pass intentionally
      // draws nothing here. The stroke pass renders the segment and arrowheads.
      break;
    case 'polygon': {
      target.beginPath();
      for (let i = 0; i < p.sides; i++) {
        const a = (2 * Math.PI * i) / p.sides - Math.PI / 2 + p.rotation;
        const px = p.cx + p.radius * Math.cos(a);
        const py = p.cy + p.radius * Math.sin(a);
        if (i === 0) target.moveTo(px, py);
        else target.lineTo(px, py);
      }
      target.closePath();
      target.fill();
      break;
    }
    case 'star': {
      target.beginPath();
      for (let i = 0; i < p.points * 2; i++) {
        const a = (Math.PI * i) / p.points - Math.PI / 2 + p.rotation;
        const r = i % 2 === 0 ? p.outerRadius : p.innerRadius;
        const px = p.cx + r * Math.cos(a);
        const py = p.cy + r * Math.sin(a);
        if (i === 0) target.moveTo(px, py);
        else target.lineTo(px, py);
      }
      target.closePath();
      target.fill();
      break;
    }
    case 'path':
      paintPathFill(target, p);
      break;
    case 'text':
      paintText(target, p);
      break;
    case 'table':
      paintTable(target, p);
      break;
    case 'rasterLayer':
      paintRasterLayer(target, p);
      break;
    case 'warpedImage':
      paintWarpedImage(target, p, (src) =>
        resolveReplayImage(src, imageLookupForCurrentReplay, getImageCache()),
      );
      break;
    default:
      break;
  }
}

/** Paint a closed/open path fill (supports optional hole rings via evenodd). */
function paintPathFill(
  target: ReplayTarget,
  p: {
    points: {
      x: number;
      y: number;
      handleIn: [number, number] | null;
      handleOut: [number, number] | null;
    }[];
    closed: boolean;
    tolerance: number;
    holes?: {
      x: number;
      y: number;
      handleIn: [number, number] | null;
      handleOut: [number, number] | null;
    }[][];
    fillRule?: 'nonzero' | 'evenodd';
  },
): void {
  const shape = { kind: 'path' as const, ...p };
  const rings = pathRings(shape);
  if (rings.length === 0) return;
  target.beginPath();
  for (const ring of rings) {
    tracePathRing(target, ring, true);
  }
  const fillRule = pathFillRule(shape);
  if (fillRule === 'evenodd') target.fill(fillRule);
  else target.fill();
}

/** Trace the outline of a primitive without filling. Covers all shape types
 * for use in clipping operations (inner shadow, image fill clips). */
export function traceOutline(target: ReplayTarget, p: RenderItem['primitive']): void {
  switch (p.kind) {
    case 'rect':
      if (p.cornerRadius && p.cornerSmoothing && p.cornerSmoothing > 0) {
        traceSquirclePath(target, p.x, p.y, p.w, p.h, p.cornerRadius, p.cornerSmoothing);
      } else if (p.cornerRadius && target.roundRect) {
        target.roundRect(p.x, p.y, p.w, p.h, p.cornerRadius);
      } else {
        target.rect(p.x, p.y, p.w, p.h);
      }
      break;
    case 'ellipse':
      target.ellipse(p.cx, p.cy, p.rx, p.ry, 0, 0, TAU);
      break;
    case 'circle':
      target.arc(p.cx, p.cy, p.r, 0, TAU);
      break;
    case 'line': {
      target.moveTo(p.from[0], p.from[1]);
      target.lineTo(p.to[0], p.to[1]);
      break;
    }
    case 'arrow': {
      target.moveTo(p.from[0], p.from[1]);
      target.lineTo(p.to[0], p.to[1]);
      break;
    }
    case 'polygon':
      for (let i = 0; i < p.sides; i++) {
        const a = (2 * Math.PI * i) / p.sides - Math.PI / 2 + p.rotation;
        const px = p.cx + p.radius * Math.cos(a);
        const py = p.cy + p.radius * Math.sin(a);
        if (i === 0) target.moveTo(px, py);
        else target.lineTo(px, py);
      }
      target.closePath();
      break;
    case 'star':
      for (let i = 0; i < p.points * 2; i++) {
        const a = (Math.PI * i) / p.points - Math.PI / 2 + p.rotation;
        const r = i % 2 === 0 ? p.outerRadius : p.innerRadius;
        const px = p.cx + r * Math.cos(a);
        const py = p.cy + r * Math.sin(a);
        if (i === 0) target.moveTo(px, py);
        else target.lineTo(px, py);
      }
      target.closePath();
      break;
    case 'path':
      tracePathRing(target, p.points, p.closed);
      for (const contour of p.contours?.slice(1) ?? p.holes ?? []) {
        tracePathRing(target, contour, true);
      }
      break;
    case 'text': {
      target.rect(p.x, p.y, p.w, p.h);
      break;
    }
    case 'rasterLayer': {
      target.rect(0, 0, p.width, p.height);
      break;
    }
    case 'warpedImage': {
      target.moveTo(p.quad[0][0], p.quad[0][1]);
      target.lineTo(p.quad[1][0], p.quad[1][1]);
      target.lineTo(p.quad[2][0], p.quad[2][1]);
      target.lineTo(p.quad[3][0], p.quad[3][1]);
      target.closePath();
      break;
    }
    default:
      break;
  }
}
