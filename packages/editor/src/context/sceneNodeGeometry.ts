import type { Shape } from '@varve/engine';
import {
  addMask,
  type BooleanOpKind,
  createLiveBooleanDoc,
  type Document,
  defaultVectorMaskForNode,
  type FrameNode,
  isBooleanOperand,
  type MaskType,
  makeFrameNode,
  type SceneNode,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import { makePanelNode } from '../scene/panelLayout';
import type { KnifeCutOutcome, KnifeSelectionPatch } from './knifeCommand';
import type { ToolId } from './types';

export { divideFrameIntoPanels, joinPanels, renumberPanelsInFrame } from '../scene/panelLayout';

export type { AlignmentReference } from '../scene/selectionArrangement';
export {
  alignmentFeedbackForResult,
  alignmentPageBounds,
  alignmentSurfaceKindFor,
  alignSelectionInDocument,
  alignSelectionWithObbInDocument,
  commonAlignmentContainerBounds,
  distributeSelectionInDocument,
  distributionFeedbackForResult,
  resolveAlignmentSurface,
  tidySelectionInDocument,
} from '../scene/selectionArrangement';
export type { KnifeCutOutcome, KnifeCutState, KnifeSelectionPatch } from './knifeCommand';
export { runKnifeCut } from './knifeCommand';
export type { KnifeLine, KnifeSkip, KnifeSkipReason, KnifeSliceResult } from './knifeSlice';

/** Run a synchronous editor mutation as one transaction when no outer gesture owns it. */
export function runOwnedTransaction(
  transactionRef: { current: boolean },
  begin: () => void,
  commit: () => void,
  action: () => void,
): void {
  const ownsTransaction = !transactionRef.current;
  if (ownsTransaction) begin();
  action();
  if (ownsTransaction) commit();
}

/** Build the frame-tool node, including the canonical export-region preset. */
export function makeDrawingFrameNode(
  id: string,
  transform: Affine,
  size: { w?: number; h?: number } | undefined,
  exportRegion: boolean,
): SceneNode {
  const node = makeFrameNode(id, {
    name: exportRegion ? 'Export Region' : 'Node',
    frameRole: exportRegion ? 'exportRegion' : 'frame',
    transform,
    fill: exportRegion
      ? { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 }
      : { space: 'rgb' as const, r: 200, g: 200, b: 200, a: 255 },
    children: [],
    w: size?.w ?? 375,
    h: size?.h ?? 812,
    clipContent: exportRegion ? false : undefined,
  });
  if (!exportRegion) return node;
  return {
    ...node,
    presets: [
      {
        id: `${id}-export-1x`,
        format: 'png' as const,
        scale: { type: 'factor' as const, value: 1 },
        suffix: '',
        enabled: true,
      },
    ],
  } as FrameNode;
}

/**
 * Tools whose drag-create produces a container rather than a leaf shape.
 *
 * Panel shares the frame path on purpose: one node model, one factory, one
 * capture rule. What is panel-specific (paper conventions, outside border,
 * layout templates) lives in `scene/panelLayout.ts`.
 */
export function isContainerTool(tool: ToolId): boolean {
  return tool === 'frame' || tool === 'slice' || tool === 'panel';
}

/** Build the container node a frame-like tool creates, with its capture policy. */
export function makeContainerNodeForTool(
  tool: ToolId,
  id: string,
  transform: Affine,
  size: { w?: number; h?: number } | undefined,
): { node: SceneNode; captureSiblings: boolean } {
  if (tool === 'frame' || tool === 'slice') {
    const exportRegion = tool === 'slice';
    // Frame capture-on-draw must not run for a region: adopting the artwork it
    // is drawn over is the frame behaviour it exists to stop. A panel is a
    // frame, so drawing one over a rough captures that artwork and clips it.
    return {
      node: makeDrawingFrameNode(id, transform, size, exportRegion),
      captureSiblings: !exportRegion,
    };
  }
  if (tool === 'panel') {
    return { node: makePanelNode(id, transform, size), captureSiblings: true };
  }
  throw new Error(`makeContainerNodeForTool called for non-container tool: ${tool}`);
}

/** Resolve a selection into the live Boolean document operation, or reject it. */
export function createLiveBooleanForSelection(
  document: Document,
  selection: string[],
  operation: BooleanOpKind,
): ReturnType<typeof createLiveBooleanDoc> | null {
  const operands = selection
    .map((id) => document.nodes[id])
    .filter(
      (node): node is Extract<SceneNode, { kind: 'shape' | 'group' }> =>
        node !== undefined && isBooleanOperand(node),
    );
  if (operands.length < 2 || operands.length !== selection.length) return null;
  return createLiveBooleanDoc(
    document,
    operands.map((operand) => operand.id),
    operation,
  );
}

/** Resolve the default source and apply a mask to the selected target. */
export function addMaskForSelection(
  document: import('@varve/scene').Document,
  id: string,
  selection: string[],
  type: MaskType,
  sourceNodeId?: string,
): import('@varve/scene').Document {
  const container = document.nodes[id];
  if (!container) return document;

  const leafVectorMask = defaultVectorMaskForNode(container, document);
  if (leafVectorMask) return addMask(document, id, undefined, type, { vectorMask: leafVectorMask });

  if (container.kind !== 'adjustment' && !('children' in container)) return document;
  const children = 'children' in container ? container.children : [];
  const maskSource =
    sourceNodeId ??
    (container.kind === 'adjustment'
      ? selection.find((selectedId) => selectedId !== id && document.nodes[selectedId])
      : children.find((childId) => document.nodes[childId] !== undefined));
  if (!maskSource || !document.nodes[maskSource]) return document;
  return addMask(document, id, maskSource, type);
}

/** Commit a knife result atomically and publish its selection/announcement. */
export function applyKnifeCutOutcome(
  outcome: KnifeCutOutcome,
  begin: () => void,
  updateDocument: (
    updater: (document: import('@varve/scene').Document) => import('@varve/scene').Document,
  ) => void,
  commit: () => void,
  applyPatch: (patch: KnifeSelectionPatch) => void,
  announce: (message: string) => void,
): void {
  if (outcome.document) {
    begin();
    updateDocument(() => outcome.document as import('@varve/scene').Document);
    commit();
    outcome.patch && applyPatch(outcome.patch);
  }
  announce(outcome.announcement);
}

export {
  knifeRejectionFor,
  knifeSkipMessage,
  sliceDocumentWithKnife,
  splitPolygonByKnifeLine,
  splitPolylineByKnifeLine,
} from './knifeSlice';

// F4: default shape geometry per tool.
// Research basis: Figma/Illustrator default sizes for shape tools.
export function shapeForTool(tool: ToolId): Shape {
  switch (tool) {
    case 'rect':
      return { kind: 'rect', x: 0, y: 0, w: 100, h: 80 };
    case 'ellipse':
      return { kind: 'ellipse', cx: 50, cy: 40, rx: 50, ry: 40 };
    case 'polygon':
      return { kind: 'polygon', cx: 50, cy: 40, radius: 50, sides: 6, rotation: 0 };
    case 'star':
      return {
        kind: 'star',
        cx: 50,
        cy: 40,
        innerRadius: 20,
        outerRadius: 50,
        points: 5,
        rotation: 0,
      };
    case 'line':
      return { kind: 'line', from: [0, 0], to: [100, 0], tolerance: 3 };
    case 'arrow':
      return { kind: 'arrow', from: [0, 0], to: [100, 0], tolerance: 3, arrowheadSize: 10 };
    case 'pen':
    case 'pencil':
      return {
        kind: 'path',
        points: [{ x: 0, y: 0, handleIn: null, handleOut: null }],
        closed: false,
        tolerance: 3,
      };
    case 'text':
      return { kind: 'rect', x: 0, y: 0, w: 120, h: 32 };
    case 'frame':
    case 'panel':
    case 'slice':
      return { kind: 'rect', x: 0, y: 0, w: 200, h: 160 };
    case 'knife':
    case 'select':
    case 'hand':
    case 'zoom':
    case 'scale':
    case 'nodeEdit':
    case 'image':
    case 'eyedropper':
    case 'inspect':
    case 'booleanUnion':
    case 'booleanSubtract':
    case 'booleanIntersect':
    case 'booleanExclude':
    case 'shapeBuilder':
    case 'cloneStamp':
    case 'healBrush':
    case 'spotHeal':
    case 'patch':
    case 'dodgeBurn':
    case 'refineMask':
    case 'trimapEdit':
    case 'crop':
    case 'perspective':
    case 'paint':
    case 'eraser':
    case 'smudge':
    case 'liquify':
    case 'sam2Segment':
    case 'shape':
    case 'connector':
    case 'comment':
    case 'table':
      return { kind: 'rect', x: 0, y: 0, w: 480, h: 240 };
    case 'backgroundRemoval':
    case 'clone':
    case 'contentAwareFill':
    case 'lasso':
    case 'pixelLasso':
    case 'marquee':
    case 'ellipseMarquee':
    case 'warp':
    case 'selectionPaint':
    case 'pixelProbe':
    case 'magicWand':
    case 'floatingTransform':
    case 'selectionBoundary':
    case 'page':
      throw new Error(`shapeForTool called for non-drawing tool: ${tool}`);
    default: {
      const exhaustiveCheck: never = tool;
      throw new Error(`Unknown tool in shapeForTool: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Resize a node to world-space dimensions while preserving its local origin.
 * The implementation lives in `@varve/scene` so the editor and the automation
 * command layer share one definition of what a resize means.
 */
export { resizeSceneNode } from '@varve/scene';
