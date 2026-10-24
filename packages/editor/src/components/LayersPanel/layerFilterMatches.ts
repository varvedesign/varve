/**
 * Which rows of a filtered Layers projection are matches.
 *
 * A filtered tree also shows the ancestors of every match, so the row list is
 * not the match list: searching "Button" inside a "Card" frame shows Card as
 * context. Stepping through matches, "Select matches", and the match count all
 * act on the rows that satisfy the filter themselves.
 */
import type { NodeId } from '@varve/scene';
import {
  isFiltering,
  type LayerFilterSpec,
  type NodeFilterContext,
  nodeMatchesFilter,
  nodeMatchesNonSearch,
} from './layerFilterTypes';
import type { FlatEntry } from './useFlatTree';

/**
 * The ids of rows that match the filter themselves, in row order, or
 * undefined when nothing is being filtered. `indexMatchedIds` is the set the
 * projection was built from for index-backed dimensions (name search, the
 * animated preset); the remaining dimensions are checked per node.
 */
export function ownFilterMatchIds(
  entries: readonly FlatEntry[],
  filter: LayerFilterSpec,
  indexMatchedIds: ReadonlySet<NodeId> | undefined,
  ctx: NodeFilterContext,
): NodeId[] | undefined {
  if (!isFiltering(filter)) return undefined;
  const ids: NodeId[] = [];
  for (const { node } of entries) {
    const matches = indexMatchedIds
      ? indexMatchedIds.has(node.id) && nodeMatchesNonSearch(node, filter, ctx)
      : nodeMatchesFilter(node, filter, ctx);
    if (matches) ids.push(node.id);
  }
  return ids;
}

/**
 * The match after (or before) `currentId`, wrapping at either end like
 * find-in-page. From a row that is not a match, the first match below it (or
 * above it, going back) is next; with no reference row, the first or last.
 */
export function stepMatchId(
  matchIds: readonly NodeId[],
  rowOrder: readonly NodeId[],
  currentId: NodeId | null | undefined,
  direction: 1 | -1,
): NodeId | undefined {
  if (matchIds.length === 0) return undefined;
  const first = direction === 1 ? matchIds[0] : matchIds[matchIds.length - 1];
  if (!currentId) return first;
  const at = matchIds.indexOf(currentId);
  if (at >= 0) return matchIds[(at + direction + matchIds.length) % matchIds.length];
  const row = rowOrder.indexOf(currentId);
  if (row < 0) return first;
  const matchRows = matchIds.map((id) => rowOrder.indexOf(id));
  if (direction === 1) {
    const next = matchRows.findIndex((r) => r > row);
    return next >= 0 ? matchIds[next] : first;
  }
  const previous = matchRows.findLastIndex((r) => r < row);
  return previous >= 0 ? matchIds[previous] : first;
}
