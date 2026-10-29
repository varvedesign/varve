import type {
  AlphaMaskCombineMode,
  AreaSelection,
  PromptedProviderPreference,
  Sam2Letterbox,
} from '@varve/engine';
import { EmbeddingCache } from '@varve/engine';
import type { Document, NodeId } from '@varve/scene';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasAnnouncer } from '../canvas/CanvasAnnouncer';
import type { Sam2SourcePrompts } from '../tools/sam2PromptCoordinates';
import {
  type ObjectSelectionPreviewMode,
  type ObjectSelectionSession,
  objectSelectionCandidateReviewKey,
} from './objectSelectionTypes';
import type { PromptedWorkerTensor } from './promptedSegmentationProvider';
import { runSam2Apply } from './sam2/applyRun';
import { embeddingCacheBudgetBytes, embeddingCacheMaxEntries } from './sam2/capabilities';
import { currentNodeSource } from './sam2/session';
import type { EditorState } from './types';

export { embeddingCacheMaxEntries } from './sam2/capabilities';
export { mapPromptedRoutingFailure } from './sam2/errors';
export { buildMaskPayload } from './sam2/maskPayload';

export interface Sam2SegmentationAPI {
  applySam2Segmentation: (params: {
    nodeId: NodeId;
    prompts: {
      points?: Array<{ x: number; y: number; label: 0 | 1 }>;
      box?: { x1: number; y1: number; x2: number; y2: number };
    };
    /** Optional exact source-space prompts supplied by an automated detector. */
    sourcePrompts?: Sam2SourcePrompts;
    signal?: AbortSignal;
    operation: 'preview' | 'mask' | 'selection' | 'layer';
    candidateIndex?: number;
    /** How a `mask` commit combines with the mask already on the node. */
    combination?: AlphaMaskCombineMode;
  }) => Promise<{ mask: Uint8Array; width: number; height: number; confidence: number } | null>;
  cancelSam2Segmentation: () => void;
  selectSam2Candidate: (index: number) => void;
  /** Mark the currently selected model candidate as reviewed or unreviewed. */
  reviewSam2Candidate: (reviewed: boolean) => void;
  /** How the reviewed candidate is presented over the artwork. */
  setObjectSelectionPreviewMode: (mode: ObjectSelectionPreviewMode) => void;
  promptedProviderPreference: PromptedProviderPreference;
  setPromptedProviderPreference: (preference: PromptedProviderPreference) => void;
}

