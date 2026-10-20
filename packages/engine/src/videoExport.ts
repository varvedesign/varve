/**
 * Video export — timeline frame loop + WebCodecs encode + MP4/WebM mux.
 *
 * Uses IR-replay via an injected frame renderer callback so this module
 * stays free of @varve/editor circular dependencies.
 */

export interface VideoTimelineRef {
  id: string;
  duration: number;
}

export interface VideoExportOptions {
  width: number;
  height: number;
  fps: number;
  codec?: 'h264' | 'vp9';
  reducedMotion?: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface VideoExportResult {
  bytes: Uint8Array | null;
  frameCount: number;
  supported: boolean;
  reason?: string;
  mimeType?: string;
}

export interface VideoExportSupport {
  supported: boolean;
  reason?: string;
}

export type VideoFrameRenderer = (
  timeMs: number,
  frameIndex: number,
) => Promise<ImageBitmap | Uint8Array>;

const H264_CODEC_CANDIDATES = ['avc1.42001E', 'avc1.4D401E', 'avc1.64001E'] as const;
const VP9_CODEC = 'vp09.00.10.08';
export const MAX_VIDEO_EXPORT_DIMENSION = 16_384;
export const MAX_VIDEO_EXPORT_PIXELS = 8_388_608;
export const MAX_VIDEO_EXPORT_FRAMES = 10_000;
export const MAX_VIDEO_EXPORT_PIXEL_FRAMES = 4_000_000_000;

export function videoExportDimensionsError(width: number, height: number): string | null {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    return 'Video export dimensions must be positive whole pixels';
  }
  if (width > MAX_VIDEO_EXPORT_DIMENSION || height > MAX_VIDEO_EXPORT_DIMENSION) {
    return `Video export dimensions cannot exceed ${MAX_VIDEO_EXPORT_DIMENSION} pixels per side`;
  }
  if (width > Math.floor(MAX_VIDEO_EXPORT_PIXELS / height)) {
    return `Video export is limited to ${MAX_VIDEO_EXPORT_PIXELS.toLocaleString()} pixels per frame`;
  }
  return null;
}

export function videoExportRequestError(
  timeline: VideoTimelineRef,
  options: VideoExportOptions,
): string | null {
  const dimensionError = videoExportDimensionsError(options.width, options.height);
  if (dimensionError) return dimensionError;
  if (!Number.isFinite(timeline.duration) || timeline.duration < 0) {
    return 'Video export requires a finite, non-negative timeline duration';
  }
  if (!Number.isFinite(options.fps) || options.fps < 1 || options.fps > 60) {
    return 'Video export frame rate must be between 1 and 60 fps';
  }
  const frames = options.reducedMotion
    ? 1
    : Math.max(Math.ceil((timeline.duration / 1000) * options.fps), 1);
  if (!Number.isSafeInteger(frames) || frames > MAX_VIDEO_EXPORT_FRAMES) {
    return `Video export is limited to ${MAX_VIDEO_EXPORT_FRAMES.toLocaleString()} frames`;
  }
  const pixelsPerFrame = options.width * options.height;
  if (frames > Math.floor(MAX_VIDEO_EXPORT_PIXEL_FRAMES / pixelsPerFrame)) {
    return `Video export is limited to ${MAX_VIDEO_EXPORT_PIXEL_FRAMES.toLocaleString()} total pixels across all frames`;
  }
  return null;
}

export function computeVideoFrameCount(
  durationMs: number,
  fps: number,
  reducedMotion = false,
): number {
  if (reducedMotion) return 1;
  if (!Number.isFinite(durationMs) || !Number.isFinite(fps) || fps <= 0) return 1;
  const frames = Math.ceil((Math.max(durationMs, 0) / 1000) * fps);
  return Number.isSafeInteger(frames)
    ? Math.min(Math.max(frames, 1), MAX_VIDEO_EXPORT_FRAMES + 1)
    : 1;
}

/**
 * Resolve a video frame to the same deterministic clock used by the encoder.
 * Frame zero is the first sample; the duration endpoint is not an extra frame.
 */
export function frameTimeMs(frameIndex: number, fps: number): number {
  if (!Number.isFinite(frameIndex) || frameIndex < 0) return 0;
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  return (frameIndex * 1000) / fps;
}

function frameTimestampUs(frameIndex: number, fps: number): number {
  return Math.round(frameTimeMs(frameIndex, fps) * 1000);
}

