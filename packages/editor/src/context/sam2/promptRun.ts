import { getImageCache } from '@varve/engine';
import { prepareImageMaskMapper } from '../../tools/imageMaskCoordinates';
import {
  mergeSam2NormalizedPrompts,
  normalizeSam2Prompts,
  normalizeSourceSam2Prompts,
} from '../../tools/sam2PromptCoordinates';
import type { ObjectSelectionSession } from '../objectSelectionTypes';
import type {
  Sam2ApplyContext,
  Sam2ApplyParams,
  Sam2MarkFailure,
  Sam2Precheck,
} from './applyContext';
import { SAM2_SOFT_DEADLINE_MS } from './capabilities';
import { cloneSourcePrompts, combineAbortSignals } from './session';

export function setupSam2PromptRun(
  ctx: Sam2ApplyContext,
  params: Sam2ApplyParams,
  pre: Sam2Precheck,
): {
  combinedSignal: AbortSignal;
  promptSession: ObjectSelectionSession;
  markFailure: Sam2MarkFailure;
} | null {
  const {
    abortRef,
    announcerRef,
    generationRef,
    softDeadlineRef,
    stateRef,
    writeTransientSession,
  } = ctx;
  const { externalSignal, nodeId, prompts, sourcePrompts } = params;
  const { currentDoc, generation, previousSession, sameSessionTarget, src } = pre;
  abortRef.current?.abort();
  const controller = new AbortController();
  abortRef.current = controller;

  const combinedSignal = externalSignal
    ? combineAbortSignals(controller.signal, externalSignal)
    : controller.signal;

  if (combinedSignal.aborted) {
    announcerRef.current?.announce('Segmentation cancelled');
    return null;
  }

  const promptSession: ObjectSelectionSession = {
    ...(sameSessionTarget ? previousSession : null),
    nodeId,
    documentId: currentDoc.id,
    candidateSetId: `${currentDoc.id}:${nodeId}:${generation}`,
    width: 0,
    height: 0,
    candidates: [],
    rejectedCandidateCount: undefined,
    selectedCandidate: sameSessionTarget ? (previousSession?.selectedCandidate ?? 0) : 0,
    points: prompts.points ?? [],
    box: prompts.box ?? null,
    sourcePrompts: sourcePrompts ? cloneSourcePrompts(sourcePrompts) : undefined,
    draftPoint: null,
    draftBox: null,
    confidence: sameSessionTarget ? (previousSession?.confidence ?? 0) : 0,
    status: 'preparing',
    modelId: sameSessionTarget
      ? (previousSession?.modelId ?? 'sam2-hiera-tiny')
      : 'sam2-hiera-tiny',
    sourceLocator: src,
    sourceFingerprint: undefined,
    startedAt: Date.now(),
    slow: false,
    stageTimingsMs: {},
    error: undefined,
  };
  const markFailure = (failure: { code: string; message: string; retryable: boolean }): void => {
    // A superseded request may fail after a newer prompt has already
    // published its own session. Never turn that newer session into an
    // error or announce a stale failure.
    if (generation !== generationRef.current) return;
    if (softDeadlineRef.current !== null) {
      clearTimeout(softDeadlineRef.current);
      softDeadlineRef.current = null;
    }
    const live = stateRef.current.objectSelectionSession;
    if (live?.nodeId === nodeId && stateRef.current.document.id === currentDoc.id) {
      writeTransientSession({ ...live, status: 'error', error: failure });
    }
    announcerRef.current?.announce(failure.message);
  };
  writeTransientSession(promptSession, { maskPreviewMode: 'overlay' });
  announcerRef.current?.announce('Preparing object selection…');
  softDeadlineRef.current = setTimeout(() => {
    const live = stateRef.current.objectSelectionSession;
    if (
      live?.nodeId === nodeId &&
      stateRef.current.document.id === currentDoc.id &&
      live.status !== 'ready' &&
      live.status !== 'error'
    ) {
      writeTransientSession({ ...live, slow: true });
      announcerRef.current?.announce('Object selection is taking longer than expected.');
    }
  }, SAM2_SOFT_DEADLINE_MS);
  return { combinedSignal, promptSession, markFailure };
}

export type Sam2PromptRunSetup = NonNullable<ReturnType<typeof setupSam2PromptRun>>;

