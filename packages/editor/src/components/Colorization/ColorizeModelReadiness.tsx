import { getModelById } from '@varve/engine';
import { Button, Disclosure, DisclosureContent, DisclosureTrigger } from '@varve/ui';
import { useState } from 'react';
import { formatModelBytes } from '../../modelRequirements';
import { ModelDownloadDialog } from '../BackgroundRemoval/ModelDownloadDialog';
import type { useColorizeModelReadiness } from './useColorizeModelReadiness';

function modelName(id: string) {
  return id === 'ddcolor-tiny' ? 'DDColor Tiny' : 'DDColor';
}

export function ColorizeModelReadiness({
  status,
}: {
  status: ReturnType<typeof useColorizeModelReadiness>;
}) {
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const { modelId, error, checking, candidates, refresh } = status;
  return (
    <section className="insp-model-info" aria-label="Colorization model readiness">
      <p className="insp-hint" role="status">
        {checking
          ? 'Checking model installation…'
          : error
            ? 'Model status unavailable'
            : modelId
              ? `${modelName(modelId)} installed`
              : `No verified ${candidates.map(modelName).join(' or ')} model installed for this mode.`}
      </p>
      {error && (
        <p className="insp-hint insp-hint--error" role="alert">
          {error}
        </p>
      )}
      {error && (
        <Button variant="ghost" size="sm" onClick={refresh}>
          Retry model check
        </Button>
      )}
      {!checking && !error && !modelId && (
        <div className="insp-actions">
          {candidates.map((id) => (
            <Button key={id} variant="secondary" size="sm" onClick={() => setDownloadId(id)}>
              Download {modelName(id)}
            </Button>
          ))}
        </div>
      )}
      {modelId && (
        <p className="insp-hint">Runtime and available memory are checked when Preview starts.</p>
      )}
      <Disclosure variant="compact">
        <DisclosureTrigger>Model details</DisclosureTrigger>
        <DisclosureContent>
          <p className="insp-hint">
            Fast uses DDColor Tiny. Balanced and Quality use DDColor. Automatic prefers DDColor,
            then an installed Tiny model.
          </p>
          {candidates.map((id) => {
            const model = getModelById(id);
            return model ? (
              <p className="insp-hint" key={id}>
                {modelName(id)}: {formatModelBytes(model.sizeBytes)} download/storage.
              </p>
            ) : null;
          })}
          <p className="insp-hint">
            The model proposes chroma; source lightness, detail and alpha are retained. Installation
            alone does not verify execution.
          </p>
        </DisclosureContent>
      </Disclosure>
      {downloadId && (
        <ModelDownloadDialog
          modelId={downloadId}
          onClose={() => setDownloadId(null)}
          onComplete={() => {
            setDownloadId(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}
