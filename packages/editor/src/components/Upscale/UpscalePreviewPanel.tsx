/**
 * UpscalePreviewPanel — the inspection surface for Enhance image.
 *
 * Extracted from UpscaleDialog so the comparison viewport owns its own view
 * mode, zoom, pan, inspect region, status, and error presentation instead of
 * growing the dialog's component body.
 *
 * Viewport contract (mirrors Effect Studio's preview viewport):
 * - **Fit** measures the stage through a ResizeObserver and scales the bitmap
 *   on both axes from what is actually available, so the preview keeps its
 *   true aspect at every window size. Fit never changes the document or the
 *   canvas camera. Nothing clamps one axis after the fact: a height-only
 *   clamp is what used to squash non-square sources on short windows.
 * - **100%** is one CSS pixel per encoded preview pixel; **200%** doubles that
 *   display scale. Both are display-only: zoom never changes the pixels the
 *   restoration pipeline produced.
 * - Both comparison sides share one measured box, so a split at any zoom still
 *   lines up with the pixels it is revealing.
 * - The stage has a fixed size at every zoom: it is bounded by the dialog, so
 *   a zoomed bitmap pans *inside* it and never grows the dialog or pushes the
 *   controls under the fold.
 * - At 100% and 200% the stage pans by dragging (Before and After), the wheel,
 *   scrollbars, or arrow keys once focused; **Center** restores the inspection
 *   origin.
 * - While comparing, dragging the image moves the before/after split — the
 *   established Enhance gesture — so panning there uses the wheel, scrollbars
 *   and arrow keys instead of stealing that gesture.
 * - The view mode is the *user's intent*, kept separate from what currently
 *   has pixels: After and Compare stay selectable while a preview is
 *   generating or failed so that notice is reachable, and only a missing
 *   source image disables Before.
 * - **Inspect region** chooses which part of the source the pipeline computes.
 *   It sits under the stage beside the hint that describes what is showing,
 *   as a compact list whose own description names the region and its source
 *   pixels, because re-cropping the comparison is a choice, not a detail.
 * - No placeholder is ever labelled as processed output, and a failed preview
 *   stays a visible, retryable error instead of a console-only one.
 */
import { Button, SegmentedControl, Select } from '@varve/ui';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { usePanOnDrag } from '../../hooks/usePanOnDrag';
import { regionKey, regionOptions } from './previewRegions';

/**
 * Stage size assumed before the ResizeObserver reports the real one. Purely
 * the first frame's fallback — every subsequent layout uses the measured box.
 */
const PREVIEW_FIT_BOUNDS = { width: 720, height: 560 } as const;

type PreviewView = 'before' | 'after' | 'compare';
type PreviewZoom = 'fit' | '100%' | '200%';

const VIEW_OPTIONS = [
  { value: 'before', label: 'Before' },
  { value: 'after', label: 'After' },
  { value: 'compare', label: 'Compare' },
] as const;

const ZOOM_OPTIONS = [
  { value: 'fit', label: 'Fit' },
  { value: '100%', label: '100%' },
  { value: '200%', label: '200%' },
] as const;

/** Largest scale at which the reference bitmap still fits the measured stage. */
function fitScale(
  width: number,
  height: number,
  available: { width: number; height: number },
): number {
  return Math.min(available.width / Math.max(1, width), available.height / Math.max(1, height));
}

/** Integer CSS size, floored so rounding can never push the bitmap past the stage. */
function fitPx(value: number, available: number): number {
  return Math.max(1, Math.min(Math.floor(value), Math.floor(available)));
}

export interface UpscalePreviewPanelProps {
  /** Untouched source crop, or the source itself before a crop is generated. */
  sourceDataUrl: string;
  /** Same crop straight from the source; the authoritative "before" side. */
  baselineUrl: string | null;
  /** Actual restoration output for the same crop. */
  enhancedUrl: string | null;
  /** Display-box dimensions at 100% for the active crop. */
  referenceWidth: number;
  referenceHeight: number;
  previewGenerating: boolean;
  previewError: string | null;
  onRetry: () => void;
  canRetry: boolean;
  previewFocus: { x: number; y: number };
  onPreviewFocusChange: (focus: { x: number; y: number }) => void;
  pixelArt: boolean;
  /** Operation-specific label for the "after" side ("Enhanced", "Denoised"). */
  afterLabel: string;
  /** Short status shown beside the Preview heading. */
  statusText: string;
  /** Opt-in explanation shown when an AI preview has not been generated. */
  aiHint?: string | null;
  /** Full-resolution output readout for the current settings. */
  outputNote: string;
  /** What the inspect region currently selects, e.g. "Center · 144 x 256 px of 476 x 848 px". */
  inspectNote: string;
  /**
   * Source dimensions and the bounded window the pipeline computes, used only
   * by the navigator. Optional: a caller that predates the navigator gets no
   * navigator rather than a crashed modal — this prop once arrived missing and
   * took the whole editor down with `region.x`.
   */
  sourceWidth?: number;
  sourceHeight?: number;
  region?: { x: number; y: number; width: number; height: number };
}

