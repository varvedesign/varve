import type { Document, GridItemPlacement, GridTrack, LayoutStyle, NodeId } from '@varve/scene';
import { applyGridLayout, computeGridLayout, parseGridTrackDefinitions } from './computeGridLayout';

export type GridTrackAxis = 'columns' | 'rows';
const MAX_GRID_TRACKS = 128;
const MAX_TRACK_ID_LENGTH = 256;

function templateFor(style: LayoutStyle, axis: GridTrackAxis): string {
  return axis === 'columns' ? (style.gridTemplateColumns ?? '') : (style.gridTemplateRows ?? '');
}

function tracksFor(style: LayoutStyle, axis: GridTrackAxis): GridTrack[] | undefined {
  return axis === 'columns' ? style.gridColumnTracks : style.gridRowTracks;
}

function withTracks(style: LayoutStyle, axis: GridTrackAxis, tracks: GridTrack[]): LayoutStyle {
  const template = tracks.map((track) => track.size).join(' ');
  return axis === 'columns'
    ? { ...style, gridColumnTracks: tracks, gridTemplateColumns: template || undefined }
    : { ...style, gridRowTracks: tracks, gridTemplateRows: template || undefined };
}

export function ensureGridTrackIdentities(style: LayoutStyle, frameId: NodeId): LayoutStyle | null {
  const columns = initializeGridTracks(style, 'columns', frameId);
  const rows = initializeGridTracks(style, 'rows', frameId);
  if (!columns || !rows) return null;
  return withTracks(withTracks(style, 'columns', columns), 'rows', rows);
}

/** Convert index placements to identity anchors before a structural track edit. */
export function anchorGridPlacements(
  doc: Document,
  frameId: NodeId,
  style: LayoutStyle,
): Record<NodeId, GridItemPlacement> {
  const frame = doc.nodes[frameId];
  if (frame?.kind !== 'frame') return {};
  const columns = style.gridColumnTracks ?? [];
  const rows = style.gridRowTracks ?? [];
  const placements: Record<NodeId, GridItemPlacement> = {};
  for (const childId of frame.children) {
    const child = doc.nodes[childId];
    const original = child?.gridPlacement;
    if (!child || !original) continue;
    const next = { ...original };
    let changed = false;
    for (const axis of ['columns', 'rows'] as const) {
      const startKey = axis === 'columns' ? 'gridColumnStart' : 'gridRowStart';
      const endKey = axis === 'columns' ? 'gridColumnEnd' : 'gridRowEnd';
      const idKey = axis === 'columns' ? 'gridColumnStartTrackId' : 'gridRowStartTrackId';
      const spanKey = axis === 'columns' ? 'gridColumnSpan' : 'gridRowSpan';
      const tracks = axis === 'columns' ? columns : rows;
      const explicit = original[startKey] != null || original[idKey] != null;
      if (!explicit) continue;
      const start = original[idKey]
        ? tracks.findIndex((track) => track.id === original[idKey])
        : (original[startKey] ?? 1) - 1;
      if (start < 0 || start >= tracks.length) continue;
      const span = original[spanKey] ?? Math.max(1, (original[endKey] ?? start + 2) - (start + 1));
      next[idKey] = tracks[start]?.id;
      next[spanKey] = span;
      changed = true;
    }
    if (changed) placements[childId] = next;
  }
  return placements;
}

/** Assigns stable local identities when an existing template is first edited. */
export function initializeGridTracks(
  style: LayoutStyle,
  axis: GridTrackAxis,
  frameId: NodeId,
): GridTrack[] | null {
  const existing = tracksFor(style, axis);
  if (existing) {
    if (existing.length > MAX_GRID_TRACKS) return null;
    const ids = new Set<string>();
    for (const track of existing) {
      if (
        typeof track.id !== 'string' ||
        !track.id.trim() ||
        track.id.length > MAX_TRACK_ID_LENGTH ||
        ids.has(track.id) ||
        typeof track.size !== 'string' ||
        parseGridTrackDefinitions(track.size)?.length !== 1
      ) {
        return null;
      }
      ids.add(track.id);
    }
    return existing.map((track) => ({ ...track }));
  }
  const definitions = parseGridTrackDefinitions(templateFor(style, axis));
  if (definitions === null) return null;
  const prefix = axis === 'columns' ? 'column' : 'row';
  return definitions.map((size, index) => ({ id: `grid-${frameId}-${prefix}-${index + 1}`, size }));
}

