/**
 * ExportResultsList — per-item results of a completed export job (Strata export
 * rebuild, M9).
 *
 * Drives the "what actually happened" feedback after a batch: every requested
 * file shows its status, bytes written, and duration; failures carry their
 * error message; a Retry incomplete action reruns failed or partially written
 * jobs using the current conflict policy. This
 * closes the loop on partial-failure batches — the dialog can continue after
 * nonfatal failures instead of leaving the user to guess which files landed.
 */

import { formatFileSize } from '@varve/shared';
import { Icon, ShineBorder } from '@varve/ui';
import { useState } from 'react';
import type { ExportFileReport } from '../../exportService';
import { formatLabel } from './FormatBadge';

import './ExportResultsList.css';

export interface ExportResultsListProps {
  files: ExportFileReport[];
  /** Gate celebratory emphasis when the owning job was cancelled or otherwise stale. */
  successEmphasisActive?: boolean;
  /** Show a retry action when any job failed or only partly wrote its outputs. */
  onRetryIncomplete?: () => void;
  /** Reveal the first successful saved output in the native file manager. */
  onRevealOutput?: (path: string) => Promise<void>;
  revealOutputLabel?: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ExportResultsList({
  files,
  successEmphasisActive = true,
  onRetryIncomplete,
  onRevealOutput,
  revealOutputLabel = 'Reveal in Files',
}: ExportResultsListProps) {
  const [revealError, setRevealError] = useState('');
  const [revealing, setRevealing] = useState(false);
  const failed = files.filter((f) => f.status === 'failed');
  const partial = files.filter((f) => f.status === 'partial');
  const incompleteCount = failed.length + partial.length;
  const skipped = files.filter((f) => f.status === 'skipped');
  const succeeded = files.filter((f) => f.status === 'success').length;
  const allSucceeded = files.every((file) => file.status === 'success');
  const revealPath = files.find(
    (file) => (file.status === 'success' || file.status === 'partial') && file.savedPath,
  )?.savedPath;

  if (files.length === 0) return null;

  const handleReveal = async (path: string) => {
    if (!onRevealOutput) return;
    setRevealError('');
    setRevealing(true);
    try {
      await onRevealOutput(path);
    } catch (error) {
      setRevealError(error instanceof Error ? error.message : String(error));
    } finally {
      setRevealing(false);
    }
  };

  return (
    <ShineBorder variant="beam" tone="success" active={successEmphasisActive && allSucceeded}>
      <section className="export-results" aria-label="Export results">
        <div className="export-results__summary" role="status">
          {succeeded} of {files.length} exported
          {partial.length > 0 ? ` \u00b7 ${partial.length} partial` : ''}
          {skipped.length > 0 ? ` \u00b7 ${skipped.length} skipped` : ''}
          {failed.length > 0 ? ` \u00b7 ${failed.length} failed` : ''}
        </div>
        <ul className="export-results__list">
          {files.map((file) => (
            <li
              key={`${file.nodeId}-${file.fileName}`}
              className={`export-results__item export-results__item--${file.status}`}
            >
              <Icon
                name={file.status === 'success' ? 'CircleCheck' : 'TriangleAlert'}
                size={14}
                className={`export-results__status-icon export-results__status-icon--${file.status}`}
                label={undefined}
              />
              <span className="export-results__file">{file.fileName}</span>
              <span className="export-results__meta">
                {file.status === 'success'
                  ? `${formatLabel(file.format)} \u00b7 ${formatFileSize(file.byteCount)} \u00b7 ${formatDuration(file.durationMs)}`
                  : file.status === 'skipped'
                    ? 'Skipped existing files'
                    : file.status === 'partial'
                      ? `${formatLabel(file.format)} \u00b7 ${formatFileSize(file.byteCount)} \u00b7 Partial`
                      : 'Failed'}
              </span>
              {file.outputResults && file.outputResults.length > 1 && (
                <ul className="export-results__outputs" aria-label="Output file statuses">
                  {file.outputResults.map((output) => (
                    <li
                      key={output.fileName}
                      className={`export-results__output export-results__output--${output.status}`}
                    >
                      <span>{output.fileName}</span>
                      <span>{output.status === 'success' ? 'Saved' : output.status}</span>
                      {output.error && (
                        <span className="export-results__output-error">{output.error}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {file.outputResults?.length === 1 &&
                (file.status === 'partial' || file.status === 'skipped') &&
                file.outputResults?.some((output) => output.status === 'skipped') && (
                  <span className="export-results__error">
                    Skipped:{' '}
                    {file.outputResults
                      .filter((output) => output.status === 'skipped')
                      .map((output) => output.fileName)
                      .join(', ')}
                  </span>
                )}
              {file.outputResults?.length === 1 &&
                file.outputResults.some((output) => output.status === 'failed') && (
                  <span className="export-results__error">
                    Failed outputs:{' '}
                    {file.outputResults
                      .filter((output) => output.status === 'failed')
                      .map(
                        (output) => `${output.fileName}${output.error ? ` (${output.error})` : ''}`,
                      )
                      .join(', ')}
                  </span>
                )}
              {file.status === 'failed' && file.error && (
                <span className="export-results__error">{file.error}</span>
              )}
            </li>
          ))}
        </ul>
        {((incompleteCount > 0 && onRetryIncomplete) || (revealPath && onRevealOutput)) && (
          <div className="export-results__actions">
            {incompleteCount > 0 && onRetryIncomplete && (
              <span className="export-results__retry-note">
                Retry reruns the whole incomplete output group with the current Existing files
                choice.
              </span>
            )}
            {incompleteCount > 0 && onRetryIncomplete && (
              <button
                type="button"
                className="export-results__action"
                onClick={onRetryIncomplete}
                title="Reruns each incomplete output group using the current Existing files choice."
              >
                <Icon name="RotateCcw" size={14} label={undefined} />
                Retry incomplete ({incompleteCount})
              </button>
            )}
            {revealPath && onRevealOutput && (
              <button
                type="button"
                className="export-results__action"
                disabled={revealing}
                onClick={() => void handleReveal(revealPath)}
              >
                <Icon name="FolderOpen" size={14} label={undefined} />
                {revealing ? 'Opening…' : revealOutputLabel}
              </button>
            )}
          </div>
        )}
        {revealError && (
          <span className="export-results__error" role="alert">
            Could not reveal output: {revealError}
          </span>
        )}
      </section>
    </ShineBorder>
  );
}
