import type { FilterIR } from '../types';

/** Convert a single filter IR to a CSS filter string (Canvas2D fallback). */
export function filterToCss(filter: FilterIR): string | null {
  switch (filter.kind) {
    case 'brightness':
      return `brightness(${100 + filter.value}%)`;
    case 'contrast':
      return `contrast(${100 + filter.value}%)`;
    case 'saturation':
      return `saturate(${100 + filter.value}%)`;
    case 'hueRotate':
      return `hue-rotate(${filter.value}deg)`;
    case 'sepia':
      return `sepia(${filter.value}%)`;
    case 'grayscale':
      return `grayscale(${filter.value}%)`;
    case 'invert':
      return `invert(${filter.value}%)`;
    case 'opacity':
      return `opacity(${filter.value}%)`;
    case 'blur':
      return `blur(${filter.radius}px)`;
    case 'vibrance':
      // CSS has no vibrance equivalent. Returning an approximation here made
      // preview depend on browser CSS semantics while export used the distinct
      // software vibrance kernel, so this must take the reference path.
      return null;
    case 'exposure':
    case 'sharpen':
    case 'hueSaturation':
    case 'whiteBalance':
    case 'splitTone':
    case 'temperature':
    case 'tint':
    case 'levels':
    case 'curves':
    case 'selectiveColor':
    case 'colorBalance':
    case 'channelMixer':
    case 'photoFilter':
    case 'halftone':
    case 'gradientMap':
    case 'tritone':
    case 'colorHalftone':
    case 'duotone':
    case 'blackAndWhite':
    case 'posterize':
    case 'threshold':
      // No direct CSS equivalent; use identity or a placeholder.
      return null;
    case 'lut':
      return null; // LUT has no CSS equivalent; software-only
    case 'dither':
    case 'paletteSnap':
    case 'bloom':
    case 'rgbSplit':
    case 'crt':
    case 'vhs':
    case 'lightShafts':
    case 'lensFlare':
    case 'lightLeak':
    case 'caustics':
    case 'microDetail':
    case 'definition':
    case 'atmosphere':
    case 'dehaze':
    case 'edgeFalloff':
    case 'grain':
    case 'softBloom':
    case 'motionBlur':
    case 'mosaic':
    case 'surfaceSmooth':
    case 'edgeInk':
      return null; // Live effects are software kernels only; no CSS equivalent
    case 'chain':
      return filterChainToCss(filter.filters);
    default:
      return null;
  }
}

/** Compose a filter chain into one CSS filter string. */
export function filterChainToCss(filters: FilterIR[]): string | null {
  const parts = filters.map(filterToCss).filter((p): p is string => p !== null && p.length > 0);
  return parts.length > 0 ? parts.join(' ') : null;
}

/** True only when the runtime implements CanvasRenderingContext2D.filter. */
export function supportsCanvasFilter(target: object): target is { filter: string } {
  return 'filter' in target && typeof (target as { filter?: unknown }).filter === 'string';
}

/** Apply a filter chain to a Canvas2D context by setting ctx.filter. */
export function applyFilterChain(target: { filter: string }, filters: FilterIR[]): void {
  const css = filterChainToCss(filters);
  if (css) {
    target.filter = css;
  }
}
