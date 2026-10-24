import {
  type BackgroundRemovalReadiness,
  getBackgroundRemovalReadiness,
  getModelLoaderReady,
  type RemovalMethod,
} from '@varve/engine';
import { useCallback, useEffect, useState } from 'react';

interface Snapshot {
  method: RemovalMethod;
  readiness: BackgroundRemovalReadiness | null;
  error: string | null;
  downloading: boolean;
}

export function useBackgroundModelReadiness(method: RemovalMethod, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let generation = 0;
    let unsubscribe: (() => void) | undefined;
    setSnapshot(null);
    void getModelLoaderReady()
      .then((loader) => {
        if (disposed) return;
        const update = async () => {
          const ownGeneration = ++generation;
          try {
            const readiness = await getBackgroundRemovalReadiness(method);
            if (disposed || ownGeneration !== generation) return;
            setSnapshot({
              method,
              readiness,
              error: null,
              downloading:
                loader.getState() === 'downloading' &&
                loader.getCurrentModelId() === readiness.modelId,
            });
          } catch (error) {
            if (disposed || ownGeneration !== generation) return;
            setSnapshot({
              method,
              readiness: null,
              downloading: false,
              error: error instanceof Error ? error.message : 'Could not check this model.',
            });
          }
        };
        unsubscribe = loader.subscribe(() => void update());
        void update();
      })
      .catch((error: unknown) => {
        if (!disposed)
          setSnapshot({
            method,
            readiness: null,
            downloading: false,
            error: error instanceof Error ? error.message : 'Could not read model status.',
          });
      });
    return () => {
      disposed = true;
      generation++;
      unsubscribe?.();
    };
  }, [enabled, method, revision]);
  // A new choice must never inherit the previous method's installed/ready state
  // during the render before its effect runs.
  const current = enabled && snapshot?.method === method ? snapshot : null;
  return {
    readiness: current?.readiness ?? null,
    error: current?.error ?? null,
    downloading: current?.downloading ?? false,
    checking: current === null,
    refresh,
  };
}
