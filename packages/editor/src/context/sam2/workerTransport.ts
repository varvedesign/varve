import { getInferenceWorkerHost, getModelById } from '@varve/engine';
import { prepareImageMaskMapper } from '../../tools/imageMaskCoordinates';
import { objectSelectionCandidateMaskFingerprint } from '../objectSelectionTypes';
import { rankPromptedMaskCandidates } from '../promptedMaskValidation';
import {
  type PromptedEmbedding,
  type PromptedMaskCandidate,
  runPromptedSegmentation,
} from '../promptedSegmentationProvider';
import type { Sam2ApplyContext, Sam2ApplyParams, Sam2Precheck } from './applyContext';
import { promptedEmbeddingCacheKey } from './capabilities';
import { countMaskCoverage } from './maskPayload';
import type { Sam2PromptInputs, Sam2PromptRunSetup } from './promptRun';
import type { Sam2ProviderRoute } from './providerRouting';
import { readImageSourceIdentity, writeCurrentSam2Stage } from './session';

export async function runSam2WorkerTransport(
  ctx: Sam2ApplyContext,
  params: Sam2ApplyParams,
  pre: Sam2Precheck,
  setup: Sam2PromptRunSetup,
  inputs: Sam2PromptInputs,
  route: Sam2ProviderRoute,
) {
  const { generationRef, setState, stateRef } = ctx;
  const { candidateIndex, nodeId } = params;
  const { currentDoc, generation, node, previousSession, sameSessionTarget, src } = pre;
  const { combinedSignal, markFailure } = setup;
  const { imageMapper, naturalW, naturalH, normPrompts } = inputs;
  const {
    decision,
    embeddingCache,
    encoderId,
    decoderId,
    imageData,
    providerId,
    resolvedDecoderPath,
    resolvedEncoderPath,
    resourceAssessment,
    sourceFingerprint,
  } = route;
  const host = getInferenceWorkerHost();
  const encoderArtifact = getModelById(encoderId)?.checksum || resolvedEncoderPath;
  const decoderArtifact = getModelById(decoderId)?.checksum || resolvedDecoderPath;
  const cacheKey = `${promptedEmbeddingCacheKey({
    documentId: currentDoc.id,
    nodeId,
    src,
    width: naturalW,
    height: naturalH,
    sourceFingerprint,
    providerId,
    encoderId,
    encoderArtifact,
    decoderId,
    decoderArtifact,
  })}|${resolvedEncoderPath}|${resolvedDecoderPath}`;
  const cached = embeddingCache.get(cacheKey);
  const cachedEmbedding: PromptedEmbedding | undefined = cached
    ? {
        providerId: cached.providerId,
        tensors: cached.embeddings,
        letterbox: cached.letterbox,
      }
    : undefined;

  if (generation !== generationRef.current || combinedSignal.aborted) return null;

  const liveNode = stateRef.current.document.nodes[nodeId];
  if (
    stateRef.current.document.id !== currentDoc.id ||
    stateRef.current.selection.length !== 1 ||
    stateRef.current.selection[0] !== nodeId ||
    liveNode !== node
  ) {
    return null;
  }

  writeCurrentSam2Stage(stateRef, setState, nodeId, 'decoding');
  // Iterative refinement: condition this decode on the candidate the
  // user last kept. SAM2's mask_input expects the reviewed candidate's
  // own low-resolution logits; without them every added prompt re-decodes
  // from scratch and the mask can jump between whole-object and part
  // interpretations. The prior is only valid when it comes from the same
  // ready session: same node/source target, same decoded source pixels,
  // and the same provider (model artifacts and preprocessing identity).
  // Anything else — a source edit, a provider switch, a foreign session —
  // silently falls back to an unconditioned decode.
  const priorSession =
    sameSessionTarget &&
    previousSession?.status === 'ready' &&
    previousSession.sourceFingerprint === sourceFingerprint &&
    previousSession.modelId === providerId
      ? previousSession
      : undefined;
  const priorCandidate = priorSession?.candidates[priorSession.selectedCandidate];
  const previousMask =
    priorCandidate?.lowResMask &&
    Number.isSafeInteger(priorCandidate.lowResMask.width) &&
    Number.isSafeInteger(priorCandidate.lowResMask.height) &&
    priorCandidate.lowResMask.width > 0 &&
    priorCandidate.lowResMask.height > 0 &&
    priorCandidate.lowResMask.data.length ===
      priorCandidate.lowResMask.width * priorCandidate.lowResMask.height
      ? priorCandidate.lowResMask
      : undefined;
  const prediction = await runPromptedSegmentation({
    host,
    decision,
    encoderPath: resolvedEncoderPath,
    decoderPath: resolvedDecoderPath,
    imageData,
    sourceWidth: naturalW,
    sourceHeight: naturalH,
    points: normPrompts.points,
    box: normPrompts.box,
    embedding: cachedEmbedding,
    previousMask,
    signal: combinedSignal,
    reservationBytes: resourceAssessment.estimatedPeakBytes,
  });
  if (generation !== generationRef.current || combinedSignal.aborted) return null;

  // A long encoder/decoder run can outlive a source replacement or an
  // image transform change. Do not publish a preview for a mapping that
  // no longer describes the live node, even though the request itself
  // was not explicitly cancelled yet.
  const liveDocument = stateRef.current.document;
  const liveNodeAfterInference = liveDocument.nodes[nodeId];
  const liveMapperAfterInference =
    liveNodeAfterInference?.kind === 'shape'
      ? prepareImageMaskMapper({
          document: liveDocument,
          node: liveNodeAfterInference,
          sourceWidth: naturalW,
          sourceHeight: naturalH,
        })
      : null;
  if (
    liveDocument.id !== currentDoc.id ||
    !liveMapperAfterInference ||
    liveMapperAfterInference.fingerprint !== imageMapper.fingerprint
  ) {
    markFailure({
      code: 'mapping_changed',
      message: 'The image placement changed while processing. Create a new preview and try again.',
      retryable: true,
    });
    return null;
  }
  const freshSourceAfterInference = await readImageSourceIdentity(src);
  if (
    generation !== generationRef.current ||
    combinedSignal.aborted ||
    !freshSourceAfterInference ||
    freshSourceAfterInference.width !== naturalW ||
    freshSourceAfterInference.height !== naturalH ||
    freshSourceAfterInference.fingerprint !== sourceFingerprint
  ) {
    markFailure({
      code: 'source_changed',
      message: 'The image changed while processing. Create a new preview and try again.',
      retryable: true,
    });
    return null;
  }
  if (!cachedEmbedding) {
    embeddingCache.set(cacheKey, {
      nodeId,
      src,
      providerId,
      embeddings: prediction.embedding.tensors,
      letterbox: prediction.embedding.letterbox,
      naturalW,
      naturalH,
      sourceFingerprint,
    });
  }

  if (generation !== generationRef.current || combinedSignal.aborted) return null;

  const ranked = rankPromptedMaskCandidates(
    prediction.candidates,
    { points: normPrompts.points, box: normPrompts.box },
    naturalW,
    naturalH,
  );
  if (ranked.selectedIndex < 0) {
    markFailure({
      code: 'prompt_not_honored',
      message:
        'No candidate produced a focused mask that honors the prompts. Add an include point on the target and exclude any extra object or region, then try again.',
      retryable: true,
    });
    return null;
  }
  const decoded = {
    masks: ranked.candidates.map(
      (
        candidate: PromptedMaskCandidate & {
          promptContainment: number;
          promptDiagnostics?: import('../promptedMaskValidation').PromptedMaskDiagnostics;
        },
      ) => ({
        mask: candidate.mask,
        width: candidate.width,
        height: candidate.height,
        iouScore: candidate.score,
        scoreSource: candidate.scoreSource,
        promptContainment: candidate.promptContainment,
        promptDiagnostics: candidate.promptDiagnostics,
        lowResMask: candidate.lowResMask,
        confidenceSource:
          candidate.scoreSource === 'predicted-iou'
            ? ('predicted-iou' as const)
            : ('heuristic' as const),
      }),
    ),
    selectedIndex: ranked.selectedIndex,
    confidence: ranked.selectedScore,
    confidenceSource: prediction.scoreSource,
  };

  // Hash each source-resolution candidate once at publication time.
  // Review-key checks run during ordinary React renders, so re-scanning
  // a large photograph there would make the safety guard itself block
  // the editor. Production candidates are immutable after this point;
  // legacy/test sessions without this metadata use the exact fallback
  // in objectSelectionCandidateReviewKey.
  const publishedCandidates = decoded.masks.map((candidate) => ({
    mask: candidate.mask,
    confidence: candidate.iouScore,
    scoreSource: candidate.scoreSource,
    promptContainment: candidate.promptContainment,
    promptDiagnostics: candidate.promptDiagnostics,
    lowResMask: candidate.lowResMask,
  }));
  const candidateFingerprintSession = {
    width: naturalW,
    height: naturalH,
    candidates: publishedCandidates,
  };
  const publishedCandidatesWithIdentity = publishedCandidates.map((candidate, index) => ({
    ...candidate,
    maskFingerprint:
      objectSelectionCandidateMaskFingerprint(candidateFingerprintSession, index) ?? undefined,
  }));

  if (generation !== generationRef.current || combinedSignal.aborted) return null;

  const selectedCandidate = Math.max(
    0,
    Math.min(decoded.masks.length - 1, candidateIndex ?? decoded.selectedIndex),
  );
  const bestMask = decoded.masks[selectedCandidate]!;
  const hasPromptConstraints =
    (normPrompts.points?.length ?? 0) > 0 || normPrompts.box !== undefined;
  if (hasPromptConstraints && bestMask.promptContainment !== 1) {
    markFailure({
      code: 'prompt_not_honored',
      message:
        'The selected candidate did not produce a focused mask for the supplied prompts. Add an include point on the target and exclude any extra region before creating a new preview.',
      retryable: true,
    });
    return null;
  }
  const selectedConfidence = bestMask.iouScore;
  const maskResult = {
    mask: bestMask.mask,
    width: naturalW,
    height: naturalH,
    confidence: selectedConfidence,
  };
  const coveragePixels = countMaskCoverage(bestMask.mask);
  return {
    prediction,
    ranked,
    decoded,
    publishedCandidatesWithIdentity,
    selectedCandidate,
    selectedConfidence,
    bestMask,
    maskResult,
    coveragePixels,
  };
}

export type Sam2TransportRun = NonNullable<Awaited<ReturnType<typeof runSam2WorkerTransport>>>;
