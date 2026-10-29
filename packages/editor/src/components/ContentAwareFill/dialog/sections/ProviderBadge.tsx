import type { DialogRuntime } from '../useDialogRuntime';

export function ProviderBadge({ controller }: { controller: DialogRuntime }) {
  const {
    diffusionModelHandle,
    diffusionModelInstalled,
    diffusionModelQualificationAvailable,
    diffusionModelSize,
    diffusionResource,
    quality,
    resourceLabel,
    resourceProfile,
    usesDiffusion,
  } = controller;
  return (
    <>
      <div className="caf-dialog__provider" id="caf-dialog-provider-note">
        <span className="caf-dialog__provider-dot" aria-hidden="true" />
        <span>
          <strong>Local processing</strong>
          <small>
            {usesDiffusion
              ? diffusionModelHandle
                ? `Diffusion · ${Math.round(diffusionModelSize / 1_000_000)} MB · qualified local${diffusionResource ? ` · ${diffusionResource.backend}/${diffusionResource.platform}/${diffusionResource.architecture}` : ''}`
                : diffusionModelInstalled
                  ? diffusionModelQualificationAvailable
                    ? 'Diffusion model installed · validation required'
                    : 'Diffusion model installed · incompatible with this runtime'
                  : 'Diffusion model required · local only'
              : quality === 'fast'
                ? 'Quick Cleanup · no download'
                : 'LaMa · stored on this device'}
            {resourceLabel ? ` · ${resourceLabel}` : ''}
          </small>
        </span>
      </div>

      <p className="caf-dialog__hint" aria-live="polite">
        {resourceProfile.summary}
      </p>
    </>
  );
}
