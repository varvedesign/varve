import { prepareImageMaskMapper } from '../../tools/imageMaskCoordinates';
import {
  normalizeSam2Prompts,
  normalizeSourceSam2Prompts,
} from '../../tools/sam2PromptCoordinates';
import {
  type ObjectSelectionSession,
  objectSelectionCandidateReviewKey,
} from '../objectSelectionTypes';
import {
  rankPromptedMaskCandidates,
  validatePromptedMaskCandidate,
} from '../promptedMaskValidation';
import type { Sam2ApplyContext, Sam2ApplyParams, Sam2CommitPrecheck } from './applyContext';
import { buildMaskPayload, countMaskCoverage, maskMatchesDimensions } from './maskPayload';
import { isCurrentSelectionTarget, readImageSourceIdentity } from './session';

export async function validateReadySam2Commit(
  ctx: Sam2ApplyContext,
  params: Sam2ApplyParams,
  pre: Sam2CommitPrecheck,
): Promise<{
  candidateToCommit: ObjectSelectionSession['candidates'][number];
  maskPayload: Extract<Awaited<ReturnType<typeof buildMaskPayload>>, { ok: true }> | null;
} | null> {
  const { announcerRef, generationRef, stateRef, writeTransientSession } = ctx;
  const { candidateIndex, combination, externalSignal, nodeId, operation } = params;
  const { currentDoc, generation, node, previousSession, src } = pre;
  // A ready session is a visible, user-reviewable candidate set. Never
  // fall through to a fresh inference for an Apply/Use action: doing so
  // could commit a different mask than the one the user inspected, or
  // bypass review entirely when the preview metadata is incomplete.
  if (
    !previousSession.sourceFingerprint ||
    previousSession.width <= 0 ||
    previousSession.height <= 0
  ) {
    announcerRef.current?.announce(
      'This Object Selection preview is incomplete. Create a new preview before applying it.',
    );
    return null;
  }
  const selectedCandidate = candidateIndex ?? previousSession.selectedCandidate;
  const candidate = previousSession.candidates[selectedCandidate];
  if (!candidate) {
    announcerRef.current?.announce(
      'The selected Object Selection candidate is unavailable. Create a new preview before applying it.',
    );
    return null;
  }
  const requiredReviewKey = objectSelectionCandidateReviewKey(previousSession, selectedCandidate, {
    verifyMask: true,
  });
  if (!requiredReviewKey) {
    const live = stateRef.current.objectSelectionSession;
    if (generation === generationRef.current && live?.nodeId === nodeId) {
      writeTransientSession({
        ...live,
        status: 'error',
        error: {
          code: 'candidate_changed',
          message:
            'The reviewed Object Selection candidate changed after it was inspected. Create a new preview before applying it.',
          retryable: true,
        },
      });
    }
    const message =
      'The reviewed Object Selection candidate is invalid. Create a new preview before applying it.';
    announcerRef.current?.announce(message);
    return null;
  }
  if (!previousSession.reviewedCandidateKey) {
    announcerRef.current?.announce(
      'Review the highlighted Object Selection target before applying it. Choose the candidate you want, inspect the overlay, then confirm the review.',
    );
    return null;
  }
  if (previousSession.reviewedCandidateKey !== requiredReviewKey) {
    const live = stateRef.current.objectSelectionSession;
    if (generation === generationRef.current && live?.nodeId === nodeId) {
      writeTransientSession({
        ...live,
        status: 'error',
        error: {
          code: 'candidate_changed',
          message:
            'The reviewed Object Selection candidate changed after it was inspected. Create a new preview before applying it.',
          retryable: true,
        },
      });
    }
    announcerRef.current?.announce(
      'The reviewed Object Selection candidate changed after it was inspected. Create a new preview before applying it.',
    );
    return null;
  }
  const freshSource = await readImageSourceIdentity(src);
  if (generation !== generationRef.current || externalSignal?.aborted) return null;
  if (!isCurrentSelectionTarget(stateRef, currentDoc.id, nodeId, node)) {
    const live = stateRef.current;
    const sameSelectedNodeSlot =
      live.document.id === currentDoc.id &&
      live.selection.length === 1 &&
      live.selection[0] === nodeId &&
      live.document.nodes[nodeId] !== node;
    if (sameSelectedNodeSlot && live.objectSelectionSession?.nodeId === nodeId) {
      writeTransientSession({
        ...live.objectSelectionSession,
        status: 'error',
        error: {
          code: 'mapping_changed',
          message:
            'The image placement changed after the preview. Create a new preview before applying it.',
          retryable: true,
        },
      });
    }
    announcerRef.current?.announce(
      'The selected image changed after the preview. Create a new preview before applying it.',
    );
    return null;
  }
  if (
    !freshSource ||
    freshSource.width !== previousSession.width ||
    freshSource.height !== previousSession.height ||
    freshSource.fingerprint !== previousSession.sourceFingerprint
  ) {
    const live = stateRef.current.objectSelectionSession;
    if (generation === generationRef.current && live?.nodeId === nodeId) {
      writeTransientSession({
        ...live,
        width: 0,
        height: 0,
        candidates: [],
        status: 'error',
        error: {
          code: 'source_changed',
          message: 'The image changed after the preview. Create a new preview before applying it.',
          retryable: true,
        },
      });
    }
    announcerRef.current?.announce(
      'The image changed after the preview. Create a new preview before applying it.',
    );
    return null;
  }
  const currentMapper = prepareImageMaskMapper({
    document: stateRef.current.document,
    node,
    sourceWidth: previousSession.width,
    sourceHeight: previousSession.height,
  });
  if (
    !previousSession.mappingFingerprint ||
    !currentMapper ||
    currentMapper.fingerprint !== previousSession.mappingFingerprint
  ) {
    const live = stateRef.current.objectSelectionSession;
    if (generation === generationRef.current && live?.nodeId === nodeId) {
      writeTransientSession({
        ...live,
        status: 'error',
        error: {
          code: 'mapping_changed',
          message:
            'The image placement changed after the preview. Create a new preview before applying it.',
          retryable: true,
        },
      });
    }
    announcerRef.current?.announce(
      'The image placement changed after the preview. Create a new preview before applying it.',
    );
    return null;
  }
  const reviewedPrompts = previousSession.sourcePrompts
    ? normalizeSourceSam2Prompts(previousSession.sourcePrompts)
    : normalizeSam2Prompts(
        {
          points: previousSession.points,
          box: previousSession.box ?? undefined,
        },
        currentMapper,
        previousSession.width,
        previousSession.height,
      );
  if (reviewedPrompts.unmappedPointCount > 0 || reviewedPrompts.unmappedBoxCornerCount > 0) {
    const live = stateRef.current.objectSelectionSession;
    if (generation === generationRef.current && live?.nodeId === nodeId) {
      writeTransientSession({
        ...live,
        status: 'error',
        error: {
          code: 'prompt_out_of_bounds',
          message:
            'The reviewed prompt geometry is no longer inside the image. Create a new preview before applying it.',
          retryable: true,
        },
      });
    }
    announcerRef.current?.announce(
      'The reviewed prompt geometry is no longer inside the image. Create a new preview before applying it.',
    );
    return null;
  }
  if (!maskMatchesDimensions(candidate.mask, previousSession.width, previousSession.height)) {
    const live = stateRef.current.objectSelectionSession;
    if (generation === generationRef.current && live?.nodeId === nodeId) {
      writeTransientSession({
        ...live,
        status: 'error',
        error: {
          code: 'invalid_mask_geometry',
          message:
            'The reviewed mask no longer matches the image dimensions. Create a new preview before applying it.',
          retryable: true,
        },
      });
    }
    announcerRef.current?.announce(
      'The reviewed mask no longer matches the image dimensions. Create a new preview before applying it.',
    );
    return null;
  }
  if (countMaskCoverage(candidate.mask) === 0) {
    const live = stateRef.current.objectSelectionSession;
    if (generation === generationRef.current && live?.nodeId === nodeId) {
      writeTransientSession({
        ...live,
        status: 'error',
        error: {
          code: 'empty_result',
          message:
            'The reviewed candidate contains no pixels. Adjust or remove prompts and create a new preview.',
          retryable: true,
        },
      });
    }
    announcerRef.current?.announce(
      'The reviewed candidate contains no pixels. Adjust the prompts and try again.',
    );
    return null;
  }
  const reviewedCandidateValidation = validatePromptedMaskCandidate(
    {
      mask: candidate.mask,
      width: previousSession.width,
      height: previousSession.height,
      score: candidate.confidence,
    },
    {
      points: reviewedPrompts.points,
      box: reviewedPrompts.box,
    },
    previousSession.width,
    previousSession.height,
  );
  if (!reviewedCandidateValidation.valid) {
    const live = stateRef.current.objectSelectionSession;
    const message =
      reviewedCandidateValidation.reason === 'positive-anchor-required'
        ? 'Add an include point or a box before applying this selection; exclude points only refine an identified object.'
        : reviewedCandidateValidation.reason === 'ambiguous-unanchored-region'
          ? 'This candidate contains disconnected coverage that is not anchored to the target. Add an include point on the intended object or exclude the extra region before applying it.'
          : 'This candidate does not honor the reviewed prompts. Create a new preview before applying it.';
    if (generation === generationRef.current && live?.nodeId === nodeId) {
      writeTransientSession({
        ...live,
        status: 'error',
        error: {
          code: 'prompt_not_honored',
          message,
          retryable: true,
        },
      });
    }
    announcerRef.current?.announce(message);
    return null;
  }
  if (reviewedCandidateValidation.diagnostics?.requiresRefinement) {
    const message =
      reviewedCandidateValidation.diagnostics.warnings.find(
        (warning) => warning.includes('extent prompt') || warning.includes('candidate boundary'),
      ) ??
      'Refine the highlighted Object Selection extent with another include point or a box before applying it.';
    const live = stateRef.current.objectSelectionSession;
    if (generation === generationRef.current && live?.nodeId === nodeId) {
      writeTransientSession({
        ...live,
        status: 'error',
        error: {
          code: 'prompt_needs_refinement',
          message,
          retryable: true,
        },
      });
    }
    announcerRef.current?.announce(message);
    return null;
  }
  const normalizedReviewedCandidate = rankPromptedMaskCandidates(
    [
      {
        mask: candidate.mask,
        width: previousSession.width,
        height: previousSession.height,
        score: candidate.confidence,
      },
    ],
    {
      points: reviewedPrompts.points,
      box: reviewedPrompts.box,
    },
    previousSession.width,
    previousSession.height,
  ).candidates[0];
  if (!normalizedReviewedCandidate) {
    announcerRef.current?.announce(
      'The reviewed candidate is no longer a focused match for the prompts. Create a new preview before applying it.',
    );
    return null;
  }
  const candidateToCommit =
    normalizedReviewedCandidate.mask === candidate.mask
      ? candidate
      : { ...candidate, mask: normalizedReviewedCandidate.mask };
  // Resolve the committed mask payload *before* the request generation is
  // bumped below: a refused combination must land on this session as a
  // retryable error rather than vanishing as a silent no-op.
  const maskPayload =
    operation === 'mask' || operation === 'layer'
      ? await buildMaskPayload(
          currentDoc,
          nodeId,
          candidateToCommit.mask,
          previousSession.width,
          previousSession.height,
          combination,
        )
      : null;
  if (maskPayload && !maskPayload.ok) {
    const live = stateRef.current.objectSelectionSession;
    if (generation === generationRef.current && live?.nodeId === nodeId) {
      writeTransientSession({
        ...live,
        status: 'error',
        error: { code: maskPayload.code, message: maskPayload.message, retryable: true },
      });
    }
    announcerRef.current?.announce(maskPayload.message);
    return null;
  }
  return { candidateToCommit, maskPayload };
}

export type Sam2ReadyCommitValidation = NonNullable<
  Awaited<ReturnType<typeof validateReadySam2Commit>>
>;
