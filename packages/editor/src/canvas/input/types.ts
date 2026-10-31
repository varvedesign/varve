/** Public input-pipeline contracts and the private active-pointer record (moved verbatim from canvas/inputPipeline.ts). */

import type { NodeId, SceneNode } from '@varve/scene';
import type { Camera } from '@varve/shared';
import type { MutableRefObject } from 'react';
import type { CanvasMode, EditorState } from '../../context/types';
import type { ToolContext, ToolManager } from '../../tools';
import type { NormalizedInputEvent } from '../../tools/inputNormalizer';
import type { SnapGuide } from '../../tools/snapping';
import type { CanvasViewportAnchor } from '../canvasSurface';

export interface UseCanvasInputsOptions {
  contentCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  /** Keyboard context-menu requests are normalized at the canvas boundary. */
  onContextMenu?: (request: {
    point: { readonly space: 'viewport'; readonly x: number; readonly y: number };
    contextElement: HTMLElement;
  }) => void;
  /** Cached canvas screen position (updated by ResizeObserver + pointerdown). */
  canvasRectRef: MutableRefObject<{ left: number; top: number }>;
  /** Synchronous refresh for input types that can arrive before an observer RAF. */
  refreshCanvasRect?: () => void;
  /** Latest client-space anchor used while a navigation/editing gesture is active. */
  viewportAnchorRef?: MutableRefObject<CanvasViewportAnchor | null>;
  editor: {
    setPan: (pan: { x: number; y: number }) => void;
    /** Relative scroll; resolves against the newest pan, not a snapshot. */
    panBy: (dx: number, dy: number) => void;
    setSelection: (id: NodeId | null) => void;
    exitIsolation: () => void;
    announceOperation: (op: string, detail: string) => void;
    announceSelection: (nodes: SceneNode[]) => void;
    announce: (msg: string) => void;
    registerCanvasInteractionCancellation: (sessionId: string, cancel: () => void) => () => void;
    commitTransaction: () => void;
    hitTestNode: (world: { x: number; y: number }) => { node: SceneNode } | null;
    getWorldBounds: (id: NodeId) => { x: number; y: number; w: number; h: number } | null;
    worldToCanvas: (wx: number, wy: number) => { x: number; y: number };
    revealSelection: (opts: { fit: boolean; viewport?: { width: number; height: number } }) => void;
    setCanvasMode?: (mode: CanvasMode) => void;
  };
  stateRef: MutableRefObject<EditorState>;
  tmRef: MutableRefObject<ToolManager | null>;
  buildToolCtx: (ev: PointerEvent, sourceEvents?: NormalizedInputEvent[]) => ToolContext;
  commitCamera: (cam: Camera) => void;
  previewCamera: (cam: Camera) => void;
  setSnapGuides: (guides: SnapGuide[]) => void;
  setHoveredNode: (node: SceneNode | null) => void;
  setRenameDialog: (v: { defaultValue: string } | null) => void;
  rootNodes: () => readonly SceneNode[];
  /** Shared snap session ref (from CanvasArea's buildToolCtx). If omitted, uses internal default. */
  snapSessionRef?: MutableRefObject<import('../../tools/snapping').SnapSession>;
  snapIndexRef?: MutableRefObject<{
    index: unknown;
    parentIndex: Map<string, string>;
    documentId: string;
  } | null>;
  /** Ref tracking whether the canvas element currently has focus.
   *  Used to let Tab/Shift+Tab pass through when focus arrives from outside. */
  canvasFocusedRef?: MutableRefObject<boolean>;
}

export interface UseCanvasInputsResult {
  handlePointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerCancel: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLCanvasElement>) => void;
  handleKeyUp: (e: React.KeyboardEvent<HTMLCanvasElement>) => void;
  handleDoubleClick: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onPointerLeave: () => void;
  onBlur: () => void;
  stopAutoPan: () => void;
}

interface CanvasPointerInteractionRecord {
  pointerId: number;
  toolManager: ToolManager;
  toolInstance: ToolManager['activeTool'];
  sessionId: string;
  generation: number;
  originalContext: ToolContext;
  isMiddlePan: boolean;
  closed: boolean;
}

export type { CanvasPointerInteractionRecord };