export function createGridTrack(
  style: LayoutStyle,
  axis: GridTrackAxis,
  frameId: NodeId,
  size = '1fr',
  index?: number,
): LayoutStyle | null {
  const definitions = parseGridTrackDefinitions(size);
  const current = initializeGridTracks(style, axis, frameId);
  if (definitions?.length !== 1 || !current || current.length >= MAX_GRID_TRACKS) return null;
  const prefix = axis === 'columns' ? 'column' : 'row';
  let sequence = current.length + 1;
  let id = `grid-${frameId}-${prefix}-${sequence}`;
  const ids = new Set(current.map((track) => track.id));
  while (ids.has(id)) id = `grid-${frameId}-${prefix}-${++sequence}`;
  const next = [...current];
  const target = Math.max(0, Math.min(index ?? next.length, next.length));
  next.splice(target, 0, { id, size: definitions[0]! });
  return withTracks(style, axis, next);
}

export function resizeGridTrack(
  style: LayoutStyle,
  axis: GridTrackAxis,
  frameId: NodeId,
  trackId: string,
  size: string,
): LayoutStyle | null {
  const definitions = parseGridTrackDefinitions(size);
  const current = initializeGridTracks(style, axis, frameId);
  if (definitions?.length !== 1 || !current?.some((track) => track.id === trackId)) {
    return null;
  }
  return withTracks(
    style,
    axis,
    current.map((track) => (track.id === trackId ? { ...track, size: definitions[0]! } : track)),
  );
}

export function reorderGridTrack(
  style: LayoutStyle,
  axis: GridTrackAxis,
  frameId: NodeId,
  trackId: string,
  targetIndex: number,
  placements: GridItemPlacement[] = [],
): LayoutStyle | null {
  const current = initializeGridTracks(style, axis, frameId);
  const from = current?.findIndex((track) => track.id === trackId) ?? -1;
  if (!current || from < 0 || !Number.isInteger(targetIndex)) return null;
  const to = Math.max(0, Math.min(targetIndex, current.length - 1));
  const next = [...current];
  const [track] = next.splice(from, 1);
  if (!track) return null;
  next.splice(to, 0, track);

  // A start-track identity plus a span length represents one contiguous set
  // of tracks. Refuse reorders that would change the members of that set.
  const startKey = axis === 'columns' ? 'gridColumnStart' : 'gridRowStart';
  const endKey = axis === 'columns' ? 'gridColumnEnd' : 'gridRowEnd';
  const idKey = axis === 'columns' ? 'gridColumnStartTrackId' : 'gridRowStartTrackId';
  const spanKey = axis === 'columns' ? 'gridColumnSpan' : 'gridRowSpan';
  const positions = new Map(next.map((item, index) => [item.id, index]));
  for (const placement of placements) {
    const startId = placement[idKey];
    const hasAxisPlacement =
      startId != null || placement[startKey] != null || placement[endKey] != null;
    if (!hasAxisPlacement) continue;
    const originalStart = startId
      ? current.findIndex((item) => item.id === startId)
      : Math.max(0, (placement[startKey] ?? 1) - 1);
    if (originalStart < 0 || originalStart >= current.length) return null;
    const span =
      placement[spanKey] ??
      Math.max(1, (placement[endKey] ?? originalStart + 2) - (originalStart + 1));
    if (!Number.isSafeInteger(span) || span < 1 || originalStart + span > current.length)
      return null;
    const members = current.slice(originalStart, originalStart + span).map((item) => item.id);
    const movedStart = positions.get(members[0]!);
    if (
      movedStart == null ||
      members.some((member, offset) => positions.get(member) !== movedStart + offset)
    ) {
      return null;
    }
  }
  return withTracks(style, axis, next);
}

export interface GridTrackRehome {
  nodeId: NodeId;
  before: GridItemPlacement;
  after: GridItemPlacement;
}

export interface GridTrackRemovalPreview {
  valid: boolean;
  style: LayoutStyle;
  placements: Record<NodeId, GridItemPlacement>;
  rehomes: GridTrackRehome[];
  resolvedDocument: Document;
}

const MAX_PREVIEW_TRACKS = MAX_GRID_TRACKS;
const MAX_PREVIEW_CHILDREN = 4096;
const MAX_PREVIEW_CELL_VISITS = 262_144;

