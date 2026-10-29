import type {
  Sam2ApplyContext,
  Sam2ApplyParams,
  Sam2ApplyResult,
  Sam2Precheck,
} from './applyContext';
import { isCancellationError, mapSegmentationFailure } from './errors';
import { executeReadySam2Commit, publishSam2Operation } from './operations';
import { prepareSam2PromptInputs, setupSam2PromptRun } from './promptRun';
import { resolveSam2ProviderRouting } from './providerRouting';
import { validateReadySam2Commit } from './readyCommit';
import { runSam2WorkerTransport } from './workerTransport';

export async function precheckSam2Apply(
  ctx: Sam2ApplyContext,
  params: Sam2ApplyParams,
): Promise<Sam2Precheck | null> {
  const { enabled, announcerRef, generationRef, setAreaSelection, stateRef } = ctx;
  const { nodeId, operation } = params;
  if (!enabled) {
    announcerRef.current?.announce('Subject selection is available in the main editor window.');
    return null;
  }
  const generation = ++generationRef.current;
  const currentDoc = stateRef.current.document;
  const node = currentDoc.nodes[nodeId] as import('@varve/scene').ShapeNode | undefined;

  // Object Selection works on exactly one image. Without this gate a
  // multi-selection reached the mid-flight guards only after the encode
  // had already run, and those guards return silently — leaving the
  // session stuck on "encoding" with no error until the user cancels.
  const selectionCount = stateRef.current.selection.length;
  if (selectionCount !== 1) {
    announcerRef.current?.announce(
      selectionCount === 0
        ? 'Select the image you want to segment before using Object Selection.'
        : 'Object Selection works on one image at a time. Select a single image and try again.',
    );
    return null;
  }

  if (node?.kind !== 'shape') {
    announcerRef.current?.announce('Select a shape node first');
    return null;
  }
  if (!node.visible) {
    announcerRef.current?.announce(
      'The selected image is hidden. Make it visible before running Object Selection.',
    );
    return null;
  }
  if (node.locked) {
    announcerRef.current?.announce(
      'The selected image is locked. Unlock it before running Object Selection.',
    );
    return null;
  }

  const { isImageShape, imageShapeSrc } = await import('@varve/scene');
  if (!isImageShape(node)) {
    announcerRef.current?.announce('The selected node does not have an image fill');
    return null;
  }

  const src = imageShapeSrc(node);
  if (!src) {
    announcerRef.current?.announce('Could not determine image source');
    return null;
  }

  // Refuse a pixel-selection output before any model work when the editor
  // surface has no area-selection setter. Otherwise a full encode/decode
  // would run only to fail at the final conversion step.
  if (operation === 'selection' && !setAreaSelection) {
    announcerRef.current?.announce('Pixel selection output is unavailable in this editor surface.');
    return null;
  }

  const previousSession = stateRef.current.objectSelectionSession;
  const sameSessionTarget =
    previousSession?.nodeId === nodeId &&
    (!previousSession.documentId || previousSession.documentId === currentDoc.id) &&
    (!previousSession.sourceLocator || previousSession.sourceLocator === src);

  // Applying a visible candidate must be a commit, not a second model
  // run. This makes Apply/Enter and Use as selection deterministic and
  // keeps the exact mask the user inspected as the committed output.
  const isCommitOperation =
    operation === 'mask' || operation === 'selection' || operation === 'layer';
  // Extraction commits a reviewed candidate onto a copy of the image.
  // Without a ready preview there is nothing reviewed to extract; run the
  // prompts as a preview first instead of inferring and committing
  // something the user never inspected.
  if (operation === 'layer' && !(sameSessionTarget && previousSession?.status === 'ready')) {
    announcerRef.current?.announce(
      'Create an Object Selection preview and review it, then extract the subject to a new layer.',
    );
    return null;
  }
  return {
    generation,
    currentDoc,
    node,
    src,
    previousSession,
    sameSessionTarget,
    isCommitOperation,
  };
}

export async function runSam2Apply(
  ctx: Sam2ApplyContext,
  params: Sam2ApplyParams,
): Promise<Sam2ApplyResult> {
  const pre = await precheckSam2Apply(ctx, params);
  if (!pre) return null;
  const { generation, isCommitOperation, previousSession, sameSessionTarget } = pre;
  const { abortRef, generationRef, softDeadlineRef } = ctx;
  if (isCommitOperation && sameSessionTarget && previousSession?.status === 'ready') {
    const commitPre = { ...pre, previousSession };
    const validated = await validateReadySam2Commit(ctx, params, commitPre);
    if (!validated) return null;
    return executeReadySam2Commit(ctx, params, commitPre, validated);
  }
  const setup = setupSam2PromptRun(ctx, params, pre);
  if (!setup) return null;
  const { markFailure } = setup;
  const inputs = await prepareSam2PromptInputs(params, pre, setup);
  if (!inputs) return null;
  const route = await resolveSam2ProviderRouting(ctx, params, pre, setup, inputs);
  if (!route) return null;
  let result: Sam2ApplyResult = null;
  try {
    const run = await runSam2WorkerTransport(ctx, params, pre, setup, inputs, route);
    if (run) {
      result = await publishSam2Operation(ctx, params, pre, setup, inputs, route, run);
    }
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    if (isCancellationError(raw)) return null;
    const failure = mapSegmentationFailure(raw);
    markFailure(failure);
    return null;
  } finally {
    if (generation === generationRef.current) {
      abortRef.current = null;
      if (softDeadlineRef.current !== null) {
        clearTimeout(softDeadlineRef.current);
        softDeadlineRef.current = null;
      }
    }
  }
  return result;
}
