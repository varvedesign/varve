import type { ModelAcquisition } from '@varve/engine';
import {
  getModelLoaderReady,
  getRuntimeCapabilitiesSync,
  listAllModels,
  resolveAcquisition,
  resolveModelPeakMemoryBytes,
} from '@varve/engine';
import { Button, RegionLoader } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { modelRequirementLabel } from '../../modelRequirements';
import { ModelDownloadDialog } from '../BackgroundRemoval/ModelDownloadDialog';

interface ModelRow {
  id: string;
  name: string;
  size: number;
  peakMemoryBytes?: number;
  installed: boolean;
  source: 'bundled' | 'downloaded' | 'none';
  acquisition: ModelAcquisition;
  description?: string;
  statusError?: string;
}

async function buildRows(
  loader: Awaited<ReturnType<typeof getModelLoaderReady>>,
  signal: AbortSignal,
): Promise<ModelRow[]> {
  const catalog = listAllModels().filter((m) => m.id === 'ddcolor' || m.id === 'ddcolor-tiny');
  const results: ModelRow[] = [];
  for (const model of catalog) {
    signal.throwIfAborted();
    let installed = false;
    let downloaded = false;
    let statusError: string | undefined;
    try {
      installed = await loader.isModelAvailable(model.id, signal);
      downloaded = Boolean(await loader.hasDownloadedBlob?.(model.id));
    } catch (error) {
      signal.throwIfAborted();
      statusError = error instanceof Error ? error.message : 'Could not read model status.';
    }
    results.push({
      id: model.id,
      name: model.name,
      size: model.sizeBytes,
      peakMemoryBytes: resolveModelPeakMemoryBytes(model, {
        native: getRuntimeCapabilitiesSync().isTauri,
      }),
      installed,
      source: model.bundled ? 'bundled' : downloaded ? 'downloaded' : 'none',
      acquisition: resolveAcquisition(model),
      description: model.description,
      statusError,
    });
  }
  return results;
}

export function ColorizationModelsTab() {
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadModelId, setDownloadModelId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const mountedRef = useRef(false);
  const operationRef = useRef<string | null>(null);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let currentCheck: AbortController | undefined;
    setLoading(true);
    setLoadError(null);
    void getModelLoaderReady()
      .then((loader) => {
        if (disposed) return;
        const check = async () => {
          currentCheck?.abort();
          const controller = new AbortController();
          currentCheck = controller;
          setLoading(true);
          setLoadError(null);
          try {
            const nextRows = await buildRows(loader, controller.signal);
            if (!disposed && !controller.signal.aborted) setRows(nextRows);
          } catch (error) {
            if (!disposed && !controller.signal.aborted) {
              setLoadError(error instanceof Error ? error.message : 'Could not read model status.');
            }
          } finally {
            if (!disposed && !controller.signal.aborted) setLoading(false);
          }
        };
        unsubscribe = loader.subscribe(() => void check());
        void check();
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setLoadError(error instanceof Error ? error.message : 'Could not read model status.');
        setLoading(false);
      });
    return () => {
      disposed = true;
      mountedRef.current = false;
      currentCheck?.abort();
      unsubscribe?.();
    };
  }, [revision]);

  const handleDelete = async (id: string) => {
    if (operationRef.current) return;
    operationRef.current = id;
    setRowError(null);
    setBusyId(id);
    try {
      const loader = await getModelLoaderReady();
      if (!mountedRef.current) return;
      await loader.deleteModel(id);
      if (mountedRef.current) refresh();
    } catch (error) {
      if (mountedRef.current) {
        setRowError({
          id,
          message: error instanceof Error ? error.message : 'Could not remove this model.',
        });
        refresh();
      }
    } finally {
      operationRef.current = null;
      if (mountedRef.current) setBusyId(null);
    }
  };

  return (
    <div className="colorization-models-section">
      <h3 className="colorization-models-section__title">Colorization Models</h3>
      <p className="colorization-models-section__hint">
        DDColor models propose plausible colors for grayscale photos. They are optional downloads
        (Apache-2.0 licensed). Fast requires Tiny; Balanced and Quality require DDColor. Automatic
        prefers DDColor, then an installed Tiny model. Runtime and available memory are checked when
        Preview starts. Deterministic recoloring and line-art coloring do not need a model.
      </p>
      {loadError && (
        <p className="insp-hint insp-hint--error" role="alert">
          {loadError}
        </p>
      )}
      {(loadError || rows.some((row) => row.statusError)) && (
        <Button variant="ghost" onClick={refresh} disabled={loading}>
          Retry loading models
        </Button>
      )}
      <RegionLoader label="Loading model status" loading={loading}>
        <ul className="bg-models-list" aria-label="Colorization models">
          {rows.map((row) => (
            <li key={row.id} className="bg-models-list__row">
              <div className="bg-models-list__info">
                <span className="bg-models-list__name">{row.name}</span>
                <span className="bg-models-list__meta">
                  {modelRequirementLabel(row.size, row.peakMemoryBytes)}
                  {row.statusError
                    ? ' — status unavailable'
                    : row.installed
                      ? row.source === 'bundled'
                        ? ' — bundled'
                        : ' — installed'
                      : ' — not installed'}
                </span>
                {row.description && <span className="bg-models-list__desc">{row.description}</span>}
                {row.statusError && (
                  <span className="insp-hint insp-hint--error" role="alert">
                    {row.statusError}
                  </span>
                )}
                {rowError?.id === row.id && (
                  <span className="insp-hint insp-hint--error" role="alert">
                    {rowError.message}
                  </span>
                )}
              </div>
              <div className="bg-models-list__actions">
                {row.installed && row.source === 'downloaded' && (
                  <Button
                    variant="ghost"
                    onClick={() => void handleDelete(row.id)}
                    disabled={busyId !== null}
                    aria-label={`Remove ${row.name} model`}
                  >
                    {busyId === row.id ? 'Removing...' : 'Remove'}
                  </Button>
                )}
                {!row.installed &&
                  !row.statusError &&
                  !loadError &&
                  row.acquisition.kind === 'remote' && (
                    <Button
                      variant="default"
                      onClick={() => setDownloadModelId(row.id)}
                      aria-label={`Download ${row.name} model`}
                    >
                      Download
                    </Button>
                  )}
                {!row.installed && !row.statusError && row.acquisition.kind === 'generated' && (
                  <span className="bg-models-list__meta">
                    Build from source — see tools/ddcolor-export/
                  </span>
                )}
                {!row.installed && !row.statusError && row.acquisition.kind === 'unavailable' && (
                  <span className="bg-models-list__meta">{row.acquisition.detail}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
        {rows.length === 0 && !loading && !loadError && (
          <p className="colorization-models-section__hint">
            No colorization models found in the catalog.
          </p>
        )}
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
