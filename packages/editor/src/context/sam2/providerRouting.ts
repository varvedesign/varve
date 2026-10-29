import {
  assessImageInferenceResources,
  EFFICIENT_SAM_DECODER_ID,
  EFFICIENT_SAM_ENCODER_ID,
  getModelById,
  getModelLoader,
  getNativeGenerativeModelStatus,
  getRuntimeCapabilitiesSync,
  MOBILE_SAM_DECODER_ID,
  MOBILE_SAM_ENCODER_ID,
  type PromptedProviderFact,
  routePromptedSelection,
  SAM2_DECODER_ID,
  SAM2_ENCODER_ID,
} from '@varve/engine';
import { fingerprintImageData } from '../imageFingerprint';
import { validatePromptedImageAnchors } from '../promptedMaskValidation';
import type { Sam2ApplyContext, Sam2ApplyParams, Sam2Precheck } from './applyContext';
import {
  promptedEmbeddingCacheKey,
  promptedEncoderPeakBytes,
  promptedExecutionProvider,
  promptedProviderFacts,
  promptedRequiredCapabilities,
} from './capabilities';
import { isCancellationError, mapPromptedRoutingFailure, mapSegmentationFailure } from './errors';
import type { Sam2PromptInputs, Sam2PromptRunSetup } from './promptRun';
import { writeCurrentSam2Stage } from './session';

