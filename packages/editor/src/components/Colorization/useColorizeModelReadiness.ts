import { getDdColorModelCandidates, getModelLoaderReady, type QualityMode } from '@varve/engine';
import { useCallback, useEffect, useState } from 'react';

interface Snapshot {
  mode: QualityMode;
  modelId: string | null;
  error: string | null;
}

export function useColorizeModelReadiness(mode: QualityMode, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let currentCheck: AbortController | undefined;
    setSnapshot(null);
    void getModelLoaderReady()
      .then((loader) => {
        if (disposed) return;
        const check = async () => {
          currentCheck?.abort();
          const controller = new AbortController();
          currentCheck = controller;
          setSnapshot(null);
          try {
            let modelId: string | null = null;
            for (const candidate of getDdColorModelCandidates(mode)) {
              const installed = await loader.isModelAvailable(candidate, controller.signal);
              if (disposed || controller.signal.aborted) return;
              if (installed) {
                modelId = candidate;
                break;
              }
            }
            setSnapshot({ mode, modelId, error: null });
          } catch (error) {
            if (disposed || controller.signal.aborted) return;
            setSnapshot({
              mode,
              modelId: null,
              error: error instanceof Error ? error.message : 'Could not read model status.',
            });
          }
        };
        // Subscribe before the initial async check so installation/removal cannot
        // finish in the gap; each notification supersedes the older check.
        unsubscribe = loader.subscribe(() => void check());
        void check();
      })
      .catch((error: unknown) => {
        if (!disposed)
          setSnapshot({
            mode,
            modelId: null,
            error: error instanceof Error ? error.message : 'Could not read model status.',
          });
      });
    return () => {
      disposed = true;
      currentCheck?.abort();
      unsubscribe?.();
    };
  }, [enabled, mode, revision]);
  const current = enabled && snapshot?.mode === mode ? snapshot : null;
  return {
    modelId: current?.modelId ?? null,
    error: current?.error ?? null,
    checking: current === null,
    candidates: getDdColorModelCandidates(mode),
    refresh,
  };
}
