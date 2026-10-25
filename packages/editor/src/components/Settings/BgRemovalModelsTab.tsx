/**
 * Settings tab — all offline AI models (ADR-0005 unified catalog).
 *
 * Shows models from every category (segmentation, upscaling, denoising, depth,
 * interactive segmentation) in grouped sections with download/delete controls.
 */

import {
  type BackgroundRemovalReadiness,
  deriveAcquisition,
  getBackgroundRemovalReadiness,
  getModelInfo,
  getModelLoaderReady,
  getRuntimeCapabilitiesSync,
  listAllModels,
  type RemovalMethod,
  resolveModelPeakMemoryBytes,
  type WorkerModelId,
  workerModelIdForMethod,
} from '@varve/engine';
import { Button, RegionLoader } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatModelBytes, modelRequirementLabel } from '../../modelRequirements';
import { ModelDownloadDialog } from '../BackgroundRemoval/ModelDownloadDialog';

interface InstalledModelRow {
  id: string;
  name: string;
  size: number;
  peakMemoryBytes?: number;
  installed: boolean;
  source: 'bundled' | 'downloaded' | 'none';
  downloadable: boolean;
  description?: string;
  precision?: 'fp32' | 'int8';
  isQuantized: boolean;
  /** Present for multi-file models (e.g. SAM2's separate encoder + decoder
   * graphs) — download/delete acts on every id in this list as one unit
   * instead of showing each part as its own row. */
  componentIds?: string[];
  componentSizes?: Record<string, number>;
  readiness?: BackgroundRemovalReadiness;
  readinessError?: string;
  memoryDisclosure?: string;
}

const REMOVAL_METHODS: Record<string, RemovalMethod> = {
  u2netp: 'ai-balanced',
  'u2netp-int8': 'ai-balanced',
  'isnet-general-use': 'ai-balanced',
  'birefnet-general-lite': 'ai-quality',
  'birefnet-general': 'ai-quality',
  'modnet-portrait': 'portrait',
};

async function removalReadiness(
  modelId: string,
): Promise<Pick<InstalledModelRow, 'readiness' | 'readinessError' | 'memoryDisclosure'>> {
  const method = REMOVAL_METHODS[modelId];
  if (!method) return {};
  const memoryDisclosure = getModelInfo(method)?.peakRamDisplay;
  try {
    return {
      memoryDisclosure,
      readiness: await getBackgroundRemovalReadiness(method, modelId as WorkerModelId),
    };
  } catch (failure) {
    return {
      memoryDisclosure,
      readinessError:
        failure instanceof Error
          ? failure.message
          : 'Could not check this model. Retry the model check.',
    };
  }
}

function storageLabel(): string {
  if (getRuntimeCapabilitiesSync().isTauri) {
    return 'the app model folder or this webview’s IndexedDB, depending on the model';
  }
  if (typeof indexedDB !== 'undefined') {
    return 'IndexedDB on this device (browser / desktop webview)';
  }
  return 'Local storage unavailable in this environment';
}