export function checkVideoExportSupport(): VideoExportSupport {
  if (typeof globalThis.VideoEncoder === 'undefined') {
    return { supported: false, reason: 'VideoEncoder API unavailable' };
  }
  const hasCanvas =
    typeof OffscreenCanvas !== 'undefined' || typeof HTMLCanvasElement !== 'undefined';
  if (!hasCanvas) {
    return { supported: false, reason: 'OffscreenCanvas unavailable' };
  }
  if (typeof globalThis.VideoFrame === 'undefined') {
    return { supported: false, reason: 'VideoFrame API unavailable' };
  }
  return { supported: true };
}

function frameDurationUs(fps: number): number {
  return Math.round(1_000_000 / fps);
}

function rgbaByteLength(width: number, height: number): number {
  return width * height * 4;
}

async function rgbaToVideoFrame(
  rgba: Uint8Array,
  width: number,
  height: number,
  timestampUs: number,
  durationUs: number,
): Promise<VideoFrame> {
  const expected = rgbaByteLength(width, height);
  if (rgba.byteLength < expected) {
    throw new Error(`Frame data too small: expected ${expected}, got ${rgba.byteLength}`);
  }
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : (() => {
          const c = document.createElement('canvas');
          c.width = width;
          c.height = height;
          return c;
        })();
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('2D context unavailable for video frame conversion');
  const clamped = new Uint8ClampedArray(expected);
  clamped.set(rgba.subarray(0, expected));
  ctx.putImageData(new ImageData(clamped, width, height), 0, 0);
  return new VideoFrame(canvas as CanvasImageSource, {
    timestamp: timestampUs,
    duration: durationUs,
  });
}

async function sourceToVideoFrame(
  source: ImageBitmap | Uint8Array,
  width: number,
  height: number,
  timestampUs: number,
  durationUs: number,
): Promise<VideoFrame> {
  if (source instanceof Uint8Array) {
    return rgbaToVideoFrame(source, width, height, timestampUs, durationUs);
  }
  const frame = new VideoFrame(source, { timestamp: timestampUs, duration: durationUs });
  source.close();
  return frame;
}

async function pickH264Codec(width: number, height: number, fps: number): Promise<string | null> {
  for (const codec of H264_CODEC_CANDIDATES) {
    const result = await VideoEncoder.isConfigSupported({
      codec,
      width,
      height,
      bitrate: 2_000_000,
      framerate: fps,
    });
    if (result.supported) return codec;
  }
  return null;
}

async function pickVp9Codec(width: number, height: number, fps: number): Promise<boolean> {
  const result = await VideoEncoder.isConfigSupported({
    codec: VP9_CODEC,
    width,
    height,
    bitrate: 2_000_000,
    framerate: fps,
  });
  return result.supported === true;
}

interface EncoderSession {
  encodeFrame: (frame: VideoFrame, keyFrame: boolean) => void;
  waitForCapacity: () => Promise<void>;
  flush: () => Promise<void>;
  close: () => void;
  mimeType: string;
  getBytes: () => Uint8Array;
}

