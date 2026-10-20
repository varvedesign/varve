import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkVideoExportSupport,
  computeVideoFrameCount,
  exportTimelineToVideo,
  frameTimeMs,
  type VideoFrameRenderer,
} from './videoExport';

describe('computeVideoFrameCount', () => {
  it('computes frame count from duration and fps', () => {
    expect(computeVideoFrameCount(2000, 30)).toBe(60);
    expect(computeVideoFrameCount(1000, 24)).toBe(24);
  });

  it('returns 1 frame when reduced motion is enabled', () => {
    expect(computeVideoFrameCount(2000, 30, true)).toBe(1);
  });

  it('returns at least 1 frame for zero duration', () => {
    expect(computeVideoFrameCount(0, 30)).toBe(1);
  });

  it('returns one frame for invalid frame rates', () => {
    expect(computeVideoFrameCount(1000, 0)).toBe(1);
    expect(computeVideoFrameCount(1000, Number.NaN)).toBe(1);
  });

  it('returns a finite display count for malformed or excessive durations', () => {
    expect(computeVideoFrameCount(Number.POSITIVE_INFINITY, 30)).toBe(1);
    expect(computeVideoFrameCount(Number.MAX_VALUE, 60)).toBe(1);
  });
});

describe('frameTimeMs', () => {
  it('maps frame indices to a deterministic frame clock', () => {
    expect(frameTimeMs(0, 30)).toBe(0);
    expect(frameTimeMs(1, 30)).toBeCloseTo(1000 / 30);
    expect(frameTimeMs(29, 30)).toBeCloseTo((29 * 1000) / 30);
  });

  it('does not emit invalid times for invalid input', () => {
    expect(frameTimeMs(-1, 30)).toBe(0);
    expect(frameTimeMs(0, 0)).toBe(0);
  });
});

describe('checkVideoExportSupport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unsupported when VideoEncoder is missing', () => {
    vi.stubGlobal('VideoEncoder', undefined);
    const result = checkVideoExportSupport();
    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/VideoEncoder/i);
  });

  it('reports supported when VideoEncoder and canvas are available', () => {
    vi.stubGlobal(
      'VideoEncoder',
      Object.assign(function VideoEncoder() {}, {
        isConfigSupported: vi.fn(async () => ({ supported: true })),
      }),
    );
    vi.stubGlobal('VideoFrame', class VideoFrame {});
    vi.stubGlobal('OffscreenCanvas', class OffscreenCanvas {});
    const result = checkVideoExportSupport();
    expect(result.supported).toBe(true);
  });
});

describe('exportTimelineToVideo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns unsupported fallback when WebCodecs unavailable', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    const renderer: VideoFrameRenderer = vi.fn(async () => new Uint8Array(4));
    const result = await exportTimelineToVideo(
      { id: 'tl1', duration: 2000 },
      { width: 320, height: 240, fps: 30 },
      renderer,
    );
    expect(result.supported).toBe(false);
    expect(result.bytes).toBeNull();
    expect(result.frameCount).toBe(60);
    expect(renderer).not.toHaveBeenCalled();
  });

  it('reports reduced-motion single frame count without encoding', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    const result = await exportTimelineToVideo(
      { id: 'tl1', duration: 2000 },
      { width: 320, height: 240, fps: 30, reducedMotion: true },
      vi.fn(),
    );
    expect(result.frameCount).toBe(1);
  });

  it('rejects oversized frame surfaces before asking for a codec or rendering', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    const renderer = vi.fn(async () => new Uint8Array(4));
    const result = await exportTimelineToVideo(
      { id: 'tl1', duration: 1000 },
      { width: 4096, height: 4096, fps: 30 },
      renderer,
    );

    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/pixels per frame/);
    expect(result.bytes).toBeNull();
    expect(renderer).not.toHaveBeenCalled();
  });

  it('rejects malformed or excessive timeline durations before rendering', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    const renderer = vi.fn(async () => new Uint8Array(4));
    const invalid = await exportTimelineToVideo(
      { id: 'tl1', duration: Number.POSITIVE_INFINITY },
      { width: 64, height: 64, fps: 30 },
      renderer,
    );
    const excessive = await exportTimelineToVideo(
      { id: 'tl2', duration: 400_000 },
      { width: 64, height: 64, fps: 30 },
      renderer,
    );

    expect(invalid.reason).toMatch(/finite/);
    expect(excessive.reason).toMatch(/10,000 frames/);
    expect(renderer).not.toHaveBeenCalled();
  });
});