async function buildRows(
  loader: Awaited<ReturnType<typeof getModelLoaderReady>>,
): Promise<InstalledModelRow[]> {
  const catalog = listAllModels();
  // Component ids (e.g. SAM2's encoder/decoder) are downloadable individually
  // by the tools that use them, but shouldn't also show as their own rows
  // here — their parent multiComponent entry represents them as one unit.
  const hiddenComponentIds = new Set(catalog.flatMap((m) => m.components?.map((c) => c.id) ?? []));
  // Semantic-search models (SigLIP image/text towers + tokenizer) are
  // managed by the dedicated SemanticSearchTab.
  const catalogFiltered = catalog.filter((m) => m.category !== 'embedding');
  const results: InstalledModelRow[] = [];

  for (const model of catalogFiltered) {
    if (hiddenComponentIds.has(model.id)) continue;

    if (model.multiComponent && model.components && model.components.length > 0) {
      const componentAvailability = await Promise.all(
        model.components.map((c) => loader.isModelAvailable(c.id)),
      );
      results.push({
        id: model.id,
        name: model.name,
        size: model.components.reduce((sum, c) => sum + c.sizeBytes, 0),
        peakMemoryBytes: resolveModelPeakMemoryBytes(model, {
          native: getRuntimeCapabilitiesSync().isTauri,
        }),
        installed: componentAvailability.every(Boolean),
        source: componentAvailability.some(Boolean) ? 'downloaded' : 'none',
        downloadable: model.components.every((c) => Boolean(c.remoteUrl)),
        description: model.description,
        precision: model.precision as 'fp32' | 'int8' | undefined,
        isQuantized: model.precision === 'int8',
        componentIds: model.components.map((c) => c.id),
        componentSizes: Object.fromEntries(model.components.map((c) => [c.id, c.sizeBytes])),
      });
      continue;
    }

    const status = await removalReadiness(model.id);
    const installed = status.readiness?.installed ?? (await loader.isModelAvailable(model.id));
    results.push({
      id: model.id,
      name: model.name,
      size: model.sizeBytes,
      peakMemoryBytes: resolveModelPeakMemoryBytes(model, {
        native: getRuntimeCapabilitiesSync().isTauri,
      }),
      installed,
      source: model.bundled
        ? 'bundled'
        : (await loader.hasDownloadedBlob?.(model.id))
          ? 'downloaded'
          : 'none',
      downloadable: deriveAcquisition(model).kind === 'remote',
      description: model.description,
      precision: model.precision as 'fp32' | 'int8' | undefined,
      isQuantized: model.precision === 'int8',
      ...status,
    });
  }

  return results;
}

const CATEGORY_LABELS: Record<string, string> = {
  segmentation: 'Background Removal',
  upscaling: 'Image Upscaling',
  denoising: 'AI Denoising',
  depth: 'Depth Estimation',
  classification: 'Classification',
  detection: 'Object Detection',
  ocr: 'Text Recognition',
  other: 'Other',
};

