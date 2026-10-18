import type { Effect, ManagedColor } from '@varve/scene';
import { type ParsedElement, parseCssStyle, parseSvgColor } from './shared';

export interface SvgFilterImportResult {
  effects: Effect[];
  unsupportedFeatures: string[];
}

const MAX_FILTER_LENGTH = 4096;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * Import one common SVG filter primitive into Varve's editable drop-shadow
 * effect, while reporting fidelity details Varve cannot represent. Other
 * primitives remain explicit unsupported features.
 */
export function importSvgFilter(filter: ParsedElement, scale: number): SvgFilterImportResult {
  // The SVG default is userSpaceOnUse. objectBoundingBox primitive lengths are
  // relative to each target node's bounds, which this shared filter parser
  // cannot resolve without changing the scene geometry contract.
  if (
    filter.tag !== 'filter' ||
    filter.children.length !== 1 ||
    (filter.attrs.primitiveUnits !== undefined &&
      filter.attrs.primitiveUnits !== 'userSpaceOnUse') ||
    !Number.isFinite(scale) ||
    scale <= 0
  ) {
    return unsupportedFilter();
  }

  const primitive = filter.children[0];
  if (primitive?.tag !== 'feDropShadow') return unsupportedFilter();

  const style = parseCssStyle(primitive.attrs.style ?? '');
  const deviation = parseDeviation(primitive.attrs.stdDeviation ?? '2');
  const dx = parseLength(primitive.attrs.dx ?? '2');
  const dy = parseLength(primitive.attrs.dy ?? '2');
  const floodOpacity = parseOpacity(
    style['flood-opacity'] ?? primitive.attrs['flood-opacity'] ?? '1',
  );
  const floodColor = parseSvgColor(
    style['flood-color'] ?? primitive.attrs['flood-color'] ?? 'black',
  );

  if (
    !deviation ||
    deviation[0] !== deviation[1] ||
    dx === null ||
    dy === null ||
    floodOpacity === null ||
    !floodColor ||
    Math.abs(dx * scale) > MAX_FILTER_LENGTH ||
    Math.abs(dy * scale) > MAX_FILTER_LENGTH ||
    deviation[0] * scale > MAX_FILTER_LENGTH
  ) {
    return unsupportedFilter();
  }

  const unsupportedFeatures: string[] = [];
  // SVG filters have a filter region even when the document uses the defaults.
  // Varve effects expand beyond the object and do not apply the SVG region clip.
  unsupportedFeatures.push('SVG filter clipping region');
  // SVG defines stdDeviation as a Gaussian sigma; Varve's drop-shadow blur is
  // a Canvas shadowBlur value. Preserve the numeric intent as a useful edit,
  // but never represent this conversion as pixel-identical.
  unsupportedFeatures.push('SVG feDropShadow blur semantics');
  if (
    primitive.attrs.in ||
    primitive.attrs.result ||
    primitive.attrs['color-interpolation-filters'] ||
    filter.attrs['color-interpolation-filters']
  ) {
    unsupportedFeatures.push('SVG filter primitive compositing details');
  }

  const color: ManagedColor = floodColor;
  return {
    effects: [
      {
        type: 'dropShadow',
        x: dx * scale,
        y: dy * scale,
        // Keep the source numeric setting editable. The fidelity report above
        // calls out that Canvas shadowBlur is not SVG's Gaussian sigma.
        blur: deviation[0] * scale,
        spread: 0,
        color,
        opacity: floodOpacity,
        blendMode: 'normal',
        visible: true,
      },
    ],
    unsupportedFeatures,
  };
}

function parseDeviation(value: string): [number, number] | null {
  const parts = value
    .trim()
    .split(/[\s,]+/u)
    .filter(Boolean);
  if (parts.length < 1 || parts.length > 2) return null;
  const first = parseLength(parts[0] ?? '');
  const second = parts.length === 2 ? parseLength(parts[1] ?? '') : first;
  if (first === null || second === null || first < 0 || second < 0) return null;
  return [first, second];
}

function parseLength(value: string): number | null {
  const normalized = value.trim();
  if (!NUMBER.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && Math.abs(parsed) <= MAX_FILTER_LENGTH ? parsed : null;
}

function parseOpacity(value: string): number | null {
  const normalized = value.trim();
  if (normalized === '') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : null;
}

function unsupportedFilter(): SvgFilterImportResult {
  return { effects: [], unsupportedFeatures: ['SVG <filter> effects'] };
}
