/**
 * Pure-TS CSS Grid layout engine for FrameNode auto-layout.
 *
 * Supports explicit grids (gridTemplateColumns, gridTemplateRows with px/fr/auto),
 * implicit grids (gridAutoFlow: row/column), gap, padding, and explicit
 * gridPlacement (column/row start/end) on children.
 *
 * Research basis: CSS Grid Layout Module Level 1, Figma auto-layout grid.
 */
import type { Document, LayoutStyle, NodeId, SceneNode } from '@varve/scene';
import { axisSizing, isFlowParticipant, measureNodeFootprint, measureNodeSize } from './measure';
import { resizeNodeGeometry } from './resizeGeometry';

export interface GridItem {
  id: NodeId;
  x: number;
  y: number;
  w: number;
  h: number;
  occupiedW?: number;
  occupiedH?: number;
}

type TrackSize = { kind: 'px'; value: number } | { kind: 'fr'; value: number } | { kind: 'auto' };

const MAX_GRID_TRACKS = 128;
const MAX_GRID_CHILDREN = 4096;
const MAX_GRID_SPAN = 128;
const MAX_GRID_PLACEMENT_CELLS = 262_144;

interface ParsedTracks {
  tracks: TrackSize[];
  error?: string;
}

function parseSingleTrack(token: string): TrackSize | null {
  if (token === 'auto') return { kind: 'auto' };
  const match = /^(\d+(?:\.\d+)?|\.\d+)(px|fr)$/.exec(token);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || (match[2] === 'fr' && value <= 0)) return null;
  return match[2] === 'px' ? { kind: 'px', value } : { kind: 'fr', value };
}

/** Strict, bounded subset of CSS grid tracks. Unknown syntax never degrades to auto. */
function parseTrackTemplate(template: string): ParsedTracks {
  if (!template || template.trim() === '') return { tracks: [] };
  if (template.length > 16_384) return { tracks: [], error: 'template-too-long' };
  const parts: string[] = [];
  const tokenPattern = /\s*(repeat\s*\([^()]*\)|[^\s()]+)\s*/gy;
  let offset = 0;
  while (offset < template.length) {
    tokenPattern.lastIndex = offset;
    const match = tokenPattern.exec(template);
    if (!match || match.index !== offset) return { tracks: [], error: 'invalid-track-syntax' };
    offset = tokenPattern.lastIndex;
    const token = match[1]!;
    if (/^repeat\b/.test(token)) {
      const repeat = /^repeat\s*\(\s*(\d+)\s*,\s*([^()]*)\s*\)$/.exec(token);
      if (!repeat) return { tracks: [], error: 'unsupported-repeat' };
      const count = Number(repeat[1]);
      const repeatedTokens = repeat[2]!.trim().split(/\s+/).filter(Boolean);
      const repeated = repeatedTokens.map(parseSingleTrack);
      if (
        !Number.isSafeInteger(count) ||
        count < 1 ||
        repeated.length === 0 ||
        repeated.some((track) => track === null)
      ) {
        return { tracks: [], error: 'invalid-repeat' };
      }
      if (parts.length + repeated.length * count > MAX_GRID_TRACKS) {
        return { tracks: [], error: 'track-limit-exceeded' };
      }
      for (let i = 0; i < count; i++) parts.push(...repeatedTokens);
    } else {
      parts.push(token);
      if (parts.length > MAX_GRID_TRACKS) return { tracks: [], error: 'track-limit-exceeded' };
    }
  }
  const tracks = parts.map(parseSingleTrack);
  if (tracks.some((track) => track === null)) return { tracks: [], error: 'unsupported-track' };
  return { tracks: tracks as TrackSize[] };
}

/**
 * Parse a grid track definition like "100px 1fr auto 2fr".
 * Returns pixel values with fr units resolved proportionally and -1 for auto.
 */
export function parseGridTracks(template: string, availableSize: number, gap: number): number[] {
  const parsed = parseTrackTemplate(template);
  if (parsed.error) return [];
  const tracks = parsed.tracks;
  if (tracks.length === 0) return [];

  if (!Number.isFinite(availableSize) || !Number.isFinite(gap) || gap < 0) return [];

  const gapTotal = Math.max(0, tracks.length - 1) * gap;
  const fixedTotal = tracks.reduce((sum, t) => (t.kind === 'px' ? sum + t.value : sum), 0);
  const frTotal = tracks.reduce((sum, t) => (t.kind === 'fr' ? sum + t.value : sum), 0);
  const remaining = Math.max(0, availableSize - fixedTotal - gapTotal);
  const perFr = frTotal > 0 ? remaining / frTotal : 0;

  return tracks.map((t) => {
    switch (t.kind) {
      case 'px':
        return t.value;
      case 'fr':
        return perFr * t.value;
      case 'auto':
        return -1;
      default:
        return 0;
    }
  });
}

