import { describe, expect, it } from 'vitest';
import {
  browserBlockedModelDownloadMessage,
  HIGH_QUALITY_DESKTOP_ONLY_MESSAGE,
  isBrowserBlockedSegmentationModel,
  isGithubReleaseAssetUrl,
} from '../browserModelHost';

describe('isGithubReleaseAssetUrl', () => {
  it('accepts rembg GitHub release assets', () => {
    expect(
      isGithubReleaseAssetUrl(
        'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx',
      ),
    ).toBe(true);
  });

  it('rejects Hugging Face and malformed URLs', () => {
    expect(
      isGithubReleaseAssetUrl('https://huggingface.co/Xenova/modnet/resolve/main/onnx/model.onnx'),
    ).toBe(false);
    expect(isGithubReleaseAssetUrl('not a url')).toBe(false);
  });
});

describe('browser blocked segmentation models', () => {
  it('names High quality / BiRefNet as desktop-only', () => {
    expect(isBrowserBlockedSegmentationModel('birefnet-general-lite')).toBe(true);
    expect(isBrowserBlockedSegmentationModel('birefnet-general')).toBe(true);
    expect(isBrowserBlockedSegmentationModel('u2netp')).toBe(false);
    expect(browserBlockedModelDownloadMessage('birefnet-general-lite')).toBe(
      HIGH_QUALITY_DESKTOP_ONLY_MESSAGE,
    );
  });
});
