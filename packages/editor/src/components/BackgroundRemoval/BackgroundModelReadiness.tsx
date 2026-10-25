import { getModelById, getModelInfo, type RemovalMethod } from '@varve/engine';
import { Button, Disclosure, DisclosureContent, DisclosureTrigger } from '@varve/ui';
import { formatModelBytes } from '../../modelRequirements';
import type { useBackgroundModelReadiness } from './useBackgroundModelReadiness';

export function BackgroundModelReadiness({
  method,
  status,
  onDownload,
}: {
  method: RemovalMethod;
  status: ReturnType<typeof useBackgroundModelReadiness>;
  onDownload: (modelId?: string) => void;
}) {
  const { readiness, checking, error, downloading, refresh } = status;
  const info = getModelInfo(method);
  const model = readiness?.modelId ? getModelById(readiness.modelId) : undefined;
  return (
    <section className="insp-model-info" aria-label="Background removal readiness">
      <p className="insp-hint" role="status">
        {checking
          ? 'Checking model and runtime…'
          : error
            ? 'Model status unavailable'
            : downloading
              ? 'Downloading model…'
              : readiness?.summary === readiness?.runtime
                ? readiness?.summary
                : `${readiness?.summary} · ${readiness?.runtime}`}
      </p>
      {error && (
        <p className="insp-hint insp-hint--error" role="alert">
          {error}
        </p>
      )}
      {readiness?.recovery && <p className="insp-hint">{readiness.recovery}</p>}
      {error && (
        <Button variant="ghost" size="sm" onClick={refresh}>
          Retry model check
        </Button>
      )}
      {readiness && !readiness.installed && !downloading && (
        <Button
          variant="default"
          size="sm"
          onClick={() => onDownload(readiness.modelId ?? undefined)}
          aria-label="Download AI model for background removal"
        >
          Download AI Model
        </Button>
      )}
      {info && (
        <Disclosure variant="compact">
          <DisclosureTrigger>Model details</DisclosureTrigger>
          <DisclosureContent>
            <p className="insp-model-info__desc">
              {model?.name ?? info.label}: {info.description}
            </p>
            <p className="insp-hint">
              {model
                ? `${formatModelBytes(model.sizeBytes)} download/storage.`
                : 'No model download.'}
            </p>
            <p className="insp-hint">{info.peakRamDisplay}</p>
            {method !== 'quick' && (
              <p className="insp-hint">
                Available memory and model compatibility are checked when processing starts.
                Installation alone does not verify execution.
              </p>
            )}
          </DisclosureContent>
        </Disclosure>
      )}
    </section>
  );
}
