import type { NodeId } from '@varve/scene';
import { commitRasterMask } from '../../backgroundRemoval/commitRasterMask';
import { extractSubjectToLayer } from '../../backgroundRemoval/extractSubjectLayer';
import { setCollapsed } from '../../components/Inspector/sectionState';
import { areaSelectionFromMaskCoverage } from '../../tools/selectionMask';
import type {
  Sam2ApplyContext,
  Sam2ApplyParams,
  Sam2ApplyResult,
  Sam2CommitPrecheck,
  Sam2Precheck,
} from './applyContext';
import { buildMaskPayload } from './maskPayload';
import type { Sam2PromptInputs, Sam2PromptRunSetup } from './promptRun';
import type { Sam2ProviderRoute } from './providerRouting';
import type { Sam2ReadyCommitValidation } from './readyCommit';
import {
  cloneSourcePrompts,
  formatSelectionScore,
  isCurrentSelectionTarget,
  readImageSourceIdentity,
} from './session';
import type { Sam2TransportRun } from './workerTransport';

export function executeReadySam2Commit(
  ctx: Sam2ApplyContext,
  params: Sam2ApplyParams,
  pre: Sam2CommitPrecheck,
  validated: Sam2ReadyCommitValidation,
): Sam2ApplyResult {
  const {
    abortRef,
    announcerRef,
    generationRef,
    setAreaSelection,
    softDeadlineRef,
    stateRef,
    updateDoc,
    writeTransientSession,
  } = ctx;
  const { nodeId, operation } = params;
  const { currentDoc, node, previousSession, src } = pre;
  const { candidateToCommit, maskPayload } = validated;
  abortRef.current?.abort();
  abortRef.current = null;
  generationRef.current += 1;
  if (softDeadlineRef.current !== null) {
    clearTimeout(softDeadlineRef.current);
    softDeadlineRef.current = null;
  }

  if (operation === 'selection') {
    const areaSelection = areaSelectionFromMaskCoverage(
      currentDoc,
      nodeId,
      candidateToCommit.mask,
      previousSession.width,
      previousSession.height,
      'source-image-pixels',
    );
    if (!areaSelection || !setAreaSelection) {
      announcerRef.current?.announce(
        'The subject mask could not be converted into a pixel selection.',
      );
      return null;
    }
    setAreaSelection(areaSelection);
    writeTransientSession(null, { maskPreviewMode: 'none' });
    announcerRef.current?.announce(
      `Selected subject (${formatSelectionScore(candidateToCommit.confidence, candidateToCommit.scoreSource ?? previousSession.confidenceSource)})`,
    );
    return {
      mask: candidateToCommit.mask,
      width: previousSession.width,
      height: previousSession.height,
      confidence: candidateToCommit.confidence,
    };
  }

  if (!maskPayload) return null;
  if (!isCurrentSelectionTarget(stateRef, currentDoc.id, nodeId, node)) {
    announcerRef.current?.announce(
      'The selected image changed after the preview. Create a new preview before applying it.',
    );
    return null;
  }
  const commitFields = {
    dataUrl: maskPayload.dataUrl,
    width: previousSession.width,
    height: previousSession.height,
    method: 'ai-quality' as const,
    modelId: previousSession.modelId || 'sam2-hiera-tiny',
    score: candidateToCommit.confidence,
    scoreSource: candidateToCommit.scoreSource ?? previousSession.confidenceSource,
    generatedAt: Date.now(),
    sourceLocator: src,
  };
  if (operation === 'layer') {
    // Extraction: the source keeps every pixel it had; a copy inserted
    // directly above it receives the reviewed mask. One updateDoc, one
    // undo entry, and the copy becomes the selection so the extracted
    // subject can be moved immediately.
    let extractedNodeId: NodeId | null = null;
    updateDoc((doc) => {
      const liveNode = doc.nodes[nodeId];
      if (doc.id !== currentDoc.id || liveNode !== node) return doc;
      const result = extractSubjectToLayer(doc, nodeId, commitFields);
      if (!result) return doc;
      extractedNodeId = result.newNodeId;
      return result.doc;
    });
    if (extractedNodeId) {
      const extractedId: NodeId = extractedNodeId;
      writeTransientSession(null, {
        selection: [extractedId],
        maskPreviewMode: 'none',
        sectionVisibility: setCollapsed(
          stateRef.current.sectionVisibility,
          'background-removal',
          false,
        ),
      });
      announcerRef.current?.announce(
        `Subject extracted to a new layer (${formatSelectionScore(candidateToCommit.confidence, candidateToCommit.scoreSource ?? previousSession.confidenceSource)})`,
      );
      return {
        mask: candidateToCommit.mask,
        width: previousSession.width,
        height: previousSession.height,
        confidence: candidateToCommit.confidence,
      };
    }
    return null;
  }
  let committed = false;
  updateDoc((doc) => {
    const liveNode = doc.nodes[nodeId];
    if (doc.id !== currentDoc.id || liveNode !== node) return doc;
    const updated = commitRasterMask(doc, nodeId, commitFields);
    committed = updated !== doc;
    return updated;
  });
  if (committed) {
    // The committed confidence and method are rendered in the
    // Background Removal disclosure. Reveal it when Object Selection
    // applies a mask so the result is immediately reviewable from
    // every entry point (toolbar, inspector, or keyboard).
    writeTransientSession(null, {
      maskPreviewMode: 'none',
      sectionVisibility: setCollapsed(
        stateRef.current.sectionVisibility,
        'background-removal',
        false,
      ),
    });
    announcerRef.current?.announce(
      `Selection applied as a mask (${formatSelectionScore(candidateToCommit.confidence, candidateToCommit.scoreSource ?? previousSession.confidenceSource)})`,
    );
    return {
      mask: candidateToCommit.mask,
      width: previousSession.width,
      height: previousSession.height,
      confidence: candidateToCommit.confidence,
    };
  }
  return null;
}

