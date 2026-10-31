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

export const HIGH_QUALITY_DESKTOP_ONLY_MESSAGE = 'High quality is available in the desktop app';

export function isBrowserBlockedSegmentationModel(modelId: string): boolean {
  return modelId === 'birefnet-general-lite' || modelId === 'birefnet-general';
}

export function browserBlockedModelDownloadMessage(modelId: string): string {
  if (isBrowserBlockedSegmentationModel(modelId)) {
    return HIGH_QUALITY_DESKTOP_ONLY_MESSAGE;
  }
  return 'This model cannot be downloaded in the browser. Use the desktop app.';
}