export function UpscalePreviewPanel({
  sourceDataUrl,
  baselineUrl,
  enhancedUrl,
  referenceWidth,
  referenceHeight,
  previewGenerating,
  previewError,
  onRetry,
  canRetry,
  previewFocus,
  onPreviewFocusChange,
  pixelArt,
  afterLabel,
  statusText,
  aiHint,
  outputNote,
  inspectNote,
  sourceWidth = 0,
  sourceHeight = 0,
  region,
}: UpscalePreviewPanelProps) {
  const [view, setView] = useState<PreviewView>('compare');
  const [zoom, setZoom] = useState<PreviewZoom>('fit');
  const [split, setSplit] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const viewportRef = useRef<HTMLElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);

  // Measure the stage itself. Sizing Fit from a hard-coded box and then
  // clamping the result with max-height let one axis shrink while the other
  // did not, which squashed any source whose aspect was not already square.
  const [availableBox, setAvailableBox] = useState<{ width: number; height: number }>(
    PREVIEW_FIT_BOUNDS,
  );

  // Read the stage before the first paint so the first frame is already sized
  // from the real box rather than from PREVIEW_FIT_BOUNDS and then corrected.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || el.clientWidth <= 0 || el.clientHeight <= 0) return;
    setAvailableBox({ width: el.clientWidth, height: el.clientHeight });
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      setAvailableBox((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Whether each side has pixels to paint. The user's intent (`view`) is kept
  // separate from this so a still-generating or failed preview can show its
  // notice instead of silently snapping back to the source.
  const canRenderBefore = Boolean(baselineUrl ?? sourceDataUrl);
  const canRenderAfter = Boolean(enhancedUrl);
  const activeView: PreviewView =
    view === 'compare'
      ? canRenderBefore && canRenderAfter
        ? 'compare'
        : canRenderAfter
          ? 'after'
          : 'before'
      : view;

  const zoomFactor = zoom === '200%' ? 2 : 1;
  const isFit = zoom === 'fit';
  const factor = isFit ? fitScale(referenceWidth, referenceHeight, availableBox) : zoomFactor;
  const boxWidth = isFit
    ? fitPx(referenceWidth * factor, availableBox.width)
    : Math.max(1, Math.round(referenceWidth * factor));
  const boxHeight = isFit
    ? fitPx(referenceHeight * factor, availableBox.height)
    : Math.max(1, Math.round(referenceHeight * factor));
  // One box, exact to the measured stage: the bitmap keeps its true aspect at
  // every zoom, so Fit never letterboxes wrong and never squashes.
  const surfaceStyle: CSSProperties = { width: `${boxWidth}px`, height: `${boxHeight}px` };

  const centerViewport = useCallback(() => {
    const el = viewportRef.current;
    // `scrollTo` is missing in some test DOM shims; a real browser always has it.
    if (!el || typeof el.scrollTo !== 'function') return;
    el.scrollTo({
      left: Math.max(0, (el.scrollWidth - el.clientWidth) / 2),
      top: Math.max(0, (el.scrollHeight - el.clientHeight) / 2),
    });
  }, []);

  // Changing the zoom resets the preview-only pan, so a 2x view always opens
  // on the same inspection origin instead of wherever the previous zoom
  // left the scroll offset.
  useEffect(() => {
    centerViewport();
  }, [zoom, centerViewport, referenceWidth, referenceHeight]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  // Pan by dragging, in every zoomed view except the comparison (where a drag
  // is the split). The scroll container is the single source of pan state, so
  // wheel, scrollbars, arrow keys and drag can never disagree about where the
  // view is.
  const comparing = activeView === 'compare' && canRenderAfter;
  const { isPanning, panHandlers } = usePanOnDrag(viewportRef, zoom !== 'fit' && !comparing);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging || !imageRef.current) return;
      const rect = imageRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setSplit(Math.max(0, Math.min(100, (x / rect.width) * 100)));
    },
    [isDragging],
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleSplitKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        setSplit((value) => Math.max(0, value - step));
        break;
      case 'ArrowRight':
        e.preventDefault();
        setSplit((value) => Math.min(100, value + step));
        break;
      case 'Home':
        e.preventDefault();
        setSplit(0);
        break;
      case 'End':
        e.preventDefault();
        setSplit(100);
        break;
      default:
        break;
    }
  }, []);

  const surfaceBoxClass = [
    'upscale-preview__image-container',
    zoom !== 'fit' ? 'upscale-preview__image-container--zoomed' : '',
    activeView === 'compare' && canRenderAfter
      ? 'upscale-preview__image-container--comparable'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const rendering: CSSProperties['imageRendering'] = pixelArt ? 'pixelated' : 'auto';

  // Navigator: the whole source, capped so it stays a small reference rather
  // than a second stage, with the computed window drawn over it. Rendered only
  // when both the source size and the window are actually known — dereferencing
  // a missing `region` white-screened the editor instead of degrading.
  const win = region;
  const showNavigator = Boolean(win) && sourceWidth > 0 && sourceHeight > 0;
  const srcW = Math.max(1, sourceWidth);
  const srcH = Math.max(1, sourceHeight);
  const navWidth = showNavigator ? Math.min(120, 76 * (srcW / srcH)) : 0;
  const navHeight = showNavigator ? navWidth * (srcH / srcW) : 0;
  const windowStyle: CSSProperties | undefined = win
    ? {
        left: `${(win.x / srcW) * navWidth}px`,
        top: `${(win.y / srcH) * navHeight}px`,
        width: `${Math.max(3, (win.width / srcW) * navWidth)}px`,
        height: `${Math.max(3, (win.height / srcH) * navHeight)}px`,
      }
    : undefined;

  return (
    <div className="upscale-preview">
      <div className="upscale-preview__toolbar">
        <div className="upscale-preview__toolbar-heading">
          <span className="upscale-preview__toolbar-label">Preview</span>
          <span className="upscale-preview__toolbar-status">{statusText}</span>
        </div>
        <div className="upscale-preview__toolbar-controls">
          <SegmentedControl
            label="Preview view"
            value={activeView}
            options={VIEW_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
              // Sides stay selectable while their pixels are pending so the
              // generating/failed notice is reachable; only a missing source
              // disables Before outright.
              disabled: option.value === 'before' && !canRenderBefore,
              disabledReason: 'No source image is available',
            }))}
            onChange={(value) => setView(value)}
          />
          <div className="upscale-preview__control-group">
            <SegmentedControl
              label="Preview zoom"
              value={zoom}
              options={ZOOM_OPTIONS}
              onChange={(value) => setZoom(value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={zoom === 'fit'}
              onClick={centerViewport}
            >
              Center
            </Button>
          </div>
        </div>
      </div>

      <div className="upscale-preview__stage">
        <section
          ref={viewportRef}
          className={[
            'upscale-preview__viewport',
            zoom !== 'fit' ? 'upscale-preview__viewport--zoomed' : '',
            isPanning ? 'upscale-preview__viewport--panning' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          data-zoom={zoom}
          aria-label="Preview viewport"
          tabIndex={zoom === 'fit' ? -1 : 0}
          {...panHandlers}
        >
          <div
            ref={imageRef}
            className={surfaceBoxClass}
            style={surfaceStyle}
            onPointerDown={
              activeView === 'compare' && canRenderAfter ? handlePointerDown : undefined
            }
            onPointerMove={
              activeView === 'compare' && canRenderAfter ? handlePointerMove : undefined
            }
            onPointerUp={activeView === 'compare' && canRenderAfter ? handlePointerUp : undefined}
            onPointerCancel={
              activeView === 'compare' && canRenderAfter ? handlePointerUp : undefined
            }
          >
            {canRenderBefore && (
              <img
                src={baselineUrl ?? (sourceDataUrl || undefined)}
                alt="Original preview — same crop as enhanced output"
                className="upscale-preview__image upscale-preview__image--original"
                style={{ width: '100%', height: '100%', imageRendering: rendering }}
              />
            )}

            {/* The result side is driven by the user's intent, not by what is
              renderable, so the pending/failed notice is reachable. Before a
              preview lands there are no processed pixels to paint — the notice
              stands in for them, it is never labelled as processed output. */}
            {view !== 'before' &&
              (canRenderAfter ? (
                <div
                  className="upscale-preview__overlay"
                  style={{
                    clipPath: view === 'compare' ? `inset(0 0 0 ${split}%)` : undefined,
                    display: view === 'compare' ? undefined : 'block',
                  }}
                >
                  <img
                    src={enhancedUrl ?? undefined}
                    alt="Enhanced preview — same crop and output size as original"
                    className="upscale-preview__image upscale-preview__image--upscaled"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'fill',
                      imageRendering: rendering,
                    }}
                  />
                </div>
              ) : previewGenerating ? null : (
                /* While generating, the message lives only in the live status
                 * row below the stage: showing it here as well would print the
                 * same words twice for anyone reading the screen. */
                <div className="upscale-preview__pending">
                  {previewError ? (
                    <span className="upscale-preview__pending-error">Preview failed</span>
                  ) : (
                    'No processed preview yet'
                  )}
                </div>
              ))}

            {view === 'compare' && canRenderAfter && (
              <div
                className="upscale-preview__slider"
                role="slider"
                aria-label="Before / after comparison"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(split)}
                aria-valuetext={`${Math.round(split)}% enhanced`}
                tabIndex={0}
                style={
                  {
                    '--upscale-slider-position': `${split}%`,
                  } as CSSProperties & { '--upscale-slider-position': string }
                }
                onKeyDown={handleSplitKeyDown}
              >
                <div className="upscale-preview__slider-line" />
                <div
                  className={`upscale-preview__slider-handle ${
                    split <= 0
                      ? 'upscale-preview__slider-handle--start'
                      : split >= 100
                        ? 'upscale-preview__slider-handle--end'
                        : ''
                  }`.trim()}
                  aria-hidden="true"
                >
                  <span aria-hidden="true">&lt;-&gt;</span>
                </div>
              </div>
            )}

            {/* Both sides are labelled while both are on screen. A side with no
              processed pixels gets the pending notice instead, so a label never
              claims a result that is not there. */}
            {view !== 'after' && canRenderBefore && (
              <span className="upscale-preview__label upscale-preview__label--before">
                Original
              </span>
            )}
            {view !== 'before' && canRenderAfter && (
              <span className="upscale-preview__label upscale-preview__label--after">
                {afterLabel}
              </span>
            )}

            {view !== 'before' && aiHint && !enhancedUrl && (
              <p className="upscale-preview__ai-hint">{aiHint}</p>
            )}
          </div>
        </section>

        {/* One live region for preview state at a time: the stage's pending
          notice is presentational, and either the progress line or the error
          below is announced, never both competing for the same event. The
          progress line is a badge over the stage, not a row under it, so
          generating never changes how much height the stage has. */}
        {previewGenerating && (
          <div
            className="upscale-preview__status-row upscale-preview__status-row--busy"
            role="status"
            aria-live="polite"
          >
            <p className="upscale-preview__hint">Generating preview…</p>
          </div>
        )}
      </div>

      {previewError && (
        <div className="upscale-preview__status-row">
          <p className="upscale-preview__error" role="alert">
            <span>{previewError}</span>
            {canRetry && (
              <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                Retry preview
              </Button>
            )}
          </p>
        </div>
      )}

      {/* The hint and the region control share one line under the stage.
          The navigator beside them is the point: every bounded crop shares the
          source aspect, so at Fit a crop is otherwise indistinguishable from
          the full image — the whole source with the computed window over it is
          what shows this is a sub-rectangle, and the window moves when the
          region changes. */}
      <div className="upscale-preview__footer">
        <p className="upscale-preview__hint">
          {activeView === 'compare' && enhancedUrl
            ? `Drag to compare. 100% shows whether the detail differs. ${outputNote}`
            : zoom === 'fit'
              ? `Fit view. ${outputNote}`
              : `${zoom} pixel view — drag, scroll or use arrow keys to pan; Center recentres. ${outputNote}`}
        </p>
        <div className="upscale-preview__region-group">
          {showNavigator && windowStyle && (
            <span
              className="upscale-preview__navigator"
              style={{ width: `${navWidth}px`, height: `${navHeight}px` }}
              aria-hidden="true"
            >
              <img src={sourceDataUrl || undefined} alt="" />
              <span className="upscale-preview__navigator-window" style={windowStyle} />
            </span>
          )}
          <div className="upscale-preview__control-group upscale-preview__control-group--region">
            <span className="upscale-preview__control-label" aria-hidden="true">
              Inspect region
            </span>
            <Select
              label="Inspect region"
              className="upscale-preview__region-select"
              value={regionKey(previewFocus.x, previewFocus.y)}
              options={regionOptions()}
              description={inspectNote}
              onChange={(value) => {
                const parts = value.split(',');
                const x = Number(parts[0]);
                const y = Number(parts[1]);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                onPreviewFocusChange({ x, y });
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
