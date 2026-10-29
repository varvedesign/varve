import type { DialogRuntime } from '../useDialogRuntime';

export function ModeSection({ controller }: { controller: DialogRuntime }) {
  const {
    capabilities,
    diffusionModelReason,
    diffusionResource,
    invalidatePreview,
    mode,
    modeAvailable,
    modeUnavailableReason,
    resetPreviewToSource,
    setMode,
  } = controller;
  return (
    <div className="caf-dialog__section">
      <span className="caf-dialog__label">Mode</span>
      <div className="caf-dialog__mode-options" role="tablist" aria-label="Generative edit mode">
        {(['fill', 'remove', 'replace', 'expand'] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={mode === candidate}
            className={`caf-dialog__mode-btn${mode === candidate ? ' caf-dialog__mode-btn--active' : ''}`}
            onClick={() => {
              if (mode === 'expand' && candidate !== 'expand') resetPreviewToSource();
              setMode(candidate);
              invalidatePreview();
            }}
          >
            {candidate[0]?.toUpperCase()}
            {candidate.slice(1)}
          </button>
        ))}
      </div>
      <p className="caf-dialog__hint">
        {modeAvailable
          ? mode === 'expand'
            ? 'Set one or more sides to extend. Original pixels keep their world position.'
            : 'Paint the pixels to regenerate. The source is retained for Restore Original.'
          : diffusionResource &&
              diffusionResource.availableBytes != null &&
              diffusionResource.availableBytes < diffusionResource.requiredBytes
            ? `This ${diffusionResource.architecture} device has about ${Math.floor(diffusionResource.availableBytes / 1_048_576)} MiB available, but local diffusion needs about ${Math.ceil(diffusionResource.requiredBytes / 1_048_576)} MiB. Use Quick Cleanup for this edit.`
            : (modeUnavailableReason ??
              capabilities.reason ??
              diffusionModelReason ??
              'This mode is unavailable.')}
      </p>
    </div>
  );
}
