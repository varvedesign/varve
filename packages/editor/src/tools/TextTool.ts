/**
 * TextTool — click for point text (auto-width), drag for text box (fixed-width).
 *
 * Click → enter edit mode immediately. Drag → create text box at size.
 * Escape exits edit → selects text object.
 * Double-click existing text → edit.
 *
 * Research basis: Figma Text (T), Illustrator Type (T).
 *
 * Note: Inline text editing requires contentEditable overlay integration.
 *       This implementation creates TextNodes and enters edit mode.
 *       Full rich-text editing is deferred to the editing overlay system.
 */

import { BaseTool } from './BaseTool';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

/**
 * Smallest text container a drag may produce, in world units. Sized from the
 * 16px default type: roughly three ems wide and one line tall, which is the
 * point below which the box has no room for a caret.
 */
const MIN_TEXT_BOX_WIDTH = 48;
const MIN_TEXT_BOX_HEIGHT = 23;

export class TextTool extends BaseTool {
  id = 'text' as const;

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'text' };
  }

  override onDragMove(ctx: ToolContext): void {
    const rect = this.computeDragRect(ctx);
    ctx.setDraft({
      kind: 'rect',
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      label: `Text ${Math.round(rect.w)} x ${Math.round(rect.h)}`,
    });
  }

  /**
   * Ctrl/Cmd+Enter begins editing the selected text layer, so a keyboard user
   * can go from "text selected" to "typing" without a double-click. Graphite
   * added the same entry point in GraphiteEditor/Graphite#4756 for the same
   * reason, where it also notes Ctrl+Enter works in its Select tool.
   *
   * Varve does not take plain Enter for this: the canvas already binds Enter
   * (and F2) to renaming the selected layer, which is a documented shortcut
   * users rely on. Ctrl+Enter adds the text path without removing that one, and
   * the tool runs before the rename branch, so the modifier decides which
   * action wins.
   *
   * A multi-selection is left alone: there is no single caret to place. An
   * already-editing target is left alone too, so a stray chord inside the
   * editor cannot re-enter and lose the caret position.
   */
  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key !== 'Enter' || e.repeat) return false;
    if (!e.ctrlKey && !e.metaKey) return false;
    if (ctx.selection.length !== 1) return false;
    const nodeId = ctx.selection[0]!;
    const node = ctx.getNode(nodeId);
    if (node?.kind !== 'text') return false;
    if (ctx.textEditTargetId === nodeId) return false;
    // Commit anything buffered first: the inline editor takes over the node,
    // and a draft left open would otherwise be applied to the new session.
    ctx.flushPendingEdits?.();
    ctx.commitTransaction();
    ctx.setTextEditTargetId(nodeId);
    return true;
  }

  override onDragEnd(ctx: ToolContext): void {
    ctx.setDraft(null);
    const rect = this.computeDragRect(ctx);
    const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    const parentId = this.commitToParent(center, ctx);

    if (this.isBelowThreshold(ctx)) {
      // While an inline text session is active, clicking another text object
      // switches sessions and lets TextEditOverlay drain its buffered draft.
      // In ordinary Text-tool use, keep clicks on existing artwork available
      // for placing a new text object nearby.
      if (ctx.textEditTargetId) {
        const hit = ctx.hitTest(this.drag.startWorld);
        if (hit?.node.kind === 'text') {
          // Flush the old session before closing any open creation transaction.
          // The save drain commits React updates synchronously, so the previous
          // node is durable in history before the new editor receives focus.
          ctx.flushPendingEdits?.();
          ctx.commitTransaction();
          ctx.setSelection(hit.nodeId);
          ctx.setTextEditTargetId(hit.nodeId);
          return;
        }
      }
      ctx.createTextNodeAt(this.drag.startWorld, undefined, parentId, '');
      return;
    }
    // A drag along a single axis is still a request for a text box. The
    // threshold above is per-axis, so a purely horizontal sweep cleared it
    // while leaving `rect.h` at zero — the old `w > 0 && h > 0` guard then
    // dropped the gesture and created nothing at all, with no feedback. Clamp
    // instead: a container smaller than one line of type cannot be typed into
    // or clicked anyway.
    ctx.createTextNodeAt(
      { x: rect.x, y: rect.y },
      { w: Math.max(rect.w, MIN_TEXT_BOX_WIDTH), h: Math.max(rect.h, MIN_TEXT_BOX_HEIGHT) },
      parentId,
      '',
    );
  }

  override onDragCancel(ctx: ToolContext): void {
    ctx.setDraft(null);
  }
}
