import { createEngine, type Engine } from '@varve/engine';
import type { Platform } from '@varve/platform';
import {
  type Document,
  HANDOUT_LAYOUTS,
  type PresentationDeck,
  type PresentationHandoutLayout,
  type PresentationTransition,
  planPresentationHandout,
  type ResolvedPresentationSlide,
  resolvePresentationSlides,
  resolveSlideTransition,
} from '@varve/scene';
import { sanitizeFileName } from '@varve/scene/export';
import { Button, Dialog, Select } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { saveExportBytes } from '../../exportSaveAdapter';
import { PresentationStage, type StageBitmap } from './PresentationStage';
import { PresenterConsole } from './PresenterConsole';
import { capturePresentationFrame, decodePresentationFrame } from './presentationCapture';
import {
  PRESENTATION_EXPORT_EVENT,
  PRESENTATION_PREVIEW_CLOSE_EVENT,
  PRESENTATION_PREVIEW_EVENT,
  setPresentationPreviewOpen,
} from './presentationCommands';
import { resolvePresentationDeliveryScope } from './presentationDeliveryScope';
import {
  makePresentationPngArchive,
  PresentationHandoutPdfBuilder,
  PresentationPdfBuilder,
} from './presentationFormats';
import { SlideLiveRenderer } from './show/showStage';
import {
  computeBuildSchedule,
  type ScheduleInput,
  ShowClock,
  ShowDirector,
} from './show/showTiming';
import './presentationDelivery.css';

type DeliveryMode = 'preview' | 'export';
type OutputFormat = 'pdf' | 'png' | 'handout';

interface DeliverySnapshot {
  mode: DeliveryMode;
  deckId: string;
  document: Document;
  documentId: string;
  revision: number;
  deck: PresentationDeck;
  slides: ResolvedPresentationSlide[];
  deliveryErrors: ResolvedPresentationSlide[];
  selectedScope: boolean;
  startEntryId?: string;
}

interface PresentationDeliveryLayerProps {
  platform?: Platform;
  getEngine?: () => Promise<Engine>;
}

const PREVIEW_CACHE_LIMIT = 6;
const BITMAP_CACHE_LIMIT = 6;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Presentation operation failed. Try again.';
}

function currentSlideIndex(snapshot: DeliverySnapshot): number {
  if (!snapshot.startEntryId) return 0;
  const selected = snapshot.slides.findIndex(({ entry }) => entry.id === snapshot.startEntryId);
  return selected >= 0 ? selected : 0;
}

function slideName(deck: PresentationDeck, entry: ResolvedPresentationSlide['entry']): string {
  return entry.title.trim() || `${deck.name} slide`;
}

