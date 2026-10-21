/** Resolved auto-grid lines shared by the overlay and snapping adapters. */
import { computeGridLayoutDetailed } from '@varve/layout';
import type { Document, FrameNode } from '@varve/scene';
import { textMeasureRevision } from '@varve/shared';

export interface AutoGridLine {
  id: string;
  axis: 'vertical' | 'horizontal';
  start: { x: number; y: number };
  end: { x: number; y: number };
}

// The document and frame are immutable scene values. Share one resolved line
// model between the overlay and snapping throughout a scene/font revision;
// camera movement should not rerun track placement for the selected frame.
interface CachedLines {
  fontRevision: string;
  lines: AutoGridLine[];
}

const lineCache = new WeakMap<Document, WeakMap<FrameNode, CachedLines>>();

function cacheLines(doc: Document, frame: FrameNode, lines: AutoGridLine[]): AutoGridLine[] {
  let byFrame = lineCache.get(doc);
  if (!byFrame) {
    byFrame = new WeakMap<FrameNode, CachedLines>();
    lineCache.set(doc, byFrame);
  }
  byFrame.set(frame, { fontRevision: textMeasureRevision(), lines });
  return lines;
}

/**
 * Reuse the placement solver's resolved tracks, including empty tracks. Guide
 * definitions are intentionally absent: they have their own geometry model.
 */
export function resolveAutoGridLines(doc: Document, frame: FrameNode): AutoGridLine[] {
  if (frame.layoutStyle?.mode !== 'grid') return [];
  const cached = lineCache.get(doc)?.get(frame);
  if (cached?.fontRevision === textMeasureRevision()) return cached.lines;
  const result = computeGridLayoutDetailed(
    doc,
    frame.id,
    frame.w,
    frame.h,
    frame.layoutStyle,
    frame.children ?? [],
  );
  if (result.diagnostic || !result.tracks) return cacheLines(doc, frame, []);

  const lines: AutoGridLine[] = [];
  const seen = new Set<string>();
  const add = (axis: AutoGridLine['axis'], coordinate: number, id: string) => {
    const key = `${axis}:${coordinate.toFixed(6)}`;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push({
      id,
      axis,
      start: axis === 'vertical' ? { x: coordinate, y: 0 } : { x: 0, y: coordinate },
      end: axis === 'vertical' ? { x: coordinate, y: frame.h } : { x: frame.w, y: coordinate },
    });
  };
  for (const track of result.tracks.columns) {
    add('vertical', track.start, `column:${track.id ?? track.index}:start`);
    add('vertical', track.end, `column:${track.id ?? track.index}:end`);
  }
  for (const track of result.tracks.rows) {
    add('horizontal', track.start, `row:${track.id ?? track.index}:start`);
    add('horizontal', track.end, `row:${track.id ?? track.index}:end`);
  }
  return cacheLines(doc, frame, lines);
}
