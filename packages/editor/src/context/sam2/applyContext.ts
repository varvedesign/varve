import type {
  AlphaMaskCombineMode,
  AreaSelection,
  EmbeddingCache,
  PromptedProviderPreference,
  Sam2Letterbox,
} from '@varve/engine';
import type { Document, NodeId } from '@varve/scene';
import type { CanvasAnnouncer } from '../../canvas/CanvasAnnouncer';
import type { Sam2SourcePrompts } from '../../tools/sam2PromptCoordinates';
import type { ObjectSelectionPreviewMode, ObjectSelectionSession } from '../objectSelectionTypes';
import type { PromptedWorkerTensor } from '../promptedSegmentationProvider';
import type { EditorState } from '../types';

/** Entry shape of the hook's embedding cache (type mirror of the hook's inline generic). */
export interface Sam2EmbeddingCacheEntry {
  nodeId: NodeId;
  src: string;
  providerId: string;
  embeddings: Record<string, PromptedWorkerTensor>;
  letterbox?: Sam2Letterbox;
  naturalW: number;
  naturalH: number;
  sourceFingerprint: string;
}

/** The values the hook's apply callback closes over (built per call, same deps). */
export interface Sam2ApplyContext {
  enabled: boolean;
  stateRef: React.MutableRefObject<EditorState>;
  setState: React.Dispatch<React.SetStateAction<EditorState>>;
  updateDoc: (fn: (doc: Document) => Document) => void;
  announcerRef: React.MutableRefObject<CanvasAnnouncer | null>;
  setAreaSelection?: (selection: AreaSelection | null) => void;
  writeTransientSession: (
    session: ObjectSelectionSession | null,
    extra?: Partial<EditorState>,
  ) => void;
  promptedProviderPreference: PromptedProviderPreference;
  generationRef: React.MutableRefObject<number>;
  abortRef: React.MutableRefObject<AbortController | null>;
  softDeadlineRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  embeddingCacheRef: React.MutableRefObject<EmbeddingCache<Sam2EmbeddingCacheEntry> | null>;
  previewModeRef: React.MutableRefObject<ObjectSelectionPreviewMode>;
}

/** The base apply callback's destructured parameters, named as in base. */
export interface Sam2ApplyParams {
  nodeId: NodeId;
  prompts: {
    points?: Array<{ x: number; y: number; label: 0 | 1 }>;
    box?: { x1: number; y1: number; x2: number; y2: number };
  };
  sourcePrompts?: Sam2SourcePrompts;
  externalSignal?: AbortSignal;
  operation: 'preview' | 'mask' | 'selection' | 'layer';
  candidateIndex?: number;
  combination: AlphaMaskCombineMode;
}

/** Values the base precheck computes once for every later phase. */
export interface Sam2Precheck {
  generation: number;
  currentDoc: Document;
  node: import('@varve/scene').ShapeNode;
  src: string;
  previousSession: ObjectSelectionSession | null;
  sameSessionTarget: boolean;
  isCommitOperation: boolean;
}

/**
 * The commit branch's view of the precheck: base line 557's condition
 * ("previousSession?.status === 'ready'") narrowed previousSession inside the
 * branch; runSam2Apply carries that narrowing across the split with a
 * structurally identical copy ({ ...pre, previousSession }).
 */
export type Sam2CommitPrecheck = Sam2Precheck & { previousSession: ObjectSelectionSession };

/** The failure-marker closure built during setup (base lines 1055-1073). */
export type Sam2MarkFailure = (failure: {
  code: string;
  message: string;
  retryable: boolean;
}) => void;

export type Sam2ApplyResult = {
  mask: Uint8Array;
  width: number;
  height: number;
  confidence: number;
} | null;
