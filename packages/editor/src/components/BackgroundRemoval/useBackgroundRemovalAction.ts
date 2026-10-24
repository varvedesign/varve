import { getBackgroundRemovalReadiness, type RemovalMethod } from '@varve/engine';
import { useEffect, useRef, useState } from 'react';

/** Own the readiness await as well as the eventual processing action. Cancelling
 * a request before the context has started work must still prevent its launch. */
export function useBackgroundRemovalAction({
  sourceKey,
  method,
  feather,
  decontaminate,
  run,
  cancel,
  refresh,
  download,
  announce,
  normalizeError,
}: {
  sourceKey: string;
  method: RemovalMethod;
  feather: number;
  decontaminate: boolean;
  run: (method: RemovalMethod, feather: number, decontaminate: boolean) => Promise<unknown>;
  cancel: () => void;
  refresh: () => void;
  download: (modelId: string | null) => void;
  announce: (message: string) => void;
  normalizeError: (error: unknown, fallback: string) => string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setPending(false);
    setError(null);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [sourceKey, method]);

  const apply = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setError(null);
    setPending(true);
    try {
      const readiness = await getBackgroundRemovalReadiness(method);
      if (controller.signal.aborted) return;
      refresh();
      if (!readiness.installed) {
        download(readiness.modelId);
        return;
      }
      if (!readiness.canAttempt)
        throw new Error(`${readiness.summary}. ${readiness.recovery ?? ''}`);
      await run(method, feather, decontaminate);
    } catch (failure) {
      if (controller.signal.aborted) return;
      const message = normalizeError(failure, 'Background removal failed');
      setError(message);
      if (message !== 'Cancelled') announce(message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  };

  const cancelAction = () => {
    request.current?.abort();
    request.current = null;
    cancel();
    setPending(false);
    setError('Cancelled');
  };
  return { pending, error, apply, cancel: cancelAction };
}
