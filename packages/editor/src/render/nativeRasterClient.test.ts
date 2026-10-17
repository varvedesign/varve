import { describe, expect, it } from 'vitest';
import {
  decodeRasterResponse,
  describeAdmission,
  type NativeRasterAdmission,
  type NativeRasterDiagnostics,
  type NativeRasterOutcome,
  shouldPresentNativeFrame,
  toImageData,
} from './nativeRasterClient';

/**
 * These tests pin the *policy* the frontend applies to the native raster stage,
 * not the Rust implementation. The distinction matters: a native frame that is
 * presented when it should not be is a wrong-pixels bug, and the two gates
 * below are the only thing standing between a partial plan and the canvas.
 */

function diagnostics(overrides: Partial<NativeRasterDiagnostics> = {}): NativeRasterDiagnostics {
  return {
    available: true,
    deviceName: 'AMD Radeon Graphics (RADV RENOIR)',
    backend: 'vulkan',
    driver: null,
    sampleCount: 4,
    stencilFormat: 'Stencil8',
    health: {
      consecutiveFailures: 0,
      paused: false,
      pausedReason: null,
      lastErrorKey: null,
      lastErrorStage: null,
      deviceGeneration: 1,
    },
    lastReport: null,
    lastError: null,
    lastErrorStage: null,
    lastDrawCalls: 0,
    lastBuildMs: 0,
    lastEncodeMs: 0,
    lastReadbackMs: 0,
    ...overrides,
  };
}

function admission(overrides: Partial<NativeRasterAdmission> = {}): NativeRasterAdmission {
  return { considered: 10, admitted: 10, rejected: 0, reasons: {}, ...overrides };
}

function frame(pixels: number[], width = 2, height = 2): ArrayBuffer {
  const header: Omit<NativeRasterOutcome, 'pixels'> = {
    admission: admission(),
    rendered: true,
    width,
    height,
    drawCalls: 3,
    sampleCount: 4,
    lowerMs: 0.3,
    encodeMs: 0.05,
    transferMs: 9.4,
    straightenMs: 5.3,
    pixelBytes: pixels.length,
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const body = new Uint8Array(4 + headerBytes.length + pixels.length);
  new DataView(body.buffer).setUint32(0, headerBytes.length, true);
  body.set(headerBytes, 4);
  body.set(pixels, 4 + headerBytes.length);
  return body.buffer;
}

describe('shouldPresentNativeFrame', () => {
  it('accepts a fully admitted frame on a healthy stage', () => {
    expect(shouldPresentNativeFrame(diagnostics(), admission())).toBe(true);
  });

  it('refuses a partial plan, because a partial plan is not a frame', () => {
    // The native stage has no bridge for compositing a Canvas2D island into a
    // GPU-only surface, so presenting a partial plan would silently drop the
    // rejected items rather than fall back.
    const partial = admission({
      admitted: 9,
      rejected: 1,
      reasons: { 'unsupported-stroke': 1 },
    });
    expect(shouldPresentNativeFrame(diagnostics(), partial)).toBe(false);
  });

  it('refuses an empty frame', () => {
    expect(shouldPresentNativeFrame(diagnostics(), admission({ considered: 0, admitted: 0 }))).toBe(
      false,
    );
  });

  it('refuses when the stage is unavailable or paused', () => {
    expect(shouldPresentNativeFrame(null, admission())).toBe(false);
    expect(shouldPresentNativeFrame(diagnostics({ available: false }), admission())).toBe(false);
    expect(
      shouldPresentNativeFrame(
        diagnostics({
          health: {
            consecutiveFailures: 3,
            paused: true,
            pausedReason: 'native readback exceeded 10000 ms',
            lastErrorKey: 'timeout',
            lastErrorStage: 'readback',
            deviceGeneration: 1,
          },
        }),
        admission(),
      ),
    ).toBe(false);
  });

  it('refuses when no admission report exists yet', () => {
    expect(shouldPresentNativeFrame(diagnostics(), null)).toBe(false);
  });
});

describe('describeAdmission', () => {
  it('summarises a complete frame without listing empty reasons', () => {
    expect(describeAdmission(admission())).toBe('10 items admitted natively');
  });

  it('names each boundary that rejected content, with counts', () => {
    const summary = describeAdmission({
      considered: 12,
      admitted: 9,
      rejected: 3,
      reasons: {
        'unsupported-stroke': 2,
        'unsupported-primitive': 1,
        'unsupported-paint': 0,
      },
    });
    expect(summary).toBe(
      '9 of 12 items admitted natively (unsupported-primitive x1, unsupported-stroke x2)',
    );
  });

  it('never leaks a filesystem path', () => {
    const summary = describeAdmission(admission());
    expect(summary).not.toContain('/');
    expect(summary).not.toContain('\\');
  });
});

describe('decodeRasterResponse', () => {
  it('round-trips a framed response', () => {
    const decoded = decodeRasterResponse(
      frame([1, 2, 3, 255, 4, 5, 6, 255, 0, 0, 0, 0, 0, 0, 0, 0]),
    );
    expect(decoded.rendered).toBe(true);
    expect(decoded.width).toBe(2);
    expect(decoded.drawCalls).toBe(3);
    expect(decoded.pixelBytes).toBe(16);
    expect([...decoded.pixels]).toEqual([1, 2, 3, 255, 4, 5, 6, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('rejects a response whose payload disagrees with its header', () => {
    const truncated = frame([1, 2, 3, 255]).slice(0, 4 + 200);
    expect(() => decodeRasterResponse(truncated)).toThrow();
  });

  it('rejects a response shorter than its own prefix', () => {
    expect(() => decodeRasterResponse(new ArrayBuffer(2))).toThrow(
      /shorter than its header prefix/,
    );
  });
});

describe('toImageData', () => {
  const outcome = (pixels: Uint8Array, width: number, height: number): NativeRasterOutcome => ({
    admission: admission(),
    rendered: true,
    width,
    height,
    drawCalls: 1,
    sampleCount: 4,
    lowerMs: 0,
    encodeMs: 0,
    transferMs: 0,
    straightenMs: 0,
    pixelBytes: pixels.length,
    pixels,
  });

  it('wraps straight-alpha bytes without touching them', () => {
    // The Rust stage un-premultiplies before returning, so this must be a view
    // rather than a conversion: converting again would brighten translucent
    // pixels.
    const pixels = new Uint8Array([255, 0, 0, 128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const image = toImageData(outcome(pixels, 2, 2));
    expect(image.width).toBe(2);
    expect([...image.data]).toEqual([...pixels]);
  });

  it('copies rather than aliasing the response buffer', () => {
    const pixels = new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const image = toImageData(outcome(pixels, 2, 2));
    pixels[0] = 99;
    expect(image.data[0]).toBe(1);
  });

  it('refuses a buffer that does not match the declared size', () => {
    expect(() => toImageData(outcome(new Uint8Array(7), 2, 2))).toThrow(/expected 16/);
  });
});