export async function prepareSam2PromptInputs(
  params: Sam2ApplyParams,
  pre: Sam2Precheck,
  setup: NonNullable<ReturnType<typeof setupSam2PromptRun>>,
): Promise<{
  img: HTMLImageElement | ImageBitmap;
  naturalW: number;
  naturalH: number;
  imageMapper: NonNullable<ReturnType<typeof prepareImageMaskMapper>>;
  normPrompts: ReturnType<typeof normalizeSam2Prompts>;
} | null> {
  const { combinedSignal, markFailure } = setup;
  const { prompts, sourcePrompts } = params;
  const { currentDoc, node, src } = pre;
  let img: HTMLImageElement | ImageBitmap | null = null;
  try {
    // A locator is not a content identity. Evict it before reading so a
    // document asset replaced behind the same handle cannot be hashed or
    // embedded from stale decoded pixels.
    getImageCache().evict(src);
    img = await getImageCache().load(src);
  } catch {
    markFailure({
      code: 'image_load_failed',
      message: 'Could not load the image pixels. Check the file or its permissions and try again.',
      retryable: true,
    });
    return null;
  }

  if (!img) {
    markFailure({
      code: 'image_load_failed',
      message: 'Could not load the image pixels. Check the file or its permissions and try again.',
      retryable: true,
    });
    return null;
  }

  if (combinedSignal.aborted) return null;

  const naturalW =
    typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement
      ? img.naturalWidth || img.width
      : img.width;
  const naturalH =
    typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement
      ? img.naturalHeight || img.height
      : img.height;

  if (
    !Number.isSafeInteger(naturalW) ||
    !Number.isSafeInteger(naturalH) ||
    naturalW <= 0 ||
    naturalH <= 0
  ) {
    markFailure({
      code: 'image_pixels_unavailable',
      message: 'The image has invalid dimensions and cannot be used for object selection.',
      retryable: true,
    });
    return null;
  }

  // Validate the user's geometry against the canonical image-placement
  // inverse before model lookup, memory probing, or a full-resolution
  // source allocation. A pointer outside the visible image is an input
  // error, not a reason to spend device resources and then fail late.
  const imageMapper = prepareImageMaskMapper({
    document: currentDoc,
    node,
    sourceWidth: naturalW,
    sourceHeight: naturalH,
  });
  if (!imageMapper) {
    markFailure({
      code: 'placement_invalid',
      message:
        'The image placement is not valid for object selection. Reset the image bounds and try again.',
      retryable: true,
    });
    return null;
  }
  const sourceNormalizedPrompts = sourcePrompts ? normalizeSourceSam2Prompts(sourcePrompts) : null;
  if (
    sourceNormalizedPrompts &&
    (sourceNormalizedPrompts.unmappedPointCount > 0 ||
      sourceNormalizedPrompts.unmappedBoxCornerCount > 0)
  ) {
    markFailure({
      code: 'invalid_prompt_geometry',
      message:
        'The automated selection prompt has invalid source-image geometry. Run discovery again.',
      retryable: true,
    });
    return null;
  }
  const mappedPrompts = normalizeSam2Prompts(prompts, imageMapper, naturalW, naturalH);
  const normPrompts = sourceNormalizedPrompts
    ? mergeSam2NormalizedPrompts(sourceNormalizedPrompts, mappedPrompts)
    : mappedPrompts;
  if (normPrompts.unmappedPointCount > 0 || normPrompts.unmappedBoxCornerCount > 0) {
    const unmappedParts = [
      normPrompts.unmappedPointCount > 0
        ? `${normPrompts.unmappedPointCount} point${normPrompts.unmappedPointCount === 1 ? '' : 's'}`
        : null,
      normPrompts.unmappedBoxCornerCount > 0
        ? `${normPrompts.unmappedBoxCornerCount} box corner${normPrompts.unmappedBoxCornerCount === 1 ? '' : 's'}`
        : null,
    ].filter((part): part is string => part !== null);
    markFailure({
      code: 'prompt_out_of_bounds',
      message: `Object Selection could not map ${unmappedParts.join(' and ')} to visible image pixels. Place every prompt inside the image and try again.`,
      retryable: true,
    });
    return null;
  }
  if (
    !normPrompts.points?.length &&
    (!normPrompts.box ||
      normPrompts.box.x2 <= normPrompts.box.x1 ||
      normPrompts.box.y2 <= normPrompts.box.y1)
  ) {
    markFailure({
      code: 'invalid_prompt_geometry',
      message: 'Object Selection needs a point or a box with positive area.',
      retryable: true,
    });
    return null;
  }
  if (!normPrompts.box && !(normPrompts.points ?? []).some((point) => point.label === 1)) {
    markFailure({
      code: 'positive_prompt_required',
      message:
        'Add an include point or a box before running Object Selection; exclude points only refine an identified object.',
      retryable: true,
    });
    return null;
  }
  return { img, naturalW, naturalH, imageMapper, normPrompts };
}

export type Sam2PromptInputs = NonNullable<Awaited<ReturnType<typeof prepareSam2PromptInputs>>>;
