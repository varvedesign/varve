import { useCallback } from 'react';
import { computeSourceRegionFromMaskCoverage } from '../generationRaster';
import {
  combineMaskCoverage,
  maskCoverageFromRgba,
  putMaskCoverage,
  rasterizeMaskStroke,
  resizeMaskCoverage,
} from '../maskOperations';
import {
  analyzeSelectionHealth,
  emptySelectionHealth,
  maskMatchesSourceGeometry,
} from '../selectionHealth';
import type { DialogDerived } from './useDialogDerived';
import type { DialogLifecycle } from './useDialogSessionLifecycle';
import type { DialogState } from './useDialogState';

type Params = DialogState & DialogDerived & DialogLifecycle;
export function useMaskPainting(params: Params) {
  const {
    announce,
    brushSize,
    bumpMaskRevision,
    editableSourceMaskRef,
    hasMaskStrokes,
    invalidatePreview,
    isPaintingRef,
    isProcessing,
    lastPaintPointRef,
    maskCanvasRef,
    maskOperation,
    mode,
    naturalSize,
    setErrorMessage,
    setHasMaskStrokes,
    setMaskHealth,
    setMaskOrigin,
    setReviewedObjectSelectionAt,
    setReviewedObjectSelectionKey,
  } = params;
  const paintAt = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = maskCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (clientX - rect.left) * scaleX;
      const y = (clientY - rect.top) * scaleY;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const current = maskCoverageFromRgba(
        ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      );
      const radius = brushSize / 2;
      const point = {
        x: Math.max(0, Math.min(canvas.width - 1, x)),
        y: Math.max(0, Math.min(canvas.height - 1, y)),
      };
      const incoming = rasterizeMaskStroke(
        { width: canvas.width, height: canvas.height },
        lastPaintPointRef.current,
        point,
        radius,
      );
      lastPaintPointRef.current = point;
      const combined = combineMaskCoverage(current, incoming, maskOperation);
      putMaskCoverage(ctx, combined, {
        width: canvas.width,
        height: canvas.height,
      });
      // A brush edit is authored in preview pixels. Once the user paints, the
      // previous source-resolution provider mask is no longer an exact
      // description of the editable mask, so generation must use the visible
      // canvas representation rather than mixing two coordinate frames.
      editableSourceMaskRef.current = null;
      if (hasMaskStrokes !== combined.some((value) => value > 0)) {
        setHasMaskStrokes(combined.some((value) => value > 0));
      }
      setMaskHealth(analyzeSelectionHealth(combined, canvas.width, canvas.height, mode));
      bumpMaskRevision();
    },
    [brushSize, bumpMaskRevision, hasMaskStrokes, maskOperation, mode],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (isProcessing) return;
      isPaintingRef.current = true;
      lastPaintPointRef.current = null;
      setMaskOrigin('brush');
      e.currentTarget.setPointerCapture(e.pointerId);
      paintAt(e.clientX, e.clientY);
    },
    [isProcessing, paintAt],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isPaintingRef.current) return;
      paintAt(e.clientX, e.clientY);
    },
    [paintAt],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    isPaintingRef.current = false;
    lastPaintPointRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const handleClearMask = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    lastPaintPointRef.current = null;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasMaskStrokes(false);
    setMaskHealth(emptySelectionHealth());
    setMaskOrigin('brush');
    editableSourceMaskRef.current = null;
    setReviewedObjectSelectionKey(null);
    setReviewedObjectSelectionAt(null);
    bumpMaskRevision();
    invalidatePreview();
  }, [bumpMaskRevision, invalidatePreview]);

  const applyMaskCoverage = useCallback(
    (
      coverage: Uint8Array,
      width: number,
      height: number,
      origin:
        | 'pixel-selection'
        | 'layer-mask'
        | 'background-removal'
        | 'image-alpha'
        | 'object-selection',
    ): boolean => {
      const canvas = maskCanvasRef.current;
      if (!canvas || naturalSize.w <= 0 || naturalSize.h <= 0) {
        console.warn('[CAF] mask source unavailable', {
          canvas: Boolean(canvas),
          naturalSize,
          width,
          height,
          coverageLength: coverage.length,
        });
        announce('The source image is still loading; try again in a moment');
        return false;
      }
      try {
        if (
          !Number.isInteger(width) ||
          !Number.isInteger(height) ||
          width <= 0 ||
          height <= 0 ||
          coverage.length !== width * height
        ) {
          throw new Error('The selected mask has invalid dimensions. Choose the source again.');
        }
        if (!maskMatchesSourceGeometry(width, height, naturalSize.w, naturalSize.h)) {
          throw new Error(
            'The selected mask does not match this image geometry. Recreate the selection on the current source.',
          );
        }
        const resized = resizeMaskCoverage(
          coverage,
          { width, height },
          { width: canvas.width, height: canvas.height },
        );
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Mask canvas unavailable');
        const current = maskCoverageFromRgba(
          context.getImageData(0, 0, canvas.width, canvas.height).data,
        );
        const combined = combineMaskCoverage(current, resized, maskOperation);
        putMaskCoverage(context, combined, { width: canvas.width, height: canvas.height });
        // Replace is the only operation that gives us an authoritative source
        // mask without having to reconstruct the existing preview mask. Keep
        // that exact candidate for high-resolution generation; compound
        // operations are deliberately treated as preview-authored until they
        // are implemented at source resolution.
        if (maskOperation === 'replace' && width === naturalSize.w && height === naturalSize.h) {
          const bounds = computeSourceRegionFromMaskCoverage(coverage, width, height, 0);
          editableSourceMaskRef.current = bounds
            ? { coverage: coverage.slice(), width, height, bounds }
            : null;
        } else {
          editableSourceMaskRef.current = null;
        }
        setHasMaskStrokes(combined.some((value) => value > 0));
        setMaskHealth(analyzeSelectionHealth(combined, canvas.width, canvas.height, mode));
        setMaskOrigin(origin);
        bumpMaskRevision();
        invalidatePreview();
        setErrorMessage(null);
        return true;
      } catch (err) {
        console.warn('[CAF] mask application failed', err);
        announce(err instanceof Error ? err.message : 'The mask could not be loaded');
        return false;
      }
    },
    [
      announce,
      bumpMaskRevision,
      invalidatePreview,
      maskOperation,
      mode,
      naturalSize.h,
      naturalSize.w,
    ],
  );
  const handleInvertMask = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas || !hasMaskStrokes) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const coverage = maskCoverageFromRgba(imageData.data);
    for (let i = 0; i < coverage.length; i += 1) coverage[i] = 255 - coverage[i]!;
    putMaskCoverage(context, coverage, { width: canvas.width, height: canvas.height });
    if (editableSourceMaskRef.current?.coverage) {
      for (let i = 0; i < editableSourceMaskRef.current.coverage.length; i += 1) {
        editableSourceMaskRef.current.coverage[i] =
          255 - editableSourceMaskRef.current.coverage[i]!;
      }
    } else if (editableSourceMaskRef.current) {
      // A persisted mask reference is lazy and cannot be inverted in place
      // without decoding the whole source. The visible preview is now the
      // edited authority, so revoke the lazy reference safely.
      editableSourceMaskRef.current = null;
    }
    setHasMaskStrokes(coverage.some((value) => value > 0));
    setMaskHealth(analyzeSelectionHealth(coverage, canvas.width, canvas.height, mode));
    setMaskOrigin('brush');
    setReviewedObjectSelectionKey(null);
    setReviewedObjectSelectionAt(null);
    bumpMaskRevision();
    invalidatePreview();
  }, [bumpMaskRevision, hasMaskStrokes, invalidatePreview, mode]);
  return {
    applyMaskCoverage,
    handleClearMask,
    handleInvertMask,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    paintAt,
  };
}

export type DialogMaskPainting = ReturnType<typeof useMaskPainting>;