export async function publishSam2Operation(
  ctx: Sam2ApplyContext,
  params: Sam2ApplyParams,
  pre: Sam2Precheck,
  setup: Sam2PromptRunSetup,
  inputs: Sam2PromptInputs,
  route: Sam2ProviderRoute,
  run: Sam2TransportRun,
): Promise<Sam2ApplyResult> {
  const {
    announcerRef,
    previewModeRef,
    setAreaSelection,
    stateRef,
    updateDoc,
    writeTransientSession,
  } = ctx;
  const { combination, nodeId, operation, prompts, sourcePrompts } = params;
  const { currentDoc, node, src } = pre;
  const { markFailure, promptSession } = setup;
  const { imageMapper, naturalW, naturalH } = inputs;
  const { decision, providerId, sourceFingerprint } = route;
  const {
    bestMask,
    coveragePixels,
    decoded,
    maskResult,
    prediction,
    publishedCandidatesWithIdentity,
    ranked,
    selectedCandidate,
    selectedConfidence,
  } = run;
  switch (operation) {
    case 'preview':
      writeTransientSession(
        {
          ...promptSession,
          nodeId,
          width: naturalW,
          height: naturalH,
          candidates: publishedCandidatesWithIdentity,
          rejectedCandidateCount: ranked.rejectedCount,
          selectedCandidate,
          reviewedCandidateKey: undefined,
          reviewedCandidateAt: undefined,
          points: prompts.points ?? [],
          box: prompts.box ?? null,
          sourcePrompts: sourcePrompts ? cloneSourcePrompts(sourcePrompts) : undefined,
          draftPoint: null,
          draftBox: null,
          confidence: selectedConfidence,
          confidenceSource: decoded.confidenceSource,
          status: 'ready' as const,
          modelId: providerId,
          executionProvider: prediction.executionProvider,
          previewMode: promptSession.previewMode ?? previewModeRef.current,
          routingReason: decision.reason,
          routingRejections: decision.rejected,
          sourceLocator: src,
          sourceFingerprint,
          mappingFingerprint: imageMapper.fingerprint,
          startedAt: promptSession.startedAt,
          slow: false,
          stageTimingsMs: {
            ...promptSession.stageTimingsMs,
            ready: promptSession.startedAt ? Date.now() - promptSession.startedAt : undefined,
          },
          error: undefined,
        },
        { maskPreviewMode: 'overlay' },
      );
      announcerRef.current?.announce(
        coveragePixels === 0
          ? `No pixels were selected for these prompts (${formatSelectionScore(selectedConfidence, bestMask.scoreSource)}). Adjust the prompts and try again.`
          : `Subject preview ready (${formatSelectionScore(selectedConfidence, bestMask.scoreSource)}). Review the highlighted target, then press Enter to apply it as a mask; Escape cancels.`,
      );
      return maskResult;

    case 'mask': {
      if (coveragePixels === 0) {
        markFailure({
          code: 'empty_result',
          message:
            'The model did not find any pixels for these prompts. Adjust the prompts and create a new preview.',
          retryable: true,
        });
        return null;
      }
      const payload = await buildMaskPayload(
        stateRef.current.document,
        nodeId,
        bestMask.mask,
        naturalW,
        naturalH,
        combination,
      );
      if (!payload.ok) {
        markFailure({ code: payload.code, message: payload.message, retryable: true });
        return null;
      }
      const liveBeforeCommit = stateRef.current.document.nodes[nodeId];
      if (
        stateRef.current.document.id !== currentDoc.id ||
        stateRef.current.selection.length !== 1 ||
        stateRef.current.selection[0] !== nodeId ||
        liveBeforeCommit !== node
      ) {
        return null;
      }
      const freshSource = await readImageSourceIdentity(src);
      if (
        !freshSource ||
        freshSource.width !== naturalW ||
        freshSource.height !== naturalH ||
        freshSource.fingerprint !== sourceFingerprint
      ) {
        markFailure({
          code: 'source_changed',
          message: 'The image changed while processing. Create a new preview and try again.',
          retryable: true,
        });
        return null;
      }
      let committed = false;
      updateDoc((doc) => {
        const liveNode = doc.nodes[nodeId];
        if (doc.id !== currentDoc.id || liveNode !== node) return doc;
        const updated = commitRasterMask(doc, nodeId, {
          dataUrl: payload.dataUrl,
          width: naturalW,
          height: naturalH,
          method: 'ai-quality',
          modelId: providerId,
          score: selectedConfidence,
          scoreSource: bestMask.scoreSource,
          generatedAt: Date.now(),
          sourceLocator: src,
        });
        committed = updated !== doc;
        return updated;
      });
      if (committed) {
        writeTransientSession(null, { maskPreviewMode: 'none' });
        announcerRef.current?.announce(
          `Selection applied as a mask (${formatSelectionScore(selectedConfidence, bestMask.scoreSource)})`,
        );
      }
      return maskResult;
    }

    case 'selection': {
      if (coveragePixels === 0) {
        markFailure({
          code: 'empty_result',
          message:
            'The model did not find any pixels for these prompts. Adjust the prompts and create a new preview.',
          retryable: true,
        });
        return null;
      }
      if (!setAreaSelection) {
        markFailure({
          code: 'selection_output_unavailable',
          message: 'Pixel selection output is unavailable in this editor surface.',
          retryable: false,
        });
        return null;
      }
      const areaSelection = areaSelectionFromMaskCoverage(
        currentDoc,
        nodeId,
        bestMask.mask,
        naturalW,
        naturalH,
        'source-image-pixels',
      );
      if (!areaSelection) {
        markFailure({
          code: 'selection_output_unavailable',
          message: 'The subject mask could not be converted into a pixel selection.',
          retryable: true,
        });
        return null;
      }
      setAreaSelection(areaSelection);
      writeTransientSession(null, { maskPreviewMode: 'none' });
      announcerRef.current?.announce(
        `Selected subject (${formatSelectionScore(selectedConfidence, bestMask.scoreSource)})`,
      );
      return maskResult;
    }
  }
  return null;
}
