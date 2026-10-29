import { NATIVE_GENERATIVE_MODEL_PROFILE } from '@varve/engine';
import { Button } from '@varve/ui';
import type { DialogRuntime } from '../useDialogRuntime';

export function DiffusionModelSection({ controller }: { controller: DialogRuntime }) {
  const {
    capabilities,
    diffusionModelDownloadAvailable,
    diffusionModelHandle,
    diffusionModelImportAvailable,
    diffusionModelInstalled,
    diffusionModelQualificationAvailable,
    diffusionModelReason,
    diffusionResource,
    downloadProgress,
    handleCancelDownload,
    handleDownloadDiffusionModel,
    handleImportDiffusionModel,
    handleQualifyDiffusionModel,
    isProcessing,
    modeCapability,
    status,
    usesDiffusion,
  } = controller;
  return (
    <>
      {usesDiffusion && (
        <div className="caf-dialog__section">
          {!diffusionModelInstalled &&
            diffusionModelDownloadAvailable &&
            capabilities.prompt &&
            status !== 'downloading' && (
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => void handleDownloadDiffusionModel()}
                disabled={isProcessing}
              >
                Download {Math.round(NATIVE_GENERATIVE_MODEL_PROFILE.sizeBytes / 1_000_000)} MB
                model
              </Button>
            )}
          {status === 'downloading' && (
            <Button type="button" variant="ghost" size="sm" onClick={handleCancelDownload}>
              Cancel download
            </Button>
          )}
          {diffusionModelImportAvailable && (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => void handleImportDiffusionModel()}
              disabled={!modeCapability.prompt || isProcessing}
            >
              {diffusionModelInstalled ? 'Replace Diffusion Model' : 'Install Diffusion Model'}
            </Button>
          )}
          {status === 'downloading' && (
            <p className="caf-dialog__hint" aria-live="polite">
              Downloading local model… {downloadProgress}%
            </p>
          )}
          {diffusionModelInstalled &&
            diffusionModelQualificationAvailable &&
            !diffusionModelHandle && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleQualifyDiffusionModel()}
                disabled={isProcessing}
              >
                Validate Model
              </Button>
            )}
          <p className="caf-dialog__hint">
            {diffusionResource?.availableBytes != null &&
              diffusionResource.availableBytes < diffusionResource.requiredBytes && (
                <>
                  Low-memory guard: about {Math.floor(diffusionResource.availableBytes / 1_048_576)}{' '}
                  MiB available; this model needs about{' '}
                  {Math.ceil(diffusionResource.requiredBytes / 1_048_576)} MiB. Use Quick Cleanup or
                  a smaller edit region.{' '}
                </>
              )}
            {diffusionResource?.availableBytes != null &&
              diffusionResource.availableBytes >= diffusionResource.requiredBytes && (
                <>
                  {diffusionResource.tier} memory · {diffusionResource.backend}/
                  {diffusionResource.platform}/{diffusionResource.architecture} · measured before
                  generation.{' '}
                </>
              )}
            {diffusionModelHandle
              ? 'The model passed a masked production-helper check and is managed offline.'
              : diffusionModelInstalled
                ? (diffusionModelReason ?? 'Run validation before using prompt-capable generation.')
                : diffusionModelDownloadAvailable
                  ? 'Select a safe-format SD 1.5/SDXL inpainting model. Legacy checkpoint files are rejected. Browser generation is unavailable.'
                  : 'No compatible quality-certified prompt model is packaged for this runtime. Model import is unavailable until a model-specific adapter is qualified; use Quick Cleanup/LaMa. Browser generation is unavailable.'}
          </p>
        </div>
      )}
    </>
  );
}
