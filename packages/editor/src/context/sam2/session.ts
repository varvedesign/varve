import { cachedImageDims, getImageCache } from '@varve/engine';
import { imageShapeSrc, type NodeId } from '@varve/scene';
import type { Sam2SourcePrompts } from '../../tools/sam2PromptCoordinates';
import { fingerprintImageData } from '../imageFingerprint';
import type { ObjectSelectionSession, ObjectSelectionSourcePrompts } from '../objectSelectionTypes';
import type { EditorState } from '../types';

export function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      return controller.signal;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}
export function currentNodeSource(node: import('@varve/scene').SceneNode | undefined): string {
  return node?.kind === 'shape' ? imageShapeSrc(node) : '';
}
export function isCurrentSelectionTarget(
  stateRef: React.MutableRefObject<EditorState>,
  documentId: string,
  nodeId: NodeId,
  node: import('@varve/scene').ShapeNode,
): boolean {
  const live = stateRef.current;
  return (
    live.document.id === documentId &&
    live.selection.length === 1 &&
    live.selection[0] === nodeId &&
    live.document.nodes[nodeId] === node
  );
}
export async function readImageSourceIdentity(
  src: string,
): Promise<{ width: number; height: number; fingerprint: string } | null> {
  if (typeof document === 'undefined') return null;
  try {
    const cache = getImageCache();
    cache.evict(src);
    const image = await cache.load(src);
    const { width, height } = cachedImageDims(image);
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    return { width, height, fingerprint: await fingerprintImageData(imageData) };
  } catch {
    return null;
  }
}
/**
 * Map backend/worker failures to user-facing messages (error taxonomy in
 * the object-selection docs). Never leak raw tensor/backtrace text.
 */
export function writeCurrentSam2Stage(
  stateRef: React.MutableRefObject<EditorState>,
  setState: React.Dispatch<React.SetStateAction<EditorState>>,
  nodeId: NodeId,
  status: 'preparing' | 'encoding' | 'decoding',
): void {
  const current = stateRef.current.objectSelectionSession;
  if (!current || current.nodeId !== nodeId) return;
  const elapsed = current.startedAt ? Math.max(0, Date.now() - current.startedAt) : undefined;
  const next = {
    ...current,
    status,
    error: undefined,
    stageTimingsMs:
      elapsed === undefined
        ? current.stageTimingsMs
        : { ...current.stageTimingsMs, [status]: elapsed },
  } as ObjectSelectionSession;
  stateRef.current = { ...stateRef.current, objectSelectionSession: next };
  setState((prev) => ({ ...prev, objectSelectionSession: next }));
}
/** Format score provenance without presenting a quality score as intent probability. */
export function formatSelectionScore(
  score: number,
  source: ObjectSelectionSession['confidenceSource'],
): string {
  if (source === 'predicted-iou' || source === 'model-iou') {
    return `predicted IoU score ${score.toFixed(2)}`;
  }
  if (source === 'stability') {
    return `stability score ${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
  }
  if (source === 'heuristic' || source === 'activation-heuristic') {
    return `heuristic score ${score.toFixed(2)}`;
  }
  return `score ${score.toFixed(2)}`;
}
export function cloneSourcePrompts(prompts: Sam2SourcePrompts): ObjectSelectionSourcePrompts {
  return {
    ...(prompts.points ? { points: prompts.points.map((point) => ({ ...point })) } : {}),
    ...(prompts.box ? { box: { ...prompts.box } } : {}),
  };
}