function ensureSnapshotCurrent(
  snapshot: DeliverySnapshot,
  state: ReturnType<typeof useEditor>['state'],
): void {
  if (state.document.id !== snapshot.documentId || state.revision !== snapshot.revision) {
    throw new Error(
      'The document changed during this operation. Reopen the deck view and try again.',
    );
  }
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

export function PresentationDeliveryLayer({ platform, getEngine }: PresentationDeliveryLayerProps) {
  const editor = useEditor();
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const engineRef = useRef<Promise<Engine> | null>(null);
  const activeExportRef = useRef<AbortController | null>(null);
  const previewCacheRef = useRef(new Map<string, string>());
  const bitmapsRef = useRef(new Map<string, StageBitmap>());
  const directorRef = useRef<ShowDirector | null>(null);
  const clockRef = useRef(new ShowClock());
  const rendererRef = useRef<SlideLiveRenderer | null>(null);
  const [request, setRequest] = useState<DeliverySnapshot | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [bitmapsVersion, setBitmapsVersion] = useState(0);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outputWarnings, setOutputWarnings] = useState<string[]>([]);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [presenterView, setPresenterView] = useState(false);
  const [handoutLayout, setHandoutLayout] = useState<PresentationHandoutLayout>('3-up');
  const [handoutNoteLines, setHandoutNoteLines] = useState(true);
  const [handoutLandscape, setHandoutLandscape] = useState(false);

  const getEngineOnce = useCallback(() => {
    if (getEngine) return getEngine();
    engineRef.current ??= createEngine('auto');
    return engineRef.current;
  }, [getEngine]);

  const openDelivery = useCallback(
    (mode: DeliveryMode, deckId: string, startEntryId?: string, selectedEntryIds?: string[]) => {
      const document = editorRef.current.state.document;
      const resolution = resolvePresentationSlides(document, deckId);
      if (!resolution.deck) {
        editorRef.current.announce('Choose a presentation deck first');
        return;
      }
      const deliveryScope = resolvePresentationDeliveryScope(resolution, selectedEntryIds);
      const snapshot: DeliverySnapshot = {
        mode,
        deckId,
        document,
        documentId: document.id,
        revision: editorRef.current.state.revision,
        deck: resolution.deck,
        ...deliveryScope,
        ...(startEntryId ? { startEntryId } : {}),
      };
      const startIndex = currentSlideIndex(snapshot);
      if (mode === 'preview' && snapshot.slides.length > 0) {
        const reduced = prefersReducedMotion();
        const inputs: ScheduleInput[] = snapshot.slides.map((slide) => ({
          transition: resolveSlideTransition(snapshot.deck, slide.entry),
          schedule: computeBuildSchedule(slide.entry.builds ?? []),
        }));
        directorRef.current = new ShowDirector(inputs, { reducedMotion: reduced });
        clockRef.current.start(performance.now());
        directorRef.current.enter(startIndex, clockRef.current.now());
      } else {
        directorRef.current = null;
      }
      setReducedMotion(prefersReducedMotion());
      setPresenterView(false);
      setRequest(snapshot);
      setSlideIndex(startIndex);
      setError(null);
      setProgress('');
      setOutputWarnings([]);
      setBitmapsVersion((version) => version + 1);
    },
    [],
  );

  useEffect(() => {
    const handlePreview = (event: Event) => {
      const detail = (event as CustomEvent<{ deckId?: string; entryId?: string }>).detail;
      if (detail?.deckId) openDelivery('preview', detail.deckId, detail.entryId);
    };
    const handleExport = (event: Event) => {
      const detail = (event as CustomEvent<{ deckId?: string; slideEntryIds?: string[] }>).detail;
      if (detail?.deckId) {
        openDelivery('export', detail.deckId, undefined, detail.slideEntryIds);
      }
    };
    window.addEventListener(PRESENTATION_PREVIEW_EVENT, handlePreview);
    window.addEventListener(PRESENTATION_EXPORT_EVENT, handleExport);
    const handleClose = () => setRequest(null);
    window.addEventListener(PRESENTATION_PREVIEW_CLOSE_EVENT, handleClose);
    return () => {
      window.removeEventListener(PRESENTATION_PREVIEW_EVENT, handlePreview);
      window.removeEventListener(PRESENTATION_EXPORT_EVENT, handleExport);
      window.removeEventListener(PRESENTATION_PREVIEW_CLOSE_EVENT, handleClose);
    };
  }, [openDelivery]);

  // The live renderer resolves with the engine; until then the stage shows
  // static captures only, so opening the deck never waits on engine startup.
  useEffect(() => {
    if (request?.mode !== 'preview') return;
    let cancelled = false;
    void (async () => {
      try {
        const engine = await getEngineOnce();
        if (!cancelled) rendererRef.current = new SlideLiveRenderer(engine);
      } catch {
        if (!cancelled) rendererRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getEngineOnce, request]);

  // Report playback state so the canonical "Present" command is a truthful
  // toggle across every entry point (menubar, palette, shortcut, navigator).
  useEffect(() => {
    setPresentationPreviewOpen(request?.mode === 'preview' ? request.deckId : null);
    return () => setPresentationPreviewOpen(null);
  }, [request]);

  useEffect(
    () => () => {
      activeExportRef.current?.abort();
      for (const url of previewCacheRef.current.values()) URL.revokeObjectURL(url);
      previewCacheRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (request?.mode !== 'preview') return;
    const onFullscreenChange = () => {
      if (document.fullscreenElement) setPresenterView(false);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [request]);

  const closeDelivery = useCallback(() => {
    activeExportRef.current?.abort();
    setRequest(null);
    setPresenterView(false);
    directorRef.current = null;
    bitmapsRef.current.clear();
    setError(null);
    setProgress('');
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  /**
   * Static captures feed the stage: the current slide immediately, then the
   * neighbors, so the next advance never waits on a first render (the
   * advance-latency failure mode reported against other tools).
   */
  useEffect(() => {
    if (request?.mode !== 'preview') return;
    if (request.slides.length === 0) {
      setLoadingPreview(false);
      setError(null);
      return;
    }
    const current = request.slides[slideIndex];
    if (!current?.frame) {
      setLoadingPreview(false);
      setError('This slide no longer has valid frame artwork. Return to Slides to repair it.');
      return;
    }
    const controller = new AbortController();
    const ensureBitmap = async (index: number): Promise<StageBitmap | null> => {
      const slide = request.slides[index];
      if (!slide?.frame) return null;
      const existing = bitmapsRef.current.get(slide.entry.id);
      if (existing) return existing;
      const cacheKey = `${request.documentId}:${request.revision}:${request.deckId}:${slide.entry.id}`;
      let url = previewCacheRef.current.get(cacheKey) ?? null;
      if (!url) {
        ensureSnapshotCurrent(request, editorRef.current.state);
        const engine = await getEngineOnce();
        const captured = await capturePresentationFrame(
          request.document,
          slide.entry,
          engine,
          controller.signal,
        );
        url = URL.createObjectURL(captured.blob);
        previewCacheRef.current.set(cacheKey, url);
        while (previewCacheRef.current.size > PREVIEW_CACHE_LIMIT) {
          const oldest = previewCacheRef.current.keys().next().value as string | undefined;
          if (!oldest) break;
          URL.revokeObjectURL(previewCacheRef.current.get(oldest)!);
          previewCacheRef.current.delete(oldest);
        }
      }
      const image = new Image();
      image.src = url;
      await image.decode();
      const bitmap: StageBitmap = {
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        src: url,
      };
      bitmapsRef.current.set(slide.entry.id, bitmap);
      while (bitmapsRef.current.size > BITMAP_CACHE_LIMIT) {
        const oldest = bitmapsRef.current.keys().next().value as string | undefined;
        if (!oldest) break;
        bitmapsRef.current.delete(oldest);
      }
      return bitmap;
    };
    setLoadingPreview(!bitmapsRef.current.has(current.entry.id));
    setError(null);
    void (async () => {
      try {
        ensureSnapshotCurrent(request, editorRef.current.state);
        await ensureBitmap(slideIndex);
        if (controller.signal.aborted) return;
        setBitmapsVersion((version) => version + 1);
        setLoadingPreview(false);
        setOutputWarnings([]);
        // Prefetch neighbors so advance and rewind are instant.
        for (const neighbor of [slideIndex + 1, slideIndex - 1]) {
          if (neighbor < 0 || neighbor >= request.slides.length) continue;
          if (controller.signal.aborted) return;
          try {
            await ensureBitmap(neighbor);
          } catch {
            // Neighbor prefetch failures surface when the slide is shown.
          }
        }
        setBitmapsVersion((version) => version + 1);
      } catch (captureError) {
        if (!controller.signal.aborted) setError(errorMessage(captureError));
        setLoadingPreview(false);
      }
    })();
    return () => controller.abort();
  }, [getEngineOnce, request, slideIndex]);

  const exportDeck = useCallback(
    async (format: OutputFormat) => {
      if (request?.mode !== 'export' || exporting) return;
      if (request.deliveryErrors.length > 0) {
        setError(
          `Cannot export while ${request.deliveryErrors.length} included slide reference(s) need repair. Return to Slides and restore or remove the missing frame references.`,
        );
        return;
      }
      if (request.slides.length === 0) {
        setError('This deck has no included slides. Include at least one slide, then retry.');
        return;
      }

      const controller = new AbortController();
      activeExportRef.current = controller;
      setExporting(true);
      setError(null);
      setOutputWarnings([]);
      const warnings = new Set<string>();
      try {
        const engine = await getEngineOnce();
        const pdfBuilder = new PresentationPdfBuilder();
        const handoutBuilder = format === 'handout' ? new PresentationHandoutPdfBuilder() : null;
        const pngSlides: Array<{ title: string; png: Uint8Array }> = [];
        let archiveBytes = 0;
        for (const [index, slide] of request.slides.entries()) {
          ensureSnapshotCurrent(request, editorRef.current.state);
          if (controller.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
          setProgress(`Rendering slide ${index + 1} of ${request.slides.length}`);
          const captured = await capturePresentationFrame(
            request.document,
            slide.entry,
            engine,
            controller.signal,
          );
          for (const warning of captured.warnings) warnings.add(warning);
          if (format === 'png') {
            const png = new Uint8Array(await captured.blob.arrayBuffer());
            archiveBytes += png.byteLength;
            if (archiveBytes > MAX_ARCHIVE_BYTES) {
              throw new Error(
                'This deck exceeds the 512 MB output limit. Export smaller groups of slides.',
              );
            }
            pngSlides.push({ title: slideName(request.deck, slide.entry), png });
          } else {
            const page = await decodePresentationFrame(captured.blob);
            if (handoutBuilder) handoutBuilder.addSlide(page);
            else pdfBuilder.addPage(page);
          }
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        ensureSnapshotCurrent(request, editorRef.current.state);
        if (controller.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
        setProgress('Preparing file');
        let bytes: Uint8Array;
        let extension: string;
        let mimeType: string;
        if (format === 'pdf') {
          bytes = pdfBuilder.finish();
          extension = '.pdf';
          mimeType = 'application/pdf';
        } else if (format === 'handout' && handoutBuilder) {
          const plan = planPresentationHandout(
            request.slides.map((slide) => ({
              wPx: slide.frame?.w ?? 1920,
              hPx: slide.frame?.h ?? 1080,
            })),
            {
              layout: handoutLayout,
              paper: 'a4',
              orientation: handoutLandscape ? 'landscape' : 'portrait',
              marginPt: 36,
              gapPt: 18,
              slideNumbers: true,
              noteLines: handoutNoteLines,
              footerText: request.deck.name,
            },
          );
          bytes = handoutBuilder.finish(plan, {
            slideNumbers: true,
            footerText: request.deck.name,
          });
          extension = '.pdf';
          mimeType = 'application/pdf';
        } else {
          bytes = makePresentationPngArchive(pngSlides);
          extension = '.zip';
          mimeType = 'application/zip';
        }
        const fileName = sanitizeFileName(
          request.selectedScope ? `${request.deck.name} selected slides` : request.deck.name,
          extension,
        );
        setProgress('Writing file');
        const saved = await saveExportBytes(platform, fileName, bytes, mimeType, extension);
        if (!saved) throw new Error('The save was cancelled or unavailable. No file was written.');
        const warningList = [...warnings];
        setOutputWarnings(warningList);
        editorRef.current.announce(`${format.toUpperCase()} presentation saved: ${saved}`);
        setProgress('File saved');
      } catch (exportError) {
        if (
          controller.signal.aborted ||
          (exportError instanceof DOMException && exportError.name === 'AbortError')
        ) {
          setError('Export cancelled. No file was written. Choose an output again to retry.');
        } else {
          setError(errorMessage(exportError));
        }
        setProgress('');
      } finally {
        activeExportRef.current = null;
        setExporting(false);
      }
    },
    [exporting, getEngineOnce, platform, request],
  );

  const cancelExport = useCallback(() => {
    activeExportRef.current?.abort();
  }, []);

  /**
   * Deterministic advance/rewind through the show director.
   *
   * One click does exactly one thing: complete a running transition, complete
   * a running build effect, start the next build group, or change slides.
   * Rewind and jumps land fully built. Reaching either end announces the
   * boundary instead of wrapping silently.
   */
  const stepSlide = useCallback(
    (delta: 1 | -1) => {
      const director = directorRef.current;
      if (!request || request.slides.length === 0 || !director) return;
      if (delta === 1) {
        const result = director.advance(clockRef.current.now());
        if (result === 'advanced-slide') {
          setSlideIndex(director.slideIndex);
        } else if (result === 'boundary') {
          editorRef.current.announce('End of presentation');
        }
        return;
      }
      if (director.slideIndex > 0) {
        director.previous(clockRef.current.now());
        setSlideIndex(director.slideIndex);
      } else {
        editorRef.current.announce('Start of presentation');
      }
    },
    [request],
  );

  const jumpToSlide = useCallback(
    (index: number) => {
      const director = directorRef.current;
      if (!request || !director) return;
      if (index < 0 || index >= request.slides.length) return;
      director.goto(index, clockRef.current.now());
      setSlideIndex(index);
    },
    [request],
  );

  const handleAudienceKeyDown = useCallback(
    (event: import('react').KeyboardEvent<HTMLDialogElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDelivery();
        return;
      }
      // A focused control that natively activates on Space or Enter must keep
      // that activation: the audience view has no text fields, but its own
      // buttons are reachable by Tab and must not advance the deck twice.
      const target = event.target as Element | null;
      const nativeActivation = Boolean(
        target?.closest?.(
          'button, a[href], input, select, textarea, [role="button"], [role="switch"], [role="checkbox"], [role="menuitem"], [contenteditable="true"]',
        ),
      );
      if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'Enter') {
        if (nativeActivation) return;
        event.preventDefault();
        stepSlide(1);
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault();
        stepSlide(1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        stepSlide(-1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        jumpToSlide(0);
      } else if (event.key === 'End' && request?.slides.length) {
        event.preventDefault();
        jumpToSlide(request.slides.length - 1);
      }
    },
    [closeDelivery, jumpToSlide, request, stepSlide],
  );

  const enterFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      editorRef.current.announce(
        'Fullscreen is unavailable. Audience preview remains open in the top layer.',
      );
    }
  }, []);

  const director = request?.mode === 'preview' ? directorRef.current : null;
  const resolvedTransitions: PresentationTransition[] = request
    ? request.slides.map((slide) => resolveSlideTransition(request.deck, slide.entry))
    : [];
  const blockingSlides = request?.deliveryErrors ?? [];

  return (
    <>
      <Dialog
        open={request?.mode === 'preview'}
        onClose={closeDelivery}
        title={`${request?.deck.name ?? 'Presentation'} — audience preview`}
        size="lg"
        className="presentation-audience-dialog"
        focusFirstControl
        dismissible={false}
        onKeyDown={handleAudienceKeyDown}
      >
        {request?.mode === 'preview' && (
          <div className="presentation-audience">
            {blockingSlides.length > 0 && (
              <p className="presentation-audience__warning" role="status">
                {blockingSlides.length} slide reference(s) need repair. Valid included slides remain
                available for preview.
              </p>
            )}
            {presenterView && director && director.slideCount > 0 ? (
              <PresenterConsole
                slides={request.slides}
                director={director}
                clock={clockRef.current}
                bitmaps={bitmapsRef.current}
                bitmapsVersion={bitmapsVersion}
                onRequestPrevious={() => stepSlide(-1)}
                onRequestAdvance={() => stepSlide(1)}
                onShowAudience={() => setPresenterView(false)}
              />
            ) : (
              <section
                className="presentation-audience__stage"
                aria-live="polite"
                aria-label="Slide stage"
                tabIndex={-1}
                data-autofocus
              >
                {director && request.slides.length > 0 ? (
                  <PresentationStage
                    document={request.document}
                    revision={request.revision}
                    slides={request.slides}
                    transitions={resolvedTransitions}
                    director={director}
                    clock={clockRef.current}
                    renderer={rendererRef.current}
                    bitmaps={bitmapsRef.current}
                    bitmapsVersion={bitmapsVersion}
                    reducedMotion={reducedMotion}
                  />
                ) : null}
                {loadingPreview && <p role="status">Preparing slide…</p>}
                {error && (
                  <p className="presentation-audience__error" role="alert">
                    {error}
                  </p>
                )}
                {!loadingPreview && !error && request.slides.length === 0 && (
                  <p role="status">
                    No slides are included. Include a slide in the Slides panel to start.
                  </p>
                )}
              </section>
            )}
            <div className="presentation-audience__controls">
              <Button size="sm" variant="ghost" onClick={() => jumpToSlide(0)}>
                Start from beginning
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => stepSlide(-1)}
                disabled={request.slides.length < 2 || slideIndex === 0}
              >
                Previous
              </Button>
              <span aria-live="polite">
                {request.slides.length === 0
                  ? 'No included slides'
                  : `Slide ${slideIndex + 1} of ${request.slides.length}`}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => stepSlide(1)}
                disabled={request.slides.length < 2 || slideIndex >= request.slides.length - 1}
              >
                Next
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPresenterView(true)}
                disabled={presenterView}
              >
                Presenter view
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void enterFullscreen()}>
                Fullscreen
              </Button>
              <Button size="sm" variant="default" onClick={closeDelivery}>
                Exit
              </Button>
            </div>
            {outputWarnings.length > 0 && (
              <p className="presentation-audience__warning" role="status">
                {outputWarnings.join(' ')}
              </p>
            )}
          </div>
        )}
      </Dialog>

      <Dialog
        open={request?.mode === 'export'}
        onClose={closeDelivery}
        title={`Export ${request?.deck.name ?? 'presentation'}${request?.selectedScope ? ' — selected slides' : ''}`}
        size="lg"
        className="presentation-export-dialog"
        dismissible={false}
      >
        {request?.mode === 'export' && (
          <div className="presentation-delivery">
            <p>
              {request.slides.length} included slide(s)
              {request.selectedScope ? ' from the selected slide references' : ' in this deck'}.
              Skipped and hidden slides, notes, and artwork outside this scope are excluded.
            </p>
            {request.slides.length === 0 && (
              <p role="status">
                No slides are included. Return to Slides to add a frame or include a skipped slide.
              </p>
            )}
            <p className="presentation-delivery__limit">
              PDF output is a compressed raster screen document. Text and vectors are not editable,
              notes are private, and the PDF does not contain tagged accessibility structure. The
              handout imposes the same raster slides onto paper pages; only page numbers and header
              text are real text.
            </p>
            <div className="presentation-delivery__handout">
              <Select
                label="Handout layout"
                aria-label="Handout layout"
                value={handoutLayout}
                onValueChange={(value) => setHandoutLayout(value as PresentationHandoutLayout)}
                options={HANDOUT_LAYOUTS.map((layout) => ({ value: layout, label: layout }))}
              />
              <Select
                label="Handout orientation"
                aria-label="Handout orientation"
                value={handoutLandscape ? 'landscape' : 'portrait'}
                onValueChange={(value) => setHandoutLandscape(value === 'landscape')}
                options={[
                  { value: 'portrait', label: 'Portrait' },
                  { value: 'landscape', label: 'Landscape' },
                ]}
              />
              <label className="presentation-delivery__handout-toggle">
                <input
                  type="checkbox"
                  checked={handoutNoteLines}
                  onChange={(event) => setHandoutNoteLines(event.currentTarget.checked)}
                />
                <span>Note-taking lines (3-up)</span>
              </label>
            </div>
            {blockingSlides.length > 0 && (
              <div className="presentation-delivery__error" role="alert">
                {blockingSlides.length} included slide reference(s) need repair before export.
              </div>
            )}
            {error && (
              <div className="presentation-delivery__error" role="alert">
                {error}
              </div>
            )}
            {progress && <p role="status">{progress}</p>}
            {exporting && (
              <progress
                aria-label="Presentation export progress"
                max={request.slides.length}
                value={undefined}
              />
            )}
            {outputWarnings.length > 0 && (
              <ul
                className="presentation-delivery__warnings"
                aria-label="Presentation export warnings"
              >
                {outputWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <div className="presentation-delivery__actions">
              {exporting ? (
                <Button variant="ghost" onClick={cancelExport}>
                  Cancel export
                </Button>
              ) : (
                <>
                  <Button
                    variant="default"
                    disabled={request.slides.length === 0 || blockingSlides.length > 0}
                    onClick={() => void exportDeck('pdf')}
                  >
                    Export PDF
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={request.slides.length === 0 || blockingSlides.length > 0}
                    onClick={() => void exportDeck('png')}
                  >
                    Export PNG sequence
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={request.slides.length === 0 || blockingSlides.length > 0}
                    onClick={() => void exportDeck('handout')}
                  >
                    Export handout PDF
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
