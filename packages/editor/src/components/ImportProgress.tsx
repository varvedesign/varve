import './ImportProgress.css';

export interface ImportProgressProps {
  stage: 'preparing' | 'importing';
  current: number;
  total: number;
  fileName: string;
  activeFileNames?: string[];
  onCancel?: () => void;
}

export function ImportProgress({
  stage,
  current,
  total,
  fileName,
  activeFileNames = [],
  onCancel,
}: ImportProgressProps) {
  const progress = total > 0 ? Math.round((current / total) * 100) : 0;
  const preparing = stage === 'preparing';
  const label = preparing
    ? `Preparing files: ${current} of ${total} ready`
    : `Importing files: ${current} of ${total} complete`;
  const filenameLabel = current > 0 ? `Latest completed: ${fileName}` : '';
  const activeLabel = activeFileNames.length > 0 ? `Parsing: ${activeFileNames.join(', ')}` : '';

  return (
    <fieldset className="import-progress" aria-label="Import progress" data-stage={stage}>
      <div className="import-progress__info">
        <span className="import-progress__label">{label}</span>
        {!preparing && activeLabel && (
          <span className="import-progress__filename">{activeLabel}</span>
        )}
        {!preparing && fileName && (
          <span className="import-progress__filename">{filenameLabel}</span>
        )}
      </div>
      <div
        role="progressbar"
        aria-valuenow={preparing && current === 0 ? undefined : current}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={
          preparing
            ? `${current} of ${total} files prepared`
            : `${current} of ${total} files complete`
        }
        className={`import-progress__bar${preparing && current === 0 ? ' import-progress__bar--indeterminate' : ''}`}
      >
        <div
          className="import-progress__fill"
          style={{ width: `${preparing && current === 0 ? 35 : Math.min(progress, 100)}%` }}
        />
      </div>
      {onCancel && (
        <button type="button" className="import-progress__cancel" onClick={onCancel}>
          Cancel import
        </button>
      )}
      <div role="status" aria-live="polite" className="varve-visually-hidden">
        {[label, activeLabel].filter(Boolean).join('. ')}
      </div>
    </fieldset>
  );
}
