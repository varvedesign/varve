import { AVAILABLE_MODELS } from './types';

/** GitHub Releases send no CORS headers, so a browser fetch cannot read them. */
export function isGithubReleaseAssetUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      (parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com') &&
      parsed.pathname.includes('/releases/download/')
    );
  } catch {
    return false;
  }
}

export const DESKTOP_ONLY_MODEL_DOWNLOAD_MESSAGE =
  'This model can only be downloaded in the desktop app.';

/** @deprecated Use DESKTOP_ONLY_MODEL_DOWNLOAD_MESSAGE. */
export const HIGH_QUALITY_DESKTOP_ONLY_MESSAGE = DESKTOP_ONLY_MODEL_DOWNLOAD_MESSAGE;

export function segmentationModelRemoteUrl(modelId: string): string {
  return AVAILABLE_MODELS.find((model) => model.id === modelId)?.remoteUrl ?? '';
}

/** True when this background-removal model is hosted on GitHub Releases. */
export function isBrowserBlockedSegmentationModel(modelId: string, remoteUrl?: string): boolean {
  if (!AVAILABLE_MODELS.some((model) => model.id === modelId)) return false;
  return isGithubReleaseAssetUrl(remoteUrl ?? segmentationModelRemoteUrl(modelId));
}

export function browserBlockedModelDownloadMessage(_modelId?: string): string {
  return DESKTOP_ONLY_MODEL_DOWNLOAD_MESSAGE;
}