async function createEncoderSession(
  options: VideoExportOptions,
): Promise<EncoderSession | { error: string }> {
  const { width, height, fps } = options;
  const preferH264 = options.codec !== 'vp9';

  if (preferH264) {
    const h264 = await pickH264Codec(width, height, fps);
    if (h264) {
      const { ArrayBufferTarget, Muxer } = await import('mp4-muxer');
      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        video: { codec: 'avc', width, height },
        fastStart: 'in-memory',
      });
      let encoderFailure: Error | null = null;
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (error) => {
          encoderFailure = error;
        },
      });
      encoder.configure({
        codec: h264,
        width,
        height,
        bitrate: 2_000_000,
        framerate: fps,
      });
      return {
        mimeType: 'video/mp4',
        encodeFrame: (frame, keyFrame) => encoder.encode(frame, { keyFrame }),
        waitForCapacity: () =>
          waitForEncoderCapacity(encoder, () => encoderFailure, options.signal),
        flush: async () => {
          await encoder.flush();
          encoder.close();
          muxer.finalize();
        },
        close: () => encoder.close(),
        getBytes: () => new Uint8Array(target.buffer),
      };
    }
  }

  const vp9Ok = await pickVp9Codec(width, height, fps);
  if (!vp9Ok) {
    return { error: 'No supported H.264 or VP9 encoder configuration' };
  }

  const { ArrayBufferTarget, Muxer } = await import('webm-muxer');
  const chunks: EncodedVideoChunk[] = [];
  let encoderFailure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk) => chunks.push(chunk),
    error: (error) => {
      encoderFailure = error;
    },
  });
  encoder.configure({
    codec: VP9_CODEC,
    width,
    height,
    bitrate: 2_000_000,
    framerate: fps,
  });

  const webmTarget = new ArrayBufferTarget();
  const webmMuxer = new Muxer({
    target: webmTarget,
    video: { codec: 'V_VP9', width, height, frameRate: fps },
  });

  return {
    mimeType: 'video/webm',
    encodeFrame: (frame, keyFrame) => encoder.encode(frame, { keyFrame }),
    waitForCapacity: () => waitForEncoderCapacity(encoder, () => encoderFailure, options.signal),
    flush: async () => {
      await encoder.flush();
      encoder.close();
      for (const chunk of chunks) {
        webmMuxer.addVideoChunk(chunk);
      }
      webmMuxer.finalize();
    },
    close: () => encoder.close(),
    getBytes: () => new Uint8Array(webmTarget.buffer),
  };
}

export async function exportTimelineToVideo(
  timeline: VideoTimelineRef,
  options: VideoExportOptions,
  renderFrame: VideoFrameRenderer,
): Promise<VideoExportResult> {
  const support = checkVideoExportSupport();
  const frameCount = computeVideoFrameCount(timeline.duration, options.fps, options.reducedMotion);

  const limitError = videoExportRequestError(timeline, options);
  if (limitError) {
    return { bytes: null, frameCount, supported: false, reason: limitError };
  }

  if (!support.supported) {
    return {
      bytes: null,
      frameCount,
      supported: false,
      reason: support.reason,
    };
  }

  const session = await createEncoderSession(options);
  if ('error' in session) {
    return {
      bytes: null,
      frameCount,
      supported: false,
      reason: session.error,
    };
  }

  const durationUs = frameDurationUs(options.fps);
  const keyFrameInterval = Math.max(1, options.fps * 2);

  try {
    for (let i = 0; i < frameCount; i++) {
      if (options.signal?.aborted) {
        session.close();
        return {
          bytes: null,
          frameCount,
          supported: true,
          reason: 'Export cancelled',
        };
      }

      await session.waitForCapacity();
      if (options.signal?.aborted) {
        session.close();
        return {
          bytes: null,
          frameCount,
          supported: true,
          reason: 'Export cancelled',
        };
      }

      const timeMs = options.reducedMotion ? timeline.duration : frameTimeMs(i, options.fps);

      const source = await renderFrame(timeMs, i);
      const timestampUs = options.reducedMotion ? 0 : frameTimestampUs(i, options.fps);
      const frame = await sourceToVideoFrame(
        source,
        options.width,
        options.height,
        timestampUs,
        durationUs,
      );
      try {
        session.encodeFrame(frame, i % keyFrameInterval === 0);
      } finally {
        frame.close();
      }
      options.onProgress?.(i + 1, frameCount);
    }

    await session.flush();
    return {
      bytes: session.getBytes(),
      frameCount,
      supported: true,
      mimeType: session.mimeType,
    };
  } catch (err) {
    session.close();
    const message = err instanceof Error ? err.message : String(err);
    return {
      bytes: null,
      frameCount,
      supported: false,
      reason: message,
    };
  }
}

async function waitForEncoderCapacity(
  encoder: VideoEncoder,
  getFailure: () => Error | null,
  signal?: AbortSignal,
  maxQueuedFrames = 2,
): Promise<void> {
  while (encoder.encodeQueueSize >= maxQueuedFrames) {
    if (signal?.aborted) return;
    const failure = getFailure();
    if (failure) throw failure;
    await new Promise<void>((resolve) => {
      const onDequeue = () => {
        clearTimeout(pollTimer);
        encoder.removeEventListener('dequeue', onDequeue);
        resolve();
      };
      const pollTimer = setTimeout(() => {
        encoder.removeEventListener('dequeue', onDequeue);
        resolve();
      }, 50);
      encoder.addEventListener('dequeue', onDequeue, { once: true });
    });
  }
  const failure = getFailure();
  if (failure) throw failure;
}
