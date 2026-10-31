import { describe, expect, it } from 'vitest';
import {
  browserBlockedModelDownloadMessage,
  DESKTOP_ONLY_MODEL_DOWNLOAD_MESSAGE,
  isBrowserBlockedSegmentationModel,
  isGithubReleaseAssetUrl,
} from '../browserModelHost';
import { AVAILABLE_MODELS } from '../types';

describe('isGithubReleaseAssetUrl', () => {
  it('accepts rembg GitHub release assets', () => {
    expect(
      isGithubReleaseAssetUrl(
        'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx',
      ),
    ).toBe(true);
    expect(
      isGithubReleaseAssetUrl(
        'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
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
  it('blocks GitHub-hosted background-removal models and keeps Hugging Face open', () => {
    expect(isBrowserBlockedSegmentationModel('isnet-general-use')).toBe(true);
    expect(isBrowserBlockedSegmentationModel('u2netp')).toBe(true);
    expect(isBrowserBlockedSegmentationModel('birefnet-general-lite')).toBe(true);
    expect(isBrowserBlockedSegmentationModel('birefnet-general')).toBe(true);
    expect(
      isGithubReleaseAssetUrl(
        AVAILABLE_MODELS.find((m) => m.id === 'isnet-general-use')!.remoteUrl,
      ),
    ).toBe(true);
    expect(isBrowserBlockedSegmentationModel('modnet-portrait')).toBe(false);
    expect(isBrowserBlockedSegmentationModel('ddcolor')).toBe(false);
    expect(
      isBrowserBlockedSegmentationModel(
        'birefnet-general-lite',
        'https://example.com/birefnet-lite.onnx',
      ),
    ).toBe(false);
    expect(browserBlockedModelDownloadMessage('isnet-general-use')).toBe(
      DESKTOP_ONLY_MODEL_DOWNLOAD_MESSAGE,
    );
  });
});
