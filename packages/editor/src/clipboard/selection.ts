/** Selection ordering and placed-world pose policy shared by copy and paste. */

import { activePageNodes, type Document, isContainer } from '@varve/scene';
import type { Affine } from '@varve/shared';

/**
 * Reuse the placed-world pose only for a same-document, same-page paste. A
 * missing page id from an older payload is intentionally insufficient in a
 * paged document because its world coordinates may belong to another page.
 */
export function canPreserveClipboardWorldPose(input: {
  sourceDocumentId: string | undefined;
  targetDocumentId: string;
  sourcePageId: string | undefined;
  targetPageId: string | undefined;
  targetIsPublishingPage: boolean;
  targetFrameSelected: boolean;
  items: readonly {
    rootIds: readonly string[];
    worldAnchors?: Readonly<Record<string, Affine>>;
  }[];
}): boolean {
  const samePage = input.targetIsPublishingPage
    ? Boolean(input.sourcePageId && input.targetPageId && input.sourcePageId === input.targetPageId)
    : input.sourcePageId === undefined;
  const anchorsValid = input.items.every((item) => {
    const anchors = item.worldAnchors;
    return anchors
      ? item.rootIds.every((id) => {
          const anchor = anchors[id];
          return (
            Array.isArray(anchor) &&
            anchor.length === 6 &&
            anchor.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
          );
        })
      : true;
  });
  return (
    input.sourceDocumentId === input.targetDocumentId &&
    samePage &&
    !input.targetFrameSelected &&
    anchorsValid
  );
}
/**
 * Return selected roots in the document's paint/display order.
 *
 * Selection state records the order in which the user clicked layers. That
 * order is useful for announcing a selection, but it must not change the
 * sibling order or z-order when a multi-root selection is exported as SVG or
 * transferred to another document. The walk is iterative so a malformed or
 * unusually deep document cannot grow the call stack during a clipboard
 * gesture.
 */
export function orderClipboardRoots(doc: Document, ids: readonly string[]): string[] {
  const selected = new Set(ids.filter((id) => Boolean(doc.nodes[id])));
  if (selected.size < 2) return [...selected];

  const ordered: string[] = [];
  const seen = new Set<string>();
  const seeds = [...activePageNodes(doc)];
  const seeded = new Set(seeds);
  for (const id of doc.rootChildren) {
    if (!seeded.has(id)) {
      seeds.push(id);
      seeded.add(id);
    }
  }
  const pending = seeds.reverse();
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    const node = doc.nodes[id];
    if (!node) continue;
    seen.add(id);
    if (selected.has(id)) ordered.push(id);
    if (isContainer(node)) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        pending.push(node.children[index]!);
      }
    }
  }

  // Selected nodes can belong to an inactive page, a detached master, or a
  // legacy document whose roots are not exposed by activePageNodes(). Keep
  // those items rather than silently dropping them, using selection order only
  // as the deterministic fallback for nodes with no display projection.
  for (const id of ids) {
    if (selected.has(id) && !ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}
