import type { ParsedElement } from './shared';

/**
 * Inkscape stores the visible result of a live path effect in the standard SVG
 * `d` attribute, with the editable source and effect parameters in namespaced
 * metadata. Varve imports the visible path but does not retain that metadata.
 */
export const INKSCAPE_LIVE_PATH_EFFECT_WARNING =
  'Inkscape live path effects: the rendered SVG path is imported as editable geometry, but its original path and effect controls are not preserved.';

/** Report effect metadata once per file so the import result stays readable. */
export function collectUnsupportedSvgMetadata(root: ParsedElement): string[] {
  const pending = [root];
  while (pending.length > 0) {
    const element = pending.pop();
    if (!element) continue;

    const hasInkscapePathEffect = Object.entries(element.attrs).some(([name, value]) => {
      if (!value.trim()) return false;
      const separator = name.indexOf(':');
      if (separator < 0 || name.slice(0, separator).toLowerCase() !== 'inkscape') return false;
      const localName = name.slice(separator + 1).toLowerCase();
      return localName === 'path-effect' || localName === 'original-d';
    });
    if (hasInkscapePathEffect) return [INKSCAPE_LIVE_PATH_EFFECT_WARNING];

    pending.push(...element.children);
  }

  return [];
}
