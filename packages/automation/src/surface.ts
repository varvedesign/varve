import type { Document } from '@varve/scene';

/**
 * Where new nodes go when a caller names no parent: the active page's content
 * root, or `null` (the document root) for a flat document. A headless session
 * has no workspace mode, so this is deterministic; the live editor may supply
 * its active surface instead, and every receipt reports the parent used.
 */
export function defaultInsertionParent(doc: Document): string | null {
  const pages = doc.pages;
  if (!pages || pages.length === 0) return null;
  const active = pages.find((page) => page.id === doc.activePageId) ?? pages[0];
  return active && doc.nodes[active.contentRoot] !== undefined ? active.contentRoot : null;
}