describe('exportTimelineToVideo frame timing (mock encoder)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls renderer at deterministic frame-clock times', async () => {
    const renderTimes: number[] = [];
    const renderQueueSizes: number[] = [];
    let maximumEncodeQueueSize = 0;
    let currentEncoderQueueSize = 0;
    const renderer: VideoFrameRenderer = vi.fn(async (timeMs) => {
      renderTimes.push(timeMs);
      renderQueueSizes.push(currentEncoderQueueSize);
      return new Uint8Array(64 * 64 * 4);
    });

    class MockVideoEncoder {
      static isConfigSupported = vi.fn(async () => ({ supported: true }));
      encodeQueueSize = 0;
      private dequeueListeners = new Set<() => void>();
      configure = vi.fn();
      encode = vi.fn(() => {
        this.encodeQueueSize++;
        currentEncoderQueueSize = this.encodeQueueSize;
        maximumEncodeQueueSize = Math.max(maximumEncodeQueueSize, this.encodeQueueSize);
        setTimeout(() => {
          this.encodeQueueSize = Math.max(0, this.encodeQueueSize - 1);
          currentEncoderQueueSize = this.encodeQueueSize;
          for (const listener of this.dequeueListeners) listener();
        }, 0);
      });
      flush = vi.fn(async () => {});
      close = vi.fn();
      addEventListener(_type: string, listener: () => void) {
        this.dequeueListeners.add(listener);
      }
      removeEventListener(_type: string, listener: () => void) {
        this.dequeueListeners.delete(listener);
      }
    }

    class MockVideoFrame {
      close() {}
    }

    vi.stubGlobal('VideoEncoder', MockVideoEncoder);
    vi.stubGlobal('VideoFrame', MockVideoFrame);
    vi.stubGlobal(
      'OffscreenCanvas',
      class OffscreenCanvas {
        width = 0;
        height = 0;
        getContext() {
          return {
            putImageData: vi.fn(),
          };
        }
      },
    );
    vi.stubGlobal('ImageData', class ImageData {});

    const result = await exportTimelineToVideo(
      { id: 'tl1', duration: 1000 },
      { width: 64, height: 64, fps: 10 },
      renderer,
    );

    expect(result.frameCount).toBe(10);
    expect(renderTimes.length).toBe(10);
    expect(renderTimes[0]).toBe(0);
    expect(renderTimes[9]).toBeCloseTo(900, 0);
    expect(maximumEncodeQueueSize).toBeLessThanOrEqual(2);
    expect(renderQueueSizes.every((size) => size < 2)).toBe(true);
  });

  it('renders only final frame when reduced motion is on', async () => {
    const renderTimes: number[] = [];
    const renderer: VideoFrameRenderer = vi.fn(async (timeMs) => {
      renderTimes.push(timeMs);
      return new Uint8Array(64 * 64 * 4);
    });

    class MockVideoEncoder {
      static isConfigSupported = vi.fn(async () => ({ supported: true }));
      configure = vi.fn();
      encode = vi.fn();
      flush = vi.fn(async () => {});
      close = vi.fn();
    }

    vi.stubGlobal('VideoEncoder', MockVideoEncoder);
    vi.stubGlobal(
      'VideoFrame',
      class VideoFrame {
        close() {}
      },
    );
    vi.stubGlobal(
      'OffscreenCanvas',
      class OffscreenCanvas {
        getContext() {
          return { putImageData: vi.fn() };
        }
      },
    );
    vi.stubGlobal('ImageData', class ImageData {});

    await exportTimelineToVideo(
      { id: 'tl1', duration: 2000 },
      { width: 64, height: 64, fps: 30, reducedMotion: true },
      renderer,
    );

    expect(renderTimes).toEqual([2000]);
  });
});
