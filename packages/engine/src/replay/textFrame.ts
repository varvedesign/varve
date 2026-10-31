import type { ReplayTarget } from '../replayTypes';
import type { RenderItem } from '../types';
import { rgba } from './color';

/** Paint the text container before any glyphs, independently of glyph paint. */
export function paintTextFrame(
  target: ReplayTarget,
  item: RenderItem,
  itemAlpha: number,
  itemBlend: string,
): void {
  if (item.primitive.kind !== 'text') return;
  const p = item.primitive;
  const frame = p.textFrame;
  if (!frame) return;
  target.save();
  target.globalAlpha = itemAlpha;
  target.globalCompositeOperation = itemBlend;
  if (frame.fill) {
    target.fillStyle = rgba(frame.fill);
    target.fillRect(p.x, p.y, p.w, p.h);
  }
  const border = frame.border;
  if (border && Number.isFinite(border.width) && border.width > 0) {
    target.strokeStyle = rgba(border.color);
    target.lineWidth = border.width;
    target.lineDashOffset = 0;
    target.setLineDash([]);
    target.strokeRect(p.x, p.y, p.w, p.h);
  }
  target.restore();
}
