import { imageLookupForCurrentReplay, replayIr } from '../replay';
import type { ReplayTarget } from '../replayTypes';
import type { RenderItem } from '../types';
import { rgba } from './color';
/**
 * Paint a compiled native table (ADR-0016 D3): cell fills, per-cell text
 * (pre-wrapped lines), inner dividers, and the outer border, clipped to the
 * table bounds. Deterministic and font-measurement-free at render time.
 */
export function paintTable(
  target: ReplayTarget,
  p: Extract<RenderItem['primitive'], { kind: 'table' }>,
): void {
  if (p.w <= 0 || p.h <= 0) return;
  target.save();

  const traceTablePath = (): void => {
    const radius = Math.max(0, p.cornerRadius);
    if (radius > 0 && target.roundRect) {
      target.roundRect(p.x, p.y, p.w, p.h, radius);
    } else {
      target.rect(p.x, p.y, p.w, p.h);
    }
  };

  traceTablePath();
  target.clip();

  for (const cell of p.cells) {
    target.fillStyle = rgba(cell.fill);
    target.fillRect(cell.x, cell.y, cell.w, cell.h);
    if (cell.border && cell.border.width > 0) {
      target.strokeStyle = rgba(cell.border.color);
      target.lineWidth = cell.border.width;
      target.strokeRect(cell.x, cell.y, cell.w, cell.h);
    }
  }

  for (const cell of p.cells) {
    const t = cell.text;
    if (!t || t.lines.length === 0) continue;
    target.fillStyle = rgba(t.color);
    target.font = `${t.fontStyle} ${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`;
    target.textBaseline = 'top';
    const pad = Math.max(0, t.padding);
    const lineH = t.fontSize * 1.35;
    const totalTextH = t.lines.length * lineH;
    let y = cell.y + pad;
    if (t.alignV === 'middle') y = cell.y + Math.max(pad, (cell.h - totalTextH) / 2);
    else if (t.alignV === 'bottom') y = cell.y + cell.h - pad - totalTextH;
    target.save();
    target.beginPath();
    target.rect(
      cell.x + pad,
      cell.y + pad,
      Math.max(0, cell.w - pad * 2),
      Math.max(0, cell.h - pad * 2),
    );
    target.clip();
    for (const line of t.lines) {
      if (t.alignH === 'center') {
        target.textAlign = 'center';
        target.fillText(line, cell.x + cell.w / 2, y);
      } else if (t.alignH === 'right') {
        target.textAlign = 'right';
        target.fillText(line, cell.x + cell.w - pad, y);
      } else {
        target.textAlign = 'left';
        target.fillText(line, cell.x + pad, y);
      }
      y += lineH;
    }
    target.restore();
  }

  // Rich scene content (images, components, groups) rendered inside the
  // cell, clipped to the padded cell rect. The item is already in
  // cell-local coordinates; translate the target to the cell origin.
  for (const cell of p.cells) {
    const content = cell.content;
    if (!content) continue;
    const pad = Math.max(0, cell.w > 0 && cell.h > 0 ? 0 : 0);
    target.save();
    try {
      target.translate(cell.x, cell.y);
      target.beginPath();
      target.rect(pad, pad, Math.max(0, cell.w - pad * 2), Math.max(0, cell.h - pad * 2));
      target.clip();
      replayIr(target, [content], imageLookupForCurrentReplay ?? undefined);
    } finally {
      target.restore();
    }
  }

  // Inner dividers sit at the shared track edges (collapse semantics).
  // Merged cells suppress the dividers that would otherwise cut through
  // them: a divider segment is skipped when a cell with a span covers it.
  if (p.dividerWidth > 0) {
    target.fillStyle = rgba(p.dividerColor);
    const half = p.dividerWidth / 2;
    const hasSpans = p.cells.some((c) => c.rowSpan > 1 || c.columnSpan > 1);
    if (!hasSpans) {
      // Fast path (no merged cells — the common case): draw every divider
      // full-length like the original implementation, one rect per track.
      for (let i = 1; i < p.colPositions.length - 1; i++) {
        const x = p.colPositions[i]!;
        target.fillRect(x - half, p.y, p.dividerWidth, p.h);
      }
      for (let i = 1; i < p.rowPositions.length - 1; i++) {
        const y = p.rowPositions[i]!;
        target.fillRect(p.x, y - half, p.w, p.dividerWidth);
      }
    } else {
      // Span path: precompute the covered divider segments ONCE (a cell with
      // a span suppresses the dividers running through it), then draw the
      // remaining segments. O(spans × area) up front, O(1) per segment.
      const colCovered = new Set<string>();
      const rowCovered = new Set<string>();
      for (const c of p.cells) {
        for (let rr = c.rowIdx; rr < c.rowIdx + c.rowSpan; rr++) {
          for (let cc = c.columnIdx + 1; cc < c.columnIdx + c.columnSpan; cc++) {
            colCovered.add(`${cc},${rr}`);
          }
        }
        for (let cc = c.columnIdx; cc < c.columnIdx + c.columnSpan; cc++) {
          for (let rr = c.rowIdx + 1; rr < c.rowIdx + c.rowSpan; rr++) {
            rowCovered.add(`${rr},${cc}`);
          }
        }
      }
      for (let i = 1; i < p.colPositions.length - 1; i++) {
        const x = p.colPositions[i]!;
        for (let r = 0; r < p.rowPositions.length - 1; r++) {
          if (colCovered.has(`${i},${r}`)) continue;
          const y0 = p.rowPositions[r]!;
          const y1 = p.rowPositions[r + 1]!;
          if (y1 <= y0) continue;
          target.fillRect(x - half, y0, p.dividerWidth, y1 - y0);
        }
      }
      for (let i = 1; i < p.rowPositions.length - 1; i++) {
        const y = p.rowPositions[i]!;
        for (let c = 0; c < p.colPositions.length - 1; c++) {
          if (rowCovered.has(`${i},${c}`)) continue;
          const x0 = p.colPositions[c]!;
          const x1 = p.colPositions[c + 1]!;
          if (x1 <= x0) continue;
          target.fillRect(x0, y - half, x1 - x0, p.dividerWidth);
        }
      }
    }
  }

  if (p.borderWidth > 0) {
    target.strokeStyle = rgba(p.borderColor);
    target.lineWidth = p.borderWidth;
    traceTablePath();
    target.stroke();
  }

  target.restore();
}
