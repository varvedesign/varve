/* ------------------------------------------------------------------ */
/*  Tab 9: Similar — Find Similar Images                              */
/* ------------------------------------------------------------------ */

import type { SimilaritySearchMode } from '@varve/engine/semanticSimilarity';
import { Icon, Tooltip } from '@varve/ui';
import type { KeyboardEvent } from 'react';
import { useEditor } from '../../../context';
import { useSimilarSearch } from './useSimilarSearch';

export function SimilarTab() {
  const {
    status,
    errorMessage,
    matches,
    scannedCount,
    queryText,
    setQueryText,
    searchMode,
    setSearchMode,
    downloadProgress,
    isSearching,
    needsDownload,
    needsTextDownload,
    isImage,
    handleSearch,
    handleCancel,
    handleDownload,
    handleCancelDownload,
    handleDownloadTextModel,
  } = useSimilarSearch();
  const { setSelection } = useEditor();
  const searchModeOptions: readonly SimilaritySearchMode[] = ['semantic', 'near-duplicates'];

  function handleSearchModeKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % searchModeOptions.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + searchModeOptions.length) % searchModeOptions.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = searchModeOptions.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextMode = searchModeOptions[nextIndex];
    if (!nextMode) return;
    setSearchMode(nextMode);
    document.getElementById(`similarity-mode-${nextMode}`)?.focus();
  }

  return (
    <div className="intelligence-tab-content">
      <p className="intelligence-hint">
        Search locally with an image or a description. Image similarity uses the verified DINOv2
        embedding space; natural-language queries use the paired SigLIP text model. Near duplicates
        use exact identity and visual fingerprints first.
      </p>
      <label className="intelligence-field-label" htmlFor="similarity-text-query">
        Describe an asset
      </label>
      <input
        id="similarity-text-query"
        className="intelligence-text-input"
        value={queryText}
        onChange={(event) => setQueryText(event.target.value)}
        placeholder="orange sunset over mountains"
        type="search"
      />

      {!isImage && !queryText.trim() && (
        <div className="intelligence-empty">
          <Icon name="Images" label={undefined} size="1.2em" />
          <p>Select an image or enter a description to search this document.</p>
        </div>
      )}

      {!queryText.trim() && (
        <div
          className="similarity-mode-picker"
          role="radiogroup"
          aria-label="Similarity search type"
        >
          {searchModeOptions.map((mode, index) => {
            const selected = searchMode === mode;
            return (
              <label
                key={mode}
                className={
                  selected
                    ? 'similarity-mode-picker__option is-active'
                    : 'similarity-mode-picker__option'
                }
              >
                <input
                  id={`similarity-mode-${mode}`}
                  type="radio"
                  name="similarity-search-type"
                  value={mode}
                  checked={selected}
                  tabIndex={selected ? 0 : -1}
                  onChange={() => setSearchMode(mode)}
                  onKeyDown={(event) => handleSearchModeKeyDown(event, index)}
                  className="varve-visually-hidden"
                />
                {mode === 'semantic' ? 'Similar' : 'Near duplicates'}
              </label>
            );
          })}
        </div>
      )}

      {(needsDownload || needsTextDownload) && (
        <button
          type="button"
          className="intelligence-action-btn"
          onClick={needsDownload ? handleDownload : handleDownloadTextModel}
          aria-label={
            needsTextDownload && !needsDownload
              ? 'Download natural-language search model (~106 MB)'
              : 'Download AI Model (~88 MB)'
          }
        >
          <Icon name="Download" label={undefined} size="0.85em" />
          {needsTextDownload && !needsDownload ? 'Download Text Search Model' : 'Download AI Model'}
        </button>
      )}

      {status === 'downloading' && (
        <>
          <div
            className="insp-progress-bar"
            role="progressbar"
            aria-valuenow={downloadProgress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="insp-progress-bar__fill" style={{ width: `${downloadProgress}%` }} />
          </div>
          <p aria-live="polite">Downloading… {downloadProgress}%</p>
          <button type="button" className="intelligence-action-btn" onClick={handleCancelDownload}>
            Cancel
          </button>
        </>
      )}

      {matches && (
        <div className="similarity-results">
          {matches.length === 0 ? (
            <p className="intelligence-empty">No matching images found in this document.</p>
          ) : (
            matches.map((m) => (
              <Tooltip
                key={m.nodeId}
                label={`Select result, ${Math.round(m.similarity * 100)}% match`}
              >
                <button
                  type="button"
                  className="similarity-result"
                  onClick={() => setSelection(m.nodeId)}
                >
                  <img
                    src={m.src}
                    alt={`Similarity result: ${Math.round(m.similarity * 100)}% match`}
                    className="similarity-result__image"
                  />
                  <span className="similarity-result__score">
                    {Math.round(m.similarity * 100)}%
                  </span>
                </button>
              </Tooltip>
            ))
          )}
        </div>
      )}

      {matches && scannedCount > 0 && (
        <p className="intelligence-hint" role="status">
          Scanned {scannedCount} image{scannedCount === 1 ? '' : 's'} in this document.
        </p>
      )}

      {isSearching ? (
        <>
          <span aria-live="polite">Searching…</span>
          <button type="button" className="intelligence-action-btn" onClick={handleCancel}>
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          className="intelligence-action-btn"
          disabled={needsDownload || needsTextDownload || (!isImage && !queryText.trim())}
          onClick={handleSearch}
          aria-label="Find similar images in this document"
        >
          <Icon name="Images" label={undefined} size="0.85em" />
          Find Similar
        </button>
      )}

      {status === 'error' && errorMessage && (
        <p className="intelligence-issue--error" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
