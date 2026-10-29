import { pageBoundsInWorld } from '@varve/scene';

/**
 * Page trim snap targets for the shared multipage canvas (M6, ADR-0144):
 * the placed trim bounds of every page in the document, so nodes snap to
 * page edges on any page — not only the active page's trim at the origin.
 */
export function pageSnapTargets(
  doc: import('@varve/scene').Document,
): Array<{ x: number; y: number; w: number; h: number }> {
  const targets: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const page of doc.pages ?? []) {
    const bounds = pageBoundsInWorld(doc, page.id);
    if (bounds) targets.push(bounds);
  }
  return targets;
}