export function BgRemovalModelsTab() {
  const [allRows, setAllRows] = useState<InstalledModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadModelId, setDownloadModelId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [compositeDownload, setCompositeDownload] = useState<{
    id: string;
    progress: number;
  } | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const refreshIdRef = useRef(0);
  const operationRef = useRef<string | null>(null);
  const compositeAbortRef = useRef<AbortController | null>(null);
  const [bundleStatus, setBundleStatus] = useState<'unknown' | 'verified' | 'corrupt' | 'skipped'>(
    'unknown',
  );

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    const refreshId = ++refreshIdRef.current;
    const current = () => mountedRef.current && refreshId === refreshIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const loader = await getModelLoaderReady();
      if (!current()) return;
      const verify = await loader.verifyBundledModel('u2netp');
      const rows = await buildRows(loader);
      if (!current()) return;
      setBundleStatus(verify);
      setAllRows(rows);
    } catch (error) {
      if (current()) {
        setLoadError(error instanceof Error ? error.message : 'Could not read model status.');
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void refresh();
    void getModelLoaderReady()
      .then((loader) => {
        if (!disposed) {
          unsubscribe = loader.subscribe(() => {
            void refresh();
          });
        }
      })
      .catch(() => {
        /* refresh owns the visible initialization error */
      });
    return () => {
      disposed = true;
      mountedRef.current = false;
      refreshIdRef.current++;
      unsubscribe?.();
      compositeAbortRef.current?.abort();
    };
  }, [refresh]);

  const handleDelete = async (row: InstalledModelRow) => {
    if (operationRef.current) return;
    operationRef.current = row.id;
    setRowError(null);
    setBusyId(row.id);
    try {
      const loader = await getModelLoaderReady();
      for (const id of row.componentIds ?? [row.id]) {
        if (!mountedRef.current) return;
        await loader.deleteModel(id);
      }
      await refresh();
    } catch (error) {
      if (mountedRef.current) {
        setRowError({
          id: row.id,
          message: error instanceof Error ? error.message : 'Could not remove this model.',
        });
        await refresh();
      }
    } finally {
      operationRef.current = null;
      if (mountedRef.current) setBusyId(null);
    }
  };

  const handleCompositeDownload = useCallback(
    async (row: InstalledModelRow) => {
      const componentIds = row.componentIds;
      if (!componentIds || componentIds.length === 0 || operationRef.current) return;
      operationRef.current = row.id;
      setRowError(null);
      setCompositeDownload({ id: row.id, progress: 0 });
      const controller = new AbortController();
      compositeAbortRef.current = controller;
      const loaded = new Map<string, number>();
      const totals = new Map(componentIds.map((id) => [id, row.componentSizes?.[id] ?? 0]));
      try {
        const loader = await getModelLoaderReady();
        for (const id of componentIds) {
          if (controller.signal.aborted) return;
          await loader.downloadModel(
            id,
            (partLoaded, partTotal) => {
              if (controller.signal.aborted || !mountedRef.current) return;
              loaded.set(id, partLoaded);
              if (partTotal > 0) totals.set(id, partTotal);
              const sumLoaded = [...loaded.values()].reduce((a, b) => a + b, 0);
              const sumTotal = [...totals.values()].reduce((a, b) => a + b, 0);
              setCompositeDownload({
                id: row.id,
                progress:
                  sumTotal > 0 ? Math.min(100, Math.round((sumLoaded / sumTotal) * 100)) : 0,
              });
            },
            controller.signal,
          );
        }
      } catch (err) {
        if (!controller.signal.aborted && mountedRef.current) {
          setRowError({
            id: row.id,
            message:
              err instanceof Error
                ? err.message
                : 'Download failed. Check your connection and retry.',
          });
        }
      } finally {
        operationRef.current = null;
        compositeAbortRef.current = null;
        if (mountedRef.current) {
          setCompositeDownload(null);
          // A failed or cancelled multi-part download can still have completed parts.
          await refresh();
        }
      }
    },
    [refresh],
  );

  const handleCompositeCancel = useCallback(() => {
    compositeAbortRef.current?.abort();
  }, []);

  // Group rows by category
  const categories = new Map<string, InstalledModelRow[]>();
  for (const row of allRows) {
    const cat = listAllModels().find((m) => m.id === row.id)?.category ?? 'other';
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(row);
  }

  return (
    <div className="settings-section">
      <p className="settings-section__hint">
        These models are stored locally. Downloads require explicit consent and are stored in{' '}
        {storageLabel()}. Bundled models ship with the app and need no download. Installation and
        runtime readiness are separate; model compatibility and available memory are checked on use.
      </p>

      {bundleStatus === 'corrupt' && (
        <p className="bg-models-list__bundle-warning" role="alert">
          Bundled starter model (U&sup2;-Net Light) failed integrity check. Reinstall the app or
          download models manually below.
        </p>
      )}

      {loadError && (
        <div>
          <p className="settings-section__hint" role="alert">
            Could not read model status. {loadError}
          </p>
          <Button variant="ghost" onClick={() => void refresh()}>
            Retry loading models
          </Button>
        </div>
      )}

      <RegionLoader label="Loading model status" loading={loading}>
        {Array.from(categories.entries()).map(([catId, rows]) => (
          <div key={catId}>
            <h3 className="settings-section__title">{CATEGORY_LABELS[catId] ?? catId}</h3>
            <ul className="bg-models-list" aria-label={`${CATEGORY_LABELS[catId] ?? catId} models`}>
              {rows.map((row) => (
                <li key={row.id} className="bg-models-list__row">
                  <div className="bg-models-list__info">
                    <span className="bg-models-list__name">
                      {row.name}
                      {row.isQuantized && <span className="bg-models-list__badge">INT8</span>}
                    </span>
                    <span className="bg-models-list__meta">
                      {row.memoryDisclosure
                        ? `Download/storage ~${formatModelBytes(row.size)}`
                        : modelRequirementLabel(row.size, row.peakMemoryBytes)}
                      {row.installed
                        ? row.source === 'bundled'
                          ? ' — bundled'
                          : ' — installed'
                        : ' — not installed'}
                      {row.precision === 'int8' && ' (quantized)'}
                    </span>
                    {row.readiness && (
                      <span className="bg-models-list__meta">
                        {row.readiness.runtime}.{' '}
                        {row.readiness.recovery ?? 'Execution is checked when the model is used.'}
                      </span>
                    )}
                    {row.readinessError && (
                      <span className="bg-models-list__meta" role="alert">
                        Model status unavailable. {row.readinessError}
                      </span>
                    )}
                    {row.memoryDisclosure && (
                      <span className="bg-models-list__desc">{row.memoryDisclosure}</span>
                    )}
                    {row.description && (
                      <span className="bg-models-list__desc">{row.description}</span>
                    )}
                    {compositeDownload?.id === row.id && (
                      <div
                        className="insp-progress-bar"
                        role="progressbar"
                        aria-label={`Downloading ${row.name}`}
                        aria-valuenow={compositeDownload.progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className="insp-progress-bar__fill"
                          style={{ width: `${compositeDownload.progress}%` }}
                        />
                      </div>
                    )}
                    {rowError?.id === row.id && (
                      <span className="bg-models-list__meta" role="alert">
                        {rowError.message}
                      </span>
                    )}
                  </div>
                  <div className="bg-models-list__actions">
                    {row.readinessError && (
                      <Button
                        variant="ghost"
                        onClick={() => void refresh()}
                        aria-label={`Retry ${row.name} model check`}
                      >
                        Retry model check
                      </Button>
                    )}
                    {row.source === 'downloaded' && (
                      <Button
                        variant="ghost"
                        onClick={() => void handleDelete(row)}
                        disabled={busyId !== null || compositeDownload !== null}
                        disabledReason={
                          busyId !== null || compositeDownload !== null
                            ? 'Wait for the current model operation to finish.'
                            : undefined
                        }
                        aria-label={`Remove ${row.name} model`}
                      >
                        {busyId === row.id ? 'Removing...' : 'Remove'}
                      </Button>
                    )}
                    {!row.installed && row.downloadable && row.componentIds ? (
                      compositeDownload?.id === row.id ? (
                        <Button
                          variant="ghost"
                          onClick={handleCompositeCancel}
                          aria-label={`Cancel ${row.name} download`}
                        >
                          Cancel
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          disabled={busyId !== null || compositeDownload !== null}
                          disabledReason={
                            busyId !== null || compositeDownload !== null
                              ? 'Wait for the current model operation to finish.'
                              : undefined
                          }
                          onClick={() => void handleCompositeDownload(row)}
                          aria-label={`${rowError?.id === row.id ? 'Retry' : 'Download'} ${row.name} model (${row.componentIds.length} parts)`}
                        >
                          {rowError?.id === row.id ? 'Retry download' : 'Download'}
                        </Button>
                      )
                    ) : (
                      !row.installed &&
                      row.downloadable && (
                        <Button
                          variant="default"
                          disabled={busyId !== null || compositeDownload !== null}
                          disabledReason={
                            busyId !== null || compositeDownload !== null
                              ? 'Wait for the current model operation to finish.'
                              : undefined
                          }
                          onClick={() => setDownloadModelId(row.id)}
                          aria-label={`Download ${row.name} model`}
                        >
                          {row.source === 'bundled' ? 'Verify' : 'Download'}
                        </Button>
                      )
                    )}
                    {!row.installed && !row.downloadable && (
                      <span className="bg-models-list__meta">Unavailable</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </RegionLoader>

      {downloadModelId && (
        <ModelDownloadDialog
          modelId={downloadModelId}
          onClose={() => setDownloadModelId(null)}
          onComplete={() => {
            setDownloadModelId(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

/** Model id required for a given removal method (for inspector gating). */
export function modelIdForRemovalMethod(method: RemovalMethod): string | null {
  return workerModelIdForMethod(method);
}
