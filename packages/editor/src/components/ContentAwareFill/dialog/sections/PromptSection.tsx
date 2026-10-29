import type { DialogRuntime } from '../useDialogRuntime';

export function PromptSection({ controller }: { controller: DialogRuntime }) {
  const {
    invalidatePreview,
    isProcessing,
    mode,
    modeCapability,
    negativePrompt,
    prompt,
    setNegativePrompt,
    setPrompt,
  } = controller;
  return (
    <>
      {(mode === 'fill' || mode === 'replace' || mode === 'expand') && (
        <div className="caf-dialog__section">
          <label className="caf-dialog__label" htmlFor="caf-dialog-prompt">
            Prompt{' '}
            <span className="caf-dialog__optional">
              {mode === 'replace' ? 'required' : 'optional'}
            </span>
          </label>
          <textarea
            id="caf-dialog-prompt"
            className="caf-dialog__prompt"
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              invalidatePreview();
            }}
            placeholder="Describe what should appear here"
            rows={3}
            aria-describedby="caf-dialog-prompt-note caf-dialog-provider-note"
            disabled={!modeCapability.prompt || isProcessing}
          />
          <p id="caf-dialog-prompt-note" className="caf-dialog__hint">
            {modeCapability.prompt
              ? 'Sent only to the locally installed diffusion model; it never leaves this device.'
              : mode === 'expand' && !modeCapability.available
                ? 'Prompt conditioning and browser outpainting are unavailable here. Use the desktop app after a local provider passes qualification.'
                : 'Prompt conditioning is unavailable in the browser. Install the desktop diffusion model to use it.'}
          </p>
          {modeCapability.prompt && (
            <>
              <label className="caf-dialog__label" htmlFor="caf-dialog-negative-prompt">
                Negative prompt <span className="caf-dialog__optional">optional</span>
              </label>
              <textarea
                id="caf-dialog-negative-prompt"
                className="caf-dialog__prompt"
                value={negativePrompt}
                onChange={(event) => {
                  setNegativePrompt(event.target.value);
                  invalidatePreview();
                }}
                placeholder="Things to avoid"
                rows={2}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