export function useSam2Segmentation(
  state: EditorState,
  stateRef: React.MutableRefObject<EditorState>,
  setState: React.Dispatch<React.SetStateAction<EditorState>>,
  updateDoc: (fn: (doc: Document) => Document) => void,
  announcerRef: React.MutableRefObject<CanvasAnnouncer | null>,
  enabled = true,
  setAreaSelection?: (selection: AreaSelection | null) => void,
): Sam2SegmentationAPI {
  const abortRef = useRef<AbortController | null>(null);
  const softDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const embeddingCacheRef = useRef<EmbeddingCache<{
    nodeId: NodeId;
    src: string;
    providerId: string;
    embeddings: Record<string, PromptedWorkerTensor>;
    // The letterbox transform the encoder's *own* preprocessing applied to
    // this image (scale-to-fit + center + pad for non-square images).
    // Prompt encoding must reuse this exact transform — see sam2.ts — so
    // it's cached alongside the embeddings it was computed from, not
    // recomputed from the image dimensions independently.
    letterbox?: Sam2Letterbox;
    naturalW: number;
    naturalH: number;
    sourceFingerprint: string;
  }> | null>(null);
  if (enabled && !embeddingCacheRef.current) {
    const budgetBytes = embeddingCacheBudgetBytes();
    embeddingCacheRef.current = new EmbeddingCache<{
      nodeId: NodeId;
      src: string;
      providerId: string;
      embeddings: Record<string, PromptedWorkerTensor>;
      // The letterbox transform the encoder's *own* preprocessing applied to
      // this image (scale-to-fit + center + pad for non-square images).
      // Prompt encoding must reuse this exact transform — see sam2.ts — so
      // it's cached alongside the embeddings it was computed from, not
      // recomputed from the image dimensions independently.
      letterbox?: Sam2Letterbox;
      naturalW: number;
      naturalH: number;
      sourceFingerprint: string;
    }>({
      maxEntries: embeddingCacheMaxEntries(budgetBytes),
      maxBytes: budgetBytes,
      estimateBytes: (entry) =>
        Object.values(entry.embeddings).reduce(
          (total, tensor) => total + tensor.data.byteLength,
          0,
        ),
    });
  }
  const [promptedProviderPreference, setPromptedProviderPreferenceState] =
    useState<PromptedProviderPreference>('auto');

  const writeTransientSession = useCallback(
    (session: ObjectSelectionSession | null, extra: Partial<EditorState> = {}): void => {
      stateRef.current = {
        ...stateRef.current,
        ...extra,
        objectSelectionSession: session,
      };
      setState((prev) => ({ ...prev, ...extra, objectSelectionSession: session }));
    },
    [setState, stateRef],
  );

  // Presentation preference survives cancellation and target changes; a new
  // session picks it up at publication instead of resetting to the default.
  const previewModeRef = useRef<ObjectSelectionPreviewMode>('overlay');
  const setObjectSelectionPreviewMode = useCallback(
    (mode: ObjectSelectionPreviewMode) => {
      previewModeRef.current = mode;
      const session = stateRef.current.objectSelectionSession;
      if (!session) return;
      writeTransientSession({ ...session, previewMode: mode });
    },
    [stateRef, writeTransientSession],
  );

  const cancelSam2Segmentation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (softDeadlineRef.current !== null) {
      clearTimeout(softDeadlineRef.current);
      softDeadlineRef.current = null;
    }
    generationRef.current += 1;
    writeTransientSession(null, { maskPreviewMode: 'none' });
  }, [writeTransientSession]);

  const setPromptedProviderPreference = useCallback(
    (preference: PromptedProviderPreference) => {
      if (preference === promptedProviderPreference) return;
      const session = stateRef.current.objectSelectionSession;
      if (
        session &&
        (session.status === 'preparing' ||
          session.status === 'encoding' ||
          session.status === 'decoding')
      ) {
        cancelSam2Segmentation();
      }
      setPromptedProviderPreferenceState(preference);
    },
    [cancelSam2Segmentation, promptedProviderPreference, stateRef],
  );

  const selectSam2Candidate = useCallback(
    (index: number) => {
      const session = stateRef.current.objectSelectionSession;
      const candidate = session?.candidates[index];
      if (!session || !candidate) return;
      writeTransientSession({
        ...session,
        selectedCandidate: index,
        confidence: candidate.confidence,
        reviewedCandidateKey: undefined,
        reviewedCandidateAt: undefined,
      });
    },
    [stateRef, writeTransientSession],
  );

  const reviewSam2Candidate = useCallback(
    (reviewed: boolean) => {
      const session = stateRef.current.objectSelectionSession;
      if (session?.status !== 'ready') return;
      const candidateKey = objectSelectionCandidateReviewKey(session, session.selectedCandidate, {
        verifyMask: true,
      });
      if (reviewed && !candidateKey) {
        announcerRef.current?.announce(
          'This Object Selection preview is too old to review safely. Create a new preview first.',
        );
        return;
      }
      writeTransientSession({
        ...session,
        reviewedCandidateKey: reviewed ? (candidateKey ?? undefined) : undefined,
        reviewedCandidateAt: reviewed ? Date.now() : undefined,
      });
      announcerRef.current?.announce(
        reviewed ? 'Object Selection target reviewed' : 'Object Selection target review cleared',
      );
    },
    [announcerRef, stateRef, writeTransientSession],
  );

  useEffect(() => {
    const session = stateRef.current.objectSelectionSession;
    if (!session) return;
    const selected = state.selection;
    if (
      (session.documentId && session.documentId !== state.document.id) ||
      selected.length !== 1 ||
      selected[0] !== session.nodeId ||
      (session.sourceLocator &&
        currentNodeSource(state.document.nodes[session.nodeId]) !== session.sourceLocator)
    ) {
      cancelSam2Segmentation();
    }
  }, [cancelSam2Segmentation, state.document, state.document.id, state.selection, stateRef]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      if (softDeadlineRef.current !== null) {
        clearTimeout(softDeadlineRef.current);
        softDeadlineRef.current = null;
      }
      generationRef.current += 1;
    };
  }, []);

  const applySam2Segmentation = useCallback(
    async ({
      nodeId,
      prompts,
      sourcePrompts,
      signal: externalSignal,
      operation,
      candidateIndex,
      combination = 'replace',
    }: {
      nodeId: NodeId;
      prompts: {
        points?: Array<{ x: number; y: number; label: 0 | 1 }>;
        box?: { x1: number; y1: number; x2: number; y2: number };
      };
      sourcePrompts?: Sam2SourcePrompts;
      signal?: AbortSignal;
      operation: 'preview' | 'mask' | 'selection' | 'layer';
      candidateIndex?: number;
      combination?: AlphaMaskCombineMode;
    }): Promise<{ mask: Uint8Array; width: number; height: number; confidence: number } | null> =>
      runSam2Apply(
        {
          enabled,
          stateRef,
          setState,
          updateDoc,
          announcerRef,
          setAreaSelection,
          writeTransientSession,
          promptedProviderPreference,
          generationRef,
          abortRef,
          softDeadlineRef,
          embeddingCacheRef,
          previewModeRef,
        },
        {
          nodeId,
          prompts,
          sourcePrompts,
          externalSignal,
          operation,
          candidateIndex,
          combination,
        },
      ),
    [
      enabled,
      stateRef,
      setState,
      updateDoc,
      announcerRef,
      setAreaSelection,
      writeTransientSession,
      promptedProviderPreference,
    ],
  );

  return {
    applySam2Segmentation,
    cancelSam2Segmentation,
    selectSam2Candidate,
    reviewSam2Candidate,
    setObjectSelectionPreviewMode,
    promptedProviderPreference,
    setPromptedProviderPreference,
  };
}