/** Return validated, expanded track tokens for typed track-editing commands. */
export function parseGridTrackDefinitions(template: string): string[] | null {
  const parsed = parseTrackTemplate(template);
  if (parsed.error) return null;
  return parsed.tracks.map((track) =>
    track.kind === 'auto' ? 'auto' : `${track.value}${track.kind}`,
  );
}

function childSize(n: SceneNode, includeBorders = false): { w: number; h: number } {
  return measureNodeSize(n, includeBorders);
}

interface CellAssignment {
  childIndex: number;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

function resolveGridTrackSizes(
  definitions: TrackSize[],
  children: SceneNode[],
  assignments: CellAssignment[],
  available: number,
  gap: number,
  isColumn: boolean,
  includeBorders: boolean,
): number[] {
  const sizes = definitions.map((track) => (track.kind === 'px' ? track.value : 0));
  const flexibleKinds = new Set<TrackSize['kind']>(['auto', 'fr']);

  // Intrinsic single-cell contributions establish track bases before any `fr`
  // space is distributed. A span contributes its unmet demand across flexible
  // tracks in that span without changing fixed pixel tracks.
  for (const assignment of assignments) {
    const child = children[assignment.childIndex];
    if (!child) continue;
    const intrinsic = childSize(child, includeBorders);
    const demand = isColumn ? intrinsic.w : intrinsic.h;
    const start = isColumn ? assignment.col : assignment.row;
    const span = isColumn ? assignment.colSpan : assignment.rowSpan;
    const indices = Array.from({ length: span }, (_, offset) => start + offset);
    const eligible = indices.filter((index) => flexibleKinds.has(definitions[index]?.kind ?? 'px'));
    if (eligible.length === 0) continue;
    const current = indices.reduce((sum, index) => sum + (sizes[index] ?? 0), 0) + (span - 1) * gap;
    const deficit = Math.max(0, demand - current);
    if (deficit === 0) continue;
    const share = deficit / eligible.length;
    for (const index of eligible) sizes[index] = (sizes[index] ?? 0) + share;
  }

  const frTotal = definitions.reduce(
    (sum, track) => sum + (track.kind === 'fr' ? track.value : 0),
    0,
  );
  if (frTotal > 0) {
    const gaps = Math.max(0, definitions.length - 1) * gap;
    const baseTotal = sizes.reduce((sum, size) => sum + size, 0);
    const free = Math.max(0, available - gaps - baseTotal);
    for (let index = 0; index < definitions.length; index++) {
      const track = definitions[index]!;
      if (track.kind === 'fr') sizes[index] = (sizes[index] ?? 0) + (free * track.value) / frTotal;
    }
  }

  return sizes;
}

function resolveLegacyAutoTracks(
  tracks: number[],
  children: SceneNode[],
  assignments: CellAssignment[],
  isColumn: boolean,
  includeBorders: boolean,
): number[] {
  return tracks.map((size, index) => {
    if (size !== -1) return size;
    let maxSize = 0;
    for (const assignment of assignments) {
      if ((isColumn ? assignment.col : assignment.row) !== index) continue;
      const child = children[assignment.childIndex];
      if (!child) continue;
      const intrinsic = childSize(child, includeBorders);
      maxSize = Math.max(maxSize, isColumn ? intrinsic.w : intrinsic.h);
    }
    return maxSize || 100;
  });
}

/**
 * Compute CSS Grid layout for a container's children.
 */
export function computeGridLayout(
  doc: Document,
  _parentId: NodeId,
  parentW: number,
  parentH: number,
  layoutStyle: LayoutStyle,
  children: NodeId[],
): GridItem[] {
  if (children.length === 0) return [];

  const [pt, pr, pb, pl] = layoutStyle.padding;
  const columnGap = layoutStyle.columnGap ?? layoutStyle.gap;
  const rowGap = layoutStyle.rowGap ?? layoutStyle.gap;
  const availW = Math.max(0, parentW - pl - pr);
  const availH = Math.max(0, parentH - pt - pb);
  const gridAutoFlow = layoutStyle.gridAutoFlow ?? 'row';

  const columnTemplate = layoutStyle.gridColumnTracks?.length
    ? layoutStyle.gridColumnTracks.map((track) => track.size).join(' ')
    : (layoutStyle.gridTemplateColumns ?? '');
  const rowTemplate = layoutStyle.gridRowTracks?.length
    ? layoutStyle.gridRowTracks.map((track) => track.size).join(' ')
    : (layoutStyle.gridTemplateRows ?? '');
  const parsedColumns = parseTrackTemplate(columnTemplate);
  const parsedRows = parseTrackTemplate(rowTemplate);
  const columnTrackIds = layoutStyle.gridColumnTracks?.map((track) => track.id);
  const rowTrackIds = layoutStyle.gridRowTracks?.map((track) => track.id);
  if (
    parsedColumns.error ||
    parsedRows.error ||
    (columnTrackIds && new Set(columnTrackIds).size !== columnTrackIds.length) ||
    (rowTrackIds && new Set(rowTrackIds).size !== rowTrackIds.length) ||
    (columnTrackIds && columnTrackIds.length !== parsedColumns.tracks.length) ||
    (rowTrackIds && rowTrackIds.length !== parsedRows.tracks.length) ||
    children.length > MAX_GRID_CHILDREN ||
    !Number.isFinite(columnGap) ||
    !Number.isFinite(rowGap) ||
    columnGap < 0 ||
    rowGap < 0
  ) {
    return [];
  }
  const colDefinitions = parsedColumns.tracks;
  const rowDefinitions = parsedRows.tracks;
  const explicitCols: TrackSize[] = colDefinitions.length > 0 ? colDefinitions : [{ kind: 'auto' }];
  const explicitRows: TrackSize[] =
    rowDefinitions.length > 0 ? rowDefinitions : [{ kind: 'px', value: availH }];

  const childNodes = children
    .map((cid) => doc.nodes[cid])
    .filter((n): n is SceneNode => n !== undefined && isFlowParticipant(n));

  const explicitPlacements: Array<{
    childIndex: number;
    colStart: number;
    colEnd: number;
    rowStart: number;
    rowEnd: number;
  }> = [];
  const autoFlowIndices: number[] = [];

  for (let i = 0; i < childNodes.length; i++) {
    const child = childNodes[i];
    if (!child) continue;
    const g = child.gridPlacement;
    if (
      g &&
      (g.gridColumnStart != null ||
        g.gridRowStart != null ||
        g.gridColumnStartTrackId != null ||
        g.gridRowStartTrackId != null)
    ) {
      const colIdIndex = g.gridColumnStartTrackId
        ? columnTrackIds?.indexOf(g.gridColumnStartTrackId)
        : undefined;
      const rowIdIndex = g.gridRowStartTrackId
        ? rowTrackIds?.indexOf(g.gridRowStartTrackId)
        : undefined;
      if (
        (g.gridColumnStartTrackId != null && (colIdIndex == null || colIdIndex < 0)) ||
        (g.gridRowStartTrackId != null && (rowIdIndex == null || rowIdIndex < 0))
      ) {
        return [];
      }
      const colStart = (colIdIndex ?? (g.gridColumnStart ?? 1) - 1) + 1;
      const rowStart = (rowIdIndex ?? (g.gridRowStart ?? 1) - 1) + 1;
      const colEnd = g.gridColumnEnd ?? colStart + (g.gridColumnSpan ?? 1);
      const rowEnd = g.gridRowEnd ?? rowStart + (g.gridRowSpan ?? 1);
      const colSpan = g.gridColumnSpan ?? colEnd - colStart;
      const rowSpan = g.gridRowSpan ?? rowEnd - rowStart;
      if (
        ![colStart, rowStart, colEnd, rowEnd].every(Number.isSafeInteger) ||
        colStart < 1 ||
        rowStart < 1 ||
        colSpan < 1 ||
        rowSpan < 1 ||
        colSpan > MAX_GRID_SPAN ||
        rowSpan > MAX_GRID_SPAN ||
        colStart > MAX_GRID_TRACKS ||
        rowStart > MAX_GRID_TRACKS ||
        colEnd > MAX_GRID_TRACKS + 1 ||
        rowEnd > MAX_GRID_TRACKS + 1
      ) {
        return [];
      }
      explicitPlacements.push({
        childIndex: i,
        colStart,
        colEnd,
        rowStart,
        rowEnd,
      });
    } else {
      autoFlowIndices.push(i);
    }
  }

  // Bound placement bookkeeping before allocating any cell map.
  const placementWork = explicitPlacements.reduce((sum, p) => {
    return sum + (p.colEnd - p.colStart) * (p.rowEnd - p.rowStart);
  }, 0);
  if (placementWork > MAX_GRID_PLACEMENT_CELLS) return [];

  // Build grid placement matrix
  const usedCells = new Set<string>();
  const assignments: CellAssignment[] = [];
  let placementChecks = placementWork;

  for (const ep of explicitPlacements) {
    const cs = ep.colStart - 1;
    const ce = ep.colEnd - 1;
    const rs = ep.rowStart - 1;
    const re = ep.rowEnd - 1;
    const colSpan = Math.max(1, ce - cs);
    const rowSpan = Math.max(1, re - rs);
    for (let c = cs; c < cs + colSpan; c++) {
      for (let r = rs; r < rs + rowSpan; r++) {
        const cell = `${c},${r}`;
        if (usedCells.has(cell)) return [];
        usedCells.add(cell);
      }
    }
    assignments.push({ childIndex: ep.childIndex, col: cs, row: rs, colSpan, rowSpan });
  }

  // Auto-flow remaining items
  if (gridAutoFlow === 'column' || gridAutoFlow === 'columnDense') {
    let col = 0;
    let row = 0;
    for (const idx of autoFlowIndices) {
      if (gridAutoFlow === 'columnDense') {
        let found = false;
        for (let c = 0; !found; c++) {
          for (let r = 0; r <= Math.max(row, explicitRows.length - 1); r++) {
            if (++placementChecks > MAX_GRID_PLACEMENT_CELLS) return [];
            if (!usedCells.has(`${c},${r}`)) {
              col = c;
              row = r;
              found = true;
              break;
            }
          }
        }
      } else {
        while (usedCells.has(`${col},${row}`)) {
          row++;
          if (row >= Math.max(explicitRows.length, 1)) {
            row = 0;
            col++;
          }
        }
      }
      usedCells.add(`${col},${row}`);
      assignments.push({ childIndex: idx, col, row, colSpan: 1, rowSpan: 1 });
      row++;
      if (row >= Math.max(explicitRows.length, 1)) {
        row = 0;
        col++;
      }
    }
  } else {
    let col = 0;
    let row = 0;
    for (const idx of autoFlowIndices) {
      if (gridAutoFlow === 'rowDense') {
        let found = false;
        for (let r = 0; !found; r++) {
          for (let c = 0; c <= Math.max(col, explicitCols.length - 1); c++) {
            if (++placementChecks > MAX_GRID_PLACEMENT_CELLS) return [];
            if (!usedCells.has(`${c},${r}`)) {
              col = c;
              row = r;
              found = true;
              break;
            }
          }
        }
      } else {
        while (usedCells.has(`${col},${row}`)) {
          col++;
          if (col >= explicitCols.length) {
            col = 0;
            row++;
          }
        }
      }
      usedCells.add(`${col},${row}`);
      assignments.push({ childIndex: idx, col, row, colSpan: 1, rowSpan: 1 });
      col++;
      if (col >= explicitCols.length) {
        col = 0;
        row++;
      }
    }
  }

  let maxCol = explicitCols.length;
  let maxRow = explicitRows.length;
  for (const a of assignments) {
    maxCol = Math.max(maxCol, a.col + a.colSpan);
    maxRow = Math.max(maxRow, a.row + a.rowSpan);
  }
  if (maxCol > MAX_GRID_TRACKS || maxRow > MAX_GRID_TRACKS) return [];

  const usesIntrinsicTracks = layoutStyle.layoutSemanticsVersion === 2;
  const resolvedCols: TrackSize[] = [];
  for (let c = 0; c < maxCol; c++) {
    if (c < explicitCols.length) {
      resolvedCols.push(explicitCols[c] ?? { kind: 'auto' });
    } else {
      resolvedCols.push(colDefinitions[colDefinitions.length - 1] ?? { kind: 'auto' });
    }
  }

  const resolvedRows: TrackSize[] = [];
  for (let r = 0; r < maxRow; r++) {
    if (r < explicitRows.length) {
      resolvedRows.push(explicitRows[r] ?? { kind: 'auto' });
    } else {
      resolvedRows.push(rowDefinitions[rowDefinitions.length - 1] ?? { kind: 'auto' });
    }
  }

  const includeBorders = layoutStyle.includeBordersInLayout === true;
  let resolvedColSizes: number[];
  let resolvedRowSizes: number[];
  if (usesIntrinsicTracks) {
    resolvedColSizes = resolveGridTrackSizes(
      resolvedCols,
      childNodes,
      assignments,
      availW,
      columnGap,
      true,
      includeBorders,
    );
    resolvedRowSizes = resolveGridTrackSizes(
      resolvedRows,
      childNodes,
      assignments,
      availH,
      rowGap,
      false,
      includeBorders,
    );
  } else {
    const legacyCols = parseGridTracks(layoutStyle.gridTemplateColumns ?? '', availW, columnGap);
    const legacyRows = parseGridTracks(layoutStyle.gridTemplateRows ?? '', availH, rowGap);
    const colSizes = legacyCols.length > 0 ? legacyCols : [-1];
    const rowSizes = legacyRows.length > 0 ? legacyRows : [availH];
    while (colSizes.length < maxCol) colSizes.push(colSizes[colSizes.length - 1] ?? 100);
    while (rowSizes.length < maxRow) rowSizes.push(rowSizes[rowSizes.length - 1] ?? 100);
    resolvedColSizes = resolveLegacyAutoTracks(
      colSizes,
      childNodes,
      assignments,
      true,
      includeBorders,
    );
    resolvedRowSizes = resolveLegacyAutoTracks(
      rowSizes,
      childNodes,
      assignments,
      false,
      includeBorders,
    );
  }

  const colPositions: number[] = [pl];
  for (let c = 0; c < resolvedColSizes.length; c++) {
    const prev = colPositions[c] ?? 0;
    colPositions.push(prev + (resolvedColSizes[c] ?? 0) + columnGap);
  }

  const rowPositions: number[] = [pt];
  for (let r = 0; r < resolvedRowSizes.length; r++) {
    const prev = rowPositions[r] ?? 0;
    rowPositions.push(prev + (resolvedRowSizes[r] ?? 0) + rowGap);
  }

  const results: GridItem[] = [];
  for (const a of assignments) {
    const childId = childNodes[a.childIndex]?.id;
    if (!childId) continue;
    const footprint = measureNodeFootprint(childNodes[a.childIndex]!);
    const cw =
      resolvedColSizes.slice(a.col, a.col + a.colSpan).reduce((s, v) => s + v + columnGap, 0) -
      columnGap;
    const rh =
      resolvedRowSizes.slice(a.row, a.row + a.rowSpan).reduce((s, v) => s + v + rowGap, 0) - rowGap;
    results.push({
      id: childId,
      x: colPositions[a.col] ?? 0,
      y: rowPositions[a.row] ?? 0,
      w: Math.max(
        0,
        cw -
          (layoutStyle.includeBordersInLayout === true
            ? footprint.occupied.w - footprint.geometry.w
            : 0),
      ),
      h: Math.max(
        0,
        rh -
          (layoutStyle.includeBordersInLayout === true
            ? footprint.occupied.h - footprint.geometry.h
            : 0),
      ),
      ...(layoutStyle.includeBordersInLayout === true ? { occupiedW: cw, occupiedH: rh } : {}),
    });
  }

  return results;
}

/**
 * Apply computed grid layout to document children.
 */
export function applyGridLayout(doc: Document, parentId: NodeId): Document {
  if (!parentId) return doc;
  const parent = doc.nodes[parentId];
  if (parent?.kind !== 'frame') return doc;
  if (!parent.layoutStyle) return doc;
  if (parent.layoutStyle.mode !== 'grid') return doc;

  const childIds = parent.children;
  if (childIds.length === 0) return doc;

  const results = computeGridLayout(
    doc,
    parentId,
    parent.w,
    parent.h,
    parent.layoutStyle,
    childIds,
  );
  if (results.length === 0) return doc;

  const nodes = { ...doc.nodes };
  for (const r of results) {
    const child = nodes[r.id];
    if (child) {
      const current = measureNodeSize(child);
      const wantW = axisSizing(child, 'width') === 'fixed' ? current.w : r.w;
      const wantH = axisSizing(child, 'height') === 'fixed' ? current.h : r.h;
      let updated = child;
      if (Math.abs(current.w - wantW) > 0.001 || Math.abs(current.h - wantH) > 0.001) {
        updated = resizeNodeGeometry(updated, wantW, wantH);
      }
      const transform = child.transform;
      nodes[r.id] = {
        ...updated,
        transform: [transform[0], transform[1], transform[2], transform[3], r.x, r.y] as const,
      };
    }
  }
  return { ...doc, nodes };
}
