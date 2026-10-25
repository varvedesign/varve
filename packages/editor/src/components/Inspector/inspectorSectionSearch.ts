import type { SectionId } from './sectionRegistry';

/**
 * Search vocabulary describes property language, not another navigation tree.
 * Section titles remain the source of truth for visible labels; these aliases
 * make a direct query such as "opacity" land in its owning section.
 */
const SECTION_SEARCH_TERMS: Partial<Record<SectionId, readonly string[]>> = {
  'position-size': ['position', 'size', 'width', 'height', 'rotation', 'transform', 'constraints'],
  'corner-radius': ['corner', 'radius', 'round', 'rounding'],
  layout: ['stack', 'grid', 'auto layout', 'padding', 'gap', 'alignment', 'clip content'],
  'layout-child': ['layout', 'child', 'hug', 'fill', 'fixed', 'absolute', 'sizing'],
  appearance: ['appearance', 'opacity', 'blend mode', 'visibility', 'compositing'],
  mask: ['mask', 'clip', 'alpha', 'luminance'],
  fills: ['fill', 'color', 'solid', 'gradient', 'image', 'paint', 'hex'],
  stroke: ['stroke', 'border', 'weight', 'line cap', 'line join', 'dash'],
  effects: ['effect', 'shadow', 'blur', 'background blur', 'drop shadow', 'inner shadow'],
  'smart-filters': ['filter', 'blur', 'brightness', 'contrast', 'saturation', 'hue'],
  typography: [
    'text',
    'font',
    'typeface',
    'line height',
    'letter spacing',
    'tracking',
    'alignment',
  ],
  'image-placement': ['image', 'fit', 'fill', 'scale', 'image position'],
  'image-crop': ['crop', 'bounds', 'trim'],
  'image-resolution': ['resolution', 'dpi', 'pixel', 'image size'],
  animation: ['animation', 'motion', 'timeline', 'playback'],
  component: ['component', 'instance', 'variant', 'override'],
  table: ['table', 'cell', 'column', 'row'],
  'table-cells': ['cell', 'table', 'row', 'column'],
  'table-columns': ['column', 'row', 'table', 'track'],
};

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Godot-style loose subsequence matching makes abbreviated queries useful. */
function isSubsequence(query: string, candidate: string): boolean {
  let cursor = 0;
  for (const character of candidate) {
    if (character === query[cursor]) cursor += 1;
    if (cursor === query.length) return true;
  }
  return query.length === 0;
}

export function matchesInspectorSectionQuery(id: SectionId, title: string, query: string): boolean {
  const terms = normalize(query).split(' ').filter(Boolean);
  if (terms.length === 0) return true;
  const candidates = [title, ...(SECTION_SEARCH_TERMS[id] ?? [])].map(normalize);
  return terms.every((term) => candidates.some((candidate) => isSubsequence(term, candidate)));
}