function validCellRange(
  start: number,
  span: number,
  otherStart: number,
  otherSpan: number,
): boolean {
  return (
    [start, span, otherStart, otherSpan].every(Number.isSafeInteger) &&
    start >= 0 &&
    otherStart >= 0 &&
    span >= 1 &&
    otherSpan >= 1 &&
    start + span <= MAX_PREVIEW_TRACKS &&
    otherStart + otherSpan <= MAX_PREVIEW_TRACKS &&
    span * otherSpan <= MAX_PREVIEW_CELL_VISITS
  );
}

function boundedCellKeys(
  axis: GridTrackAxis,
  start: number,
  span: number,
  otherStart: number,
  otherSpan: number,
  budget: { remaining: number },
): string[] | null {
  if (!validCellRange(start, span, otherStart, otherSpan) || span * otherSpan > budget.remaining) {
    return null;
  }
  budget.remaining -= span * otherSpan;
  const keys: string[] = [];
  for (let primary = start; primary < start + span; primary++) {
    for (let secondary = otherStart; secondary < otherStart + otherSpan; secondary++) {
      keys.push(axis === 'columns' ? `${primary},${secondary}` : `${secondary},${primary}`);
    }
  }
  return keys;
}

/** Preview a track deletion and deterministic child rehoming without mutating the input document. */
export function previewRemoveGridTrack(
  doc: Document,
  frameId: NodeId,
  axis: GridTrackAxis,
  trackId: string,
): GridTrackRemovalPreview | null {
  const frame = doc.nodes[frameId];
  if (frame?.kind !== 'frame' || frame.layoutStyle?.mode !== 'grid') return null;
  if (frame.children.length > MAX_PREVIEW_CHILDREN) return null;
  const style = ensureGridTrackIdentities(frame.layoutStyle, frameId);
  if (!style) return null;
  const current = initializeGridTracks(style, axis, frameId);
  const removedIndex = current?.findIndex((track) => track.id === trackId) ?? -1;
  if (!current || removedIndex < 0 || current.length <= 1) return null;
  const nextTracks = current.filter((track) => track.id !== trackId);
  const nextStyle = withTracks(style, axis, nextTracks);
  const placements: Record<NodeId, GridItemPlacement> = {};
  const rehomes: GridTrackRehome[] = [];
  const startKey = axis === 'columns' ? 'gridColumnStart' : 'gridRowStart';
  const endKey = axis === 'columns' ? 'gridColumnEnd' : 'gridRowEnd';
  const idKey = axis === 'columns' ? 'gridColumnStartTrackId' : 'gridRowStartTrackId';
  const spanKey = axis === 'columns' ? 'gridColumnSpan' : 'gridRowSpan';
  const otherAxis: GridTrackAxis = axis === 'columns' ? 'rows' : 'columns';
  const otherTracks = initializeGridTracks(style, otherAxis, frameId) ?? [];
  const otherStartKey = axis === 'columns' ? 'gridRowStart' : 'gridColumnStart';
  const otherEndKey = axis === 'columns' ? 'gridRowEnd' : 'gridColumnEnd';
  const otherIdKey = axis === 'columns' ? 'gridRowStartTrackId' : 'gridColumnStartTrackId';
  const otherSpanKey = axis === 'columns' ? 'gridRowSpan' : 'gridColumnSpan';
  const occupied = new Set<string>();
  const cellBudget = { remaining: MAX_PREVIEW_CELL_VISITS };
  const deferred: Array<{
    nodeId: NodeId;
    before: GridItemPlacement;
    placement: GridItemPlacement;
    start: number;
    span: number;
    otherStart: number;
    otherSpan: number;
  }> = [];
  const cellKeys = (start: number, span: number, otherStart: number, otherSpan: number) =>
    boundedCellKeys(axis, start, span, otherStart, otherSpan, cellBudget);
  const reserve = (keys: string[] | null) => {
    if (!keys || keys.some((key) => occupied.has(key))) return false;
    for (const key of keys) occupied.add(key);
    return true;
  };
  for (const childId of frame.children) {
    const child = doc.nodes[childId];
    const placement = child?.gridPlacement;
    if (!child || !placement) continue;
    if (
      placement[startKey] == null &&
      placement[endKey] == null &&
      placement[idKey] == null &&
      placement[spanKey] == null
    ) {
      continue;
    }
    const idIndex: number = placement[idKey]
      ? current.findIndex((track) => track.id === placement[idKey])
      : -1;
    const start: number = idIndex >= 0 ? idIndex : Math.max(0, (placement[startKey] ?? 1) - 1);
    const span = placement[spanKey] ?? Math.max(1, (placement[endKey] ?? start + 2) - (start + 1));
    const otherIdIndex = placement[otherIdKey]
      ? otherTracks.findIndex((track) => track.id === placement[otherIdKey])
      : -1;
    if (
      (placement[idKey] != null && idIndex < 0) ||
      (placement[otherIdKey] != null && otherIdIndex < 0)
    ) {
      return { valid: false, style: nextStyle, placements: {}, rehomes: [], resolvedDocument: doc };
    }
    const otherStart =
      otherIdIndex >= 0 ? otherIdIndex : Math.max(0, (placement[otherStartKey] ?? 1) - 1);
    const otherSpan =
      placement[otherSpanKey] ??
      Math.max(1, (placement[otherEndKey] ?? otherStart + 2) - (otherStart + 1));
    if (!validCellRange(start, span, otherStart, otherSpan)) {
      return { valid: false, style: nextStyle, placements: {}, rehomes: [], resolvedDocument: doc };
    }
    const before = { ...placement };
    const startTrackRemoved =
      (placement[idKey] != null && placement[idKey] === trackId) ||
      (placement[idKey] == null && start === removedIndex);
    const nextStart = start - (removedIndex < start ? 1 : 0);
    let nextSpan =
      removedIndex >= start && removedIndex < start + span ? Math.max(1, span - 1) : span;
    if (startTrackRemoved)
      deferred.push({ nodeId: childId, before, placement, start, span, otherStart, otherSpan });
    else {
      nextSpan = Math.min(nextSpan, nextTracks.length - nextStart);
      const after = {
        ...placement,
        [startKey]: nextStart + 1,
        [endKey]: nextStart + nextSpan + 1,
        [idKey]: nextTracks[nextStart]?.id,
        [spanKey]: nextSpan,
      } as GridItemPlacement;
      placements[childId] = after;
      if (!reserve(cellKeys(nextStart, nextSpan, otherStart, otherSpan))) {
        return {
          valid: false,
          style: nextStyle,
          placements: {},
          rehomes: [],
          resolvedDocument: doc,
        };
      }
      if (JSON.stringify(before) !== JSON.stringify(after))
        rehomes.push({ nodeId: childId, before, after });
    }
  }

  for (const item of deferred) {
    const span = Math.min(Math.max(1, item.span - 1), nextTracks.length);
    const candidates: number[] = [];
    for (let distance = 0; distance < nextTracks.length; distance++) {
      const following = removedIndex + distance;
      const preceding = removedIndex - 1 - distance;
      if (following + span <= nextTracks.length) candidates.push(following);
      if (preceding >= 0 && preceding + span <= nextTracks.length) candidates.push(preceding);
    }
    const nextStart = candidates.find((candidate) =>
      cellKeys(candidate, span, item.otherStart, item.otherSpan)?.every(
        (key) => !occupied.has(key),
      ),
    );
    if (nextStart == null) {
      return { valid: false, style: nextStyle, placements: {}, rehomes: [], resolvedDocument: doc };
    }
    const after = {
      ...item.placement,
      [startKey]: nextStart + 1,
      [endKey]: nextStart + span + 1,
      [idKey]: nextTracks[nextStart]?.id,
      [spanKey]: span,
    } as GridItemPlacement;
    placements[item.nodeId] = after;
    if (!reserve(cellKeys(nextStart, span, item.otherStart, item.otherSpan))) {
      return { valid: false, style: nextStyle, placements: {}, rehomes: [], resolvedDocument: doc };
    }
    rehomes.push({ nodeId: item.nodeId, before: item.before, after });
  }

  const nodes = { ...doc.nodes, [frameId]: { ...frame, layoutStyle: nextStyle } };
  for (const [childId, placement] of Object.entries(placements)) {
    const child = nodes[childId];
    if (child) nodes[childId] = { ...child, gridPlacement: placement };
  }
  const candidate = { ...doc, nodes };
  const results = computeGridLayout(
    candidate,
    frameId,
    frame.w,
    frame.h,
    nextStyle,
    frame.children,
  );
  const flowCount = frame.children.filter((id) => {
    const node = candidate.nodes[id];
    return node && node.layoutPosition !== 'absolute' && node.visible !== false;
  }).length;
  const valid = flowCount === 0 || results.length === flowCount;
  return {
    valid,
    style: nextStyle,
    placements,
    rehomes,
    resolvedDocument: valid ? applyGridLayout(candidate, frameId) : candidate,
  };
}
