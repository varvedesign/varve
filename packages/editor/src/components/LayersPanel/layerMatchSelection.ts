import type { Document, NodeId } from '@varve/scene';
import type { LayerFilterSpec } from './layerFilterTypes';
import { isFiltering, nodeMatchesNonSearch } from './layerFilterTypes';
import type { FlatEntry } from './useFlatTree';

/**
 * Rows in a filtered projection that genuinely match the active filter.
 *
 * A filtered tree includes each match's ancestors so the result stays in
 * context. Those ancestors are not results: selecting the whole projection
 * selected nonmatching parents too, so one matching child counted as `1 of N`
 * and then broadened every following operation. This keeps result membership
 * separate from projection membership.
 */
export function selectMatchingEntryIds(
  entries: FlatEntry[],
  filterSpec: LayerFilterSpec,
  doc: Document,
  searchMatchedIds: ReadonlySet<NodeId> | undefined,
  animatedNodes: ReadonlySet<NodeId>,
): NodeId[] {
  if (!isFiltering(filterSpec)) return entries.map((entry) => entry.node.id);

  const animatedIds = filterSpec.attributes.animated === true ? animatedNodes : undefined;
  const ids: NodeId[] = [];
  for (const entry of entries) {
    if (filterSpec.search && searchMatchedIds?.has(entry.node.id) !== true) continue;
    if (!nodeMatchesNonSearch(entry.node, filterSpec, { doc, animatedIds })) continue;
    ids.push(entry.node.id);
  }
  return ids;
}