export async function resolveSam2ProviderRouting(
  ctx: Sam2ApplyContext,
  params: Sam2ApplyParams,
  pre: Sam2Precheck,
  setup: Sam2PromptRunSetup,
  inputs: Sam2PromptInputs,
) {
  const {
    embeddingCacheRef,
    promptedProviderPreference,
    setState,
    stateRef,
    writeTransientSession,
  } = ctx;
  const { nodeId, prompts } = params;
  const { currentDoc, src } = pre;
  const { combinedSignal, markFailure } = setup;
  const { img, naturalW, naturalH, normPrompts } = inputs;
  const loader = getModelLoader();
  const modelIds = [
    MOBILE_SAM_ENCODER_ID,
    MOBILE_SAM_DECODER_ID,
    SAM2_ENCODER_ID,
    SAM2_DECODER_ID,
    EFFICIENT_SAM_ENCODER_ID,
    EFFICIENT_SAM_DECODER_ID,
  ] as const;
  let paths: Array<string | null>;
  try {
    paths = await Promise.all(
      modelIds.map((modelId) => loader.getModelPath(modelId, combinedSignal)),
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    if (isCancellationError(raw)) return null;
    markFailure(mapSegmentationFailure(raw));
    return null;
  }

  const mobileInstalled = Boolean(paths[0] && paths[1]);
  const sam2Installed = Boolean(paths[2] && paths[3]);
  const efficientSamInstalled = Boolean(paths[4] && paths[5]);
  const runtime = getRuntimeCapabilitiesSync();
  let safePeakBytes = runtime.wasmSafePeakBytes;
  if (runtime.isTauri) {
    // Tauri WebViews commonly omit navigator.deviceMemory. Reuse the
    // desktop process' cgroup/OS snapshot when it is available so a
    // capable ARM or x86 desktop is not mistaken for a 2 GB browser.
    const nativeResources = await getNativeGenerativeModelStatus();
    if (nativeResources.memoryAvailableBytes != null && nativeResources.memoryAvailableBytes > 0) {
      safePeakBytes = nativeResources.memoryAvailableBytes;
    }
  }
  const executionProvider = promptedExecutionProvider(runtime);
  const providers = promptedProviderFacts(mobileInstalled, sam2Installed, efficientSamInstalled);
  const embeddingCache = embeddingCacheRef.current;
  if (!embeddingCache) return null;
  // Route once from dimensions before allocating a full-resolution source
  // buffer. The cache-aware route is resolved below, after the decoded
  // source fingerprint exists; this keeps the memory gate ahead of the
  // largest allocation while still allowing a warm provider to win.
  let decision = routePromptedSelection({
    preference: 'auto',
    preferredProviderId: promptedProviderPreference,
    allowExperimentalProvider: promptedProviderPreference !== 'auto',
    sourceWidth: naturalW,
    sourceHeight: naturalH,
    executionProvider,
    safeWorkingSetBytes: safePeakBytes,
    requiredCapabilities: promptedRequiredCapabilities(prompts),
    providers,
  });
  if (!decision.providerId || !decision.encoderId || !decision.decoderId) {
    const liveSession = stateRef.current.objectSelectionSession;
    if (liveSession?.nodeId === nodeId && stateRef.current.document.id === currentDoc.id) {
      writeTransientSession({
        ...liveSession,
        routingReason: decision.reason,
        routingRejections: decision.rejected,
      });
    }
    markFailure(mapPromptedRoutingFailure(decision));
    return null;
  }
  let providerId: string = decision.providerId;
  let encoderId: string = decision.encoderId;
  let decoderId: string = decision.decoderId;
  let encoderIndex = modelIds.indexOf(encoderId as (typeof modelIds)[number]);
  let decoderIndex = modelIds.indexOf(decoderId as (typeof modelIds)[number]);
  let resolvedEncoderPath = paths[encoderIndex] ?? null;
  let resolvedDecoderPath = paths[decoderIndex] ?? null;
  if (!resolvedEncoderPath || !resolvedDecoderPath) {
    markFailure({
      code: 'model_not_installed',
      message:
        'Prompted object selection needs an optional local model. Download it from this panel, then try again.',
      retryable: true,
    });
    return null;
  }
  const liveSession = stateRef.current.objectSelectionSession;
  if (liveSession?.nodeId === nodeId && stateRef.current.document.id === currentDoc.id) {
    writeTransientSession({
      ...liveSession,
      modelId: providerId,
      routingReason: decision.reason,
      routingRejections: decision.rejected,
    });
  }
  const encoderPeakBytes = promptedEncoderPeakBytes(encoderId);
  let resourceAssessment = assessImageInferenceResources({
    width: naturalW,
    height: naturalH,
    modelPeakBytes: encoderPeakBytes,
    runtime: { wasmSafePeakBytes: safePeakBytes },
    operation: 'Object Selection',
  });
  if (combinedSignal.aborted) return null;
  if (!resourceAssessment.allowed) {
    markFailure({
      code: 'out_of_memory',
      message: resourceAssessment.reason ?? 'Object Selection needs more memory on this device.',
      retryable: false,
    });
    return null;
  }

  // Do not allocate a full-resolution canvas or ImageData until the
  // model-plus-source working set has passed the runtime's safe budget.
  writeCurrentSam2Stage(stateRef, setState, nodeId, 'encoding');

  let imageData: ImageData;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = naturalW;
    canvas.height = naturalH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');
    ctx.drawImage(img, 0, 0, naturalW, naturalH);
    imageData = ctx.getImageData(0, 0, naturalW, naturalH);
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const allocationFailure = /memory|allocation|too large|invalid state/i.test(raw);
    markFailure({
      code: allocationFailure ? 'out_of_memory' : 'image_pixels_unavailable',
      message: allocationFailure
        ? 'Object Selection could not allocate a safe working buffer for this image. Use the brush or Fast cutout path, or work on a smaller image.'
        : 'The image pixels could not be read. Check the file permissions and try again.',
      retryable: true,
    });
    return null;
  }

  if (combinedSignal.aborted) return null;

  const sourceFingerprint = await fingerprintImageData(imageData);
  if (combinedSignal.aborted) return null;

  const providerCacheKey = (provider: PromptedProviderFact): string => {
    const providerEncoderIndex = modelIds.indexOf(provider.encoderId as (typeof modelIds)[number]);
    const providerDecoderIndex = modelIds.indexOf(provider.decoderId as (typeof modelIds)[number]);
    return `${promptedEmbeddingCacheKey({
      documentId: currentDoc.id,
      nodeId,
      src,
      width: naturalW,
      height: naturalH,
      sourceFingerprint,
      providerId: provider.id,
      encoderId: provider.encoderId,
      encoderArtifact: getModelById(provider.encoderId)?.checksum || provider.encoderId,
      decoderId: provider.decoderId,
      decoderArtifact: getModelById(provider.decoderId)?.checksum || provider.decoderId,
    })}|${paths[providerEncoderIndex] ?? ''}|${paths[providerDecoderIndex] ?? ''}`;
  };
  const cachedEmbeddingProvider = providers.find((provider) =>
    embeddingCache.get(providerCacheKey(provider)),
  )?.id;
  if (cachedEmbeddingProvider && cachedEmbeddingProvider !== providerId) {
    const warmDecision = routePromptedSelection({
      preference: 'auto',
      preferredProviderId: promptedProviderPreference,
      allowExperimentalProvider: promptedProviderPreference !== 'auto',
      sourceWidth: naturalW,
      sourceHeight: naturalH,
      executionProvider,
      safeWorkingSetBytes: safePeakBytes,
      cachedEmbeddingProvider,
      requiredCapabilities: promptedRequiredCapabilities(prompts),
      providers,
    });
    if (warmDecision.providerId && warmDecision.encoderId && warmDecision.decoderId) {
      decision = warmDecision;
      providerId = warmDecision.providerId;
      encoderId = warmDecision.encoderId;
      decoderId = warmDecision.decoderId;
      encoderIndex = modelIds.indexOf(encoderId as (typeof modelIds)[number]);
      decoderIndex = modelIds.indexOf(decoderId as (typeof modelIds)[number]);
      resolvedEncoderPath = paths[encoderIndex] ?? null;
      resolvedDecoderPath = paths[decoderIndex] ?? null;
      const warmResourceAssessment = assessImageInferenceResources({
        width: naturalW,
        height: naturalH,
        modelPeakBytes: promptedEncoderPeakBytes(encoderId),
        runtime: { wasmSafePeakBytes: safePeakBytes },
        operation: 'Object Selection',
      });
      if (!warmResourceAssessment.allowed) {
        markFailure({
          code: 'out_of_memory',
          message:
            warmResourceAssessment.reason ?? 'Object Selection needs more memory on this device.',
          retryable: false,
        });
        return null;
      }
      resourceAssessment = warmResourceAssessment;
      const live = stateRef.current.objectSelectionSession;
      if (live?.nodeId === nodeId && stateRef.current.document.id === currentDoc.id) {
        writeTransientSession({
          ...live,
          modelId: providerId,
          routingReason: decision.reason,
          routingRejections: decision.rejected,
        });
      }
    }
  }

  // A warm-provider reroute can change the model ids and paths. Recheck
  // the resolved handles after that branch so a partial installation can
  // never reach the worker with a nullable path.
  if (!resolvedEncoderPath || !resolvedDecoderPath) {
    markFailure({
      code: 'model_not_installed',
      message:
        'Prompted object selection needs an optional local model. Download it from this panel, then try again.',
      retryable: true,
    });
    return null;
  }

  const imageAnchors = validatePromptedImageAnchors(imageData, normPrompts.points);
  if (!imageAnchors.valid) {
    markFailure({
      code: 'prompt_on_transparent',
      message:
        'The include point is on a fully transparent part of the image. Place it on the visible object or use a box hint, then try again.',
      retryable: true,
    });
    return null;
  }
  return {
    decision,
    providerId,
    encoderId,
    decoderId,
    resolvedEncoderPath,
    resolvedDecoderPath,
    resourceAssessment,
    embeddingCache,
    imageData,
    sourceFingerprint,
  };
}

export type Sam2ProviderRoute = NonNullable<Awaited<ReturnType<typeof resolveSam2ProviderRouting>>>;
