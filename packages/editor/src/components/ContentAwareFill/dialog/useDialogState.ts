import {
  type ContentAwareFillQuality,
  type GenerativeEditMode,
  type GenerativeEditResult,
  GenerativeJobController,
  type GenerativeJobSnapshot,
} from '@varve/engine';
import { useRef, useState } from 'react';
import { useEditor } from '../../../context';
import type { ContentAwareFillDialogProps } from '../ContentAwareFillDialog';
import type { ExpandPadding } from '../expandCanvas';
import type { ExpandAnchor } from '../expandControls';
import type { SourceImageRegion } from '../generationRaster';
import type { MaskCombineOperation } from '../maskOperations';
import { emptySelectionHealth, type SelectionHealth } from '../selectionHealth';
import { DEFAULT_BRUSH_SIZE } from './constants';
import type { loadVisibleImageSource } from './imageLoading';
import type { EditableSourceMask, GenerationRecord } from './types';

export function useDialogState(props: ContentAwareFillDialogProps) {
  const { nodeId, isOpen, onClose, onApplied } = props;
  const generationRef = useRef<GenerationRecord | null>(null);
  const {
    state,
    updateDoc,
    announce,
    beginTransaction,
    commitTransaction,
    abortTransaction,
    setSelection,
    setTool,
  } = useEditor();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  // Backdrop dismissal requires the press and the release to happen on the
  // dialog element itself; a click dispatched on the dialog because a drag
  // began inside the content and ended on the backdrop must not close it.
  const backdropPressRef = useRef({ down: false, up: false });
  const jobControllerRef = useRef(new GenerativeJobController());
  const downloadAbortRef = useRef<AbortController | null>(null);
  const diffusionDownloadAbortRef = useRef<AbortController | null>(null);
  const qualificationAbortRef = useRef<AbortController | null>(null);
  // The ownership token protects against a late status response even after
  // the native request has been asked to stop.
  const qualificationRunRef = useRef(0);
  const isPaintingRef = useRef(false);
  const sessionSourceSignatureRef = useRef<string | null>(null);
  const variationSequenceRef = useRef(0);
  const maskRevisionRef = useRef(0);
  const currentJobSnapshotRef = useRef<GenerativeJobSnapshot | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourcePreviewImageRef = useRef<Awaited<ReturnType<typeof loadVisibleImageSource>> | null>(
    null,
  );
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /**
   * Source-sized masks supplied by an analytical/object-selection provider.
   * The review canvas is intentionally bounded, so it cannot be the source of
   * truth for an untouched high-resolution candidate.
   */
  const editableSourceMaskRef = useRef<EditableSourceMask | null>(null);
  const previewAreaRef = useRef<HTMLDivElement | null>(null);

  const [quality, setQuality] = useState<ContentAwareFillQuality>('fast');
  const [mode, setMode] = useState<GenerativeEditMode>('remove');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [seed, setSeed] = useState<number | null>(null);
  const [variationCount, setVariationCount] = useState(1);
  const [strength, setStrength] = useState(0.75);
  const [steps, setSteps] = useState(24);
  const [guidanceScale, setGuidanceScale] = useState(7);
  const [imageGuidanceScale, setImageGuidanceScale] = useState(1);
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [maskExpansion, setMaskExpansion] = useState(0);
  const [maskFeather, setMaskFeather] = useState(0);
  const [contextPadding, setContextPadding] = useState(32);
  const [maskOrigin, setMaskOrigin] = useState<
    | 'brush'
    | 'pixel-selection'
    | 'layer-mask'
    | 'background-removal'
    | 'image-alpha'
    | 'object-selection'
    | 'persisted'
  >('brush');
  const [maskOperation, setMaskOperation] = useState<MaskCombineOperation>('replace');
  const [modelAvailable, setModelAvailable] = useState(false);
  const [modelFitsMemory, setModelFitsMemory] = useState<boolean | null>(null);
  const [diffusionModelInstalled, setDiffusionModelInstalled] = useState(false);
  const [diffusionModelDownloadAvailable, setDiffusionModelDownloadAvailable] = useState(false);
  const [diffusionModelImportAvailable, setDiffusionModelImportAvailable] = useState(false);
  const [diffusionModelQualificationAvailable, setDiffusionModelQualificationAvailable] =
    useState(false);
  const [diffusionModelHandle, setDiffusionModelHandle] = useState<string | null>(null);
  const [diffusionModelSize, setDiffusionModelSize] = useState(0);
  const [diffusionModelReason, setDiffusionModelReason] = useState<string | null>(null);
  const [diffusionResource, setDiffusionResource] = useState<{
    availableBytes: number | null;
    requiredBytes: number;
    tier: string;
    backend: string;
    platform: string;
    architecture: string;
  } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [expandPadding, setExpandPadding] = useState<ExpandPadding>({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
  const [expandAspectRatio, setExpandAspectRatio] = useState('free');
  const [expandAnchor, setExpandAnchor] = useState<ExpandAnchor>('center');
  const [expandTargetWidth, setExpandTargetWidth] = useState('');
  const [expandTargetHeight, setExpandTargetHeight] = useState('');

  type DialogStatus = 'idle' | 'downloading' | 'qualifying' | 'generating' | 'applying' | 'error';
  const [status, setStatus] = useState<DialogStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<GenerativeEditResult | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [variations, setVariations] = useState<
    Array<{
      id: string;
      dataUrl: string;
      thumbnailDataUrl?: string;
      patchDataUrl: string;
      patchWidth: number;
      patchHeight: number;
      patchFrame?: SourceImageRegion;
      assetKind: 'full-output' | 'region-overlay';
      result: GenerativeEditResult;
      seed: number;
    }>
  >([]);
  const [activeVariationId, setActiveVariationId] = useState<string | null>(null);
  const [hasMaskStrokes, setHasMaskStrokes] = useState(false);
  const [maskHealth, setMaskHealth] = useState<SelectionHealth>(() => emptySelectionHealth());
  const [maskRevision, setMaskRevision] = useState(0);
  const [reviewedObjectSelectionKey, setReviewedObjectSelectionKey] = useState<string | null>(null);
  const [reviewedObjectSelectionAt, setReviewedObjectSelectionAt] = useState<number | null>(null);
  const [isRefiningMask, setIsRefiningMask] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [previewZoom, setPreviewZoom] = useState<'fit' | 'custom'>('fit');
  const [customZoomBase, setCustomZoomBase] = useState<'fit' | 'natural'>('fit');
  const [zoomPercent, setZoomPercent] = useState(100);
  const [maskVisible, setMaskVisible] = useState(true);
  const [previewViewport, setPreviewViewport] = useState({ width: 0, height: 0 });
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStage, setGenerationStage] = useState('Preparing');
  const lastPaintPointRef = useRef<{ x: number; y: number } | null>(null);
  return {
    abortTransaction,
    activeVariationId,
    announce,
    backdropPressRef,
    beginTransaction,
    brushSize,
    commitTransaction,
    contextPadding,
    currentJobSnapshotRef,
    customZoomBase,
    dialogRef,
    diffusionDownloadAbortRef,
    diffusionModelDownloadAvailable,
    diffusionModelHandle,
    diffusionModelImportAvailable,
    diffusionModelInstalled,
    diffusionModelQualificationAvailable,
    diffusionModelReason,
    diffusionModelSize,
    diffusionResource,
    downloadAbortRef,
    downloadProgress,
    editableSourceMaskRef,
    errorMessage,
    expandAnchor,
    expandAspectRatio,
    expandPadding,
    expandTargetHeight,
    expandTargetWidth,
    generationProgress,
    generationRef,
    generationStage,
    guidanceScale,
    hasMaskStrokes,
    imageGuidanceScale,
    isOpen,
    isPaintingRef,
    isRefiningMask,
    jobControllerRef,
    lastPaintPointRef,
    maskCanvasRef,
    maskExpansion,
    maskFeather,
    maskHealth,
    maskOperation,
    maskOrigin,
    maskRevision,
    maskRevisionRef,
    maskVisible,
    mode,
    modelAvailable,
    modelFitsMemory,
    naturalSize,
    negativePrompt,
    nodeId,
    onApplied,
    onClose,
    previewAreaRef,
    previewCanvasRef,
    previewDataUrl,
    previewViewport,
    previewZoom,
    prompt,
    qualificationAbortRef,
    qualificationRunRef,
    quality,
    result,
    reviewedObjectSelectionAt,
    reviewedObjectSelectionKey,
    seed,
    sessionSourceSignatureRef,
    setActiveVariationId,
    setBrushSize,
    setContextPadding,
    setCustomZoomBase,
    setDiffusionModelDownloadAvailable,
    setDiffusionModelHandle,
    setDiffusionModelImportAvailable,
    setDiffusionModelInstalled,
    setDiffusionModelQualificationAvailable,
    setDiffusionModelReason,
    setDiffusionModelSize,
    setDiffusionResource,
    setDownloadProgress,
    setErrorMessage,
    setExpandAnchor,
    setExpandAspectRatio,
    setExpandPadding,
    setExpandTargetHeight,
    setExpandTargetWidth,
    setGenerationProgress,
    setGenerationStage,
    setGuidanceScale,
    setHasMaskStrokes,
    setImageGuidanceScale,
    setIsRefiningMask,
    setMaskExpansion,
    setMaskFeather,
    setMaskHealth,
    setMaskOperation,
    setMaskOrigin,
    setMaskRevision,
    setMaskVisible,
    setMode,
    setModelAvailable,
    setModelFitsMemory,
    setNaturalSize,
    setNegativePrompt,
    setPreviewDataUrl,
    setPreviewViewport,
    setPreviewZoom,
    setPrompt,
    setQuality,
    setResult,
    setReviewedObjectSelectionAt,
    setReviewedObjectSelectionKey,
    setSeed,
    setSelection,
    setShowOriginal,
    setStatus,
    setSteps,
    setStrength,
    setTool,
    setVariationCount,
    setVariations,
    setZoomPercent,
    showOriginal,
    sourcePreviewImageRef,
    state,
    status,
    steps,
    strength,
    updateDoc,
    variationCount,
    variationSequenceRef,
    variations,
    zoomPercent,
  };
}

export type DialogState = ReturnType<typeof useDialogState>;
