/**
 * Regression: capacity refusals must not dead-end an AI feature.
 *
 * The reported defect (2026-10-22) was a 480x640 "High quality" background
 * removal refused with
 *
 *   Request reserves 541786112 bytes, above the 400000000-byte process limit.
 *
 * before any provider ran. The shared ledger had never been told how much
 * memory the host actually has, and the refusal surfaced as a raw byte count.
 * These tests pin both halves of the fix:
 *
 * 1. A measured host budget admits the reservation that used to be refused.
 * 2. When the budget really is too small, `ai-quality` retries the bundled
 *    `ai-balanced` model instead of failing, and an explicit model request is
 *    still honoured rather than silently substituted.
 *
 * Everything is imported dynamically after `vi.resetModules()`: `@varve/platform`
 * holds the admission singleton, so a statically imported copy would be a
 * different module instance from the one the engine sees.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

function makeImageData(w: number, h: number): ImageData {
  return {
    data: new Uint8ClampedArray(w * h * 4).fill(200),
    width: w,
    height: h,
    colorSpace: 'srgb' as const,
  };
}

const resultFor = (method: 'ai-balanced') => ({
  maskDataUrl: 'data:image/png;base64,test',
  confidence: 0.8,
  method,
  processingTimeMs: 5,
  width: 480,
  height: 640,
});

/** Install a gate with the given byte ceiling on the freshly loaded modules. */
async function installBudget(bytes: number): Promise<void> {
  const platform = await import('@varve/platform');
  platform.setDerivedWorkAdmissionForTest(
    new platform.DerivedWorkAdmission({ maxReservedBytes: bytes }),
  );
}

/** Worker ONNX answers whatever mode reaches it; other providers are absent. */
function mockProviders(seenMethods: string[]): void {
  vi.doMock('../providers/workerProvider', () => ({
    workerRemovalProvider: {
      id: 'worker-onnx',
      isAvailable: () => true,
      remove: async (_image: ImageData, options: { method: string }) => {
        seenMethods.push(options.method);
        if (options.method === 'ai-quality' || options.method === 'ai-balanced') {
          return { ...resultFor('ai-balanced'), method: options.method };
        }
        throw new Error(`unexpected method ${options.method}`);
      },
    },
  }));
  vi.doMock('../providers/tauriProvider', () => ({
    isNativeAiReady: async () => false,
    tauriRemovalProvider: {
      id: 'tauri-native',
      isAvailable: () => false,
      remove: async () => {
        throw new Error('native provider unavailable in test');
      },
    },
    getNativeBackgroundRemovalModelStatus: async () => null,
    preflightNativeBackgroundRemoval: async () => undefined,
  }));
  vi.doMock('../providers/directOnnxProvider', () => ({
    directOnnxRemovalProvider: {
      id: 'direct-onnx',
      isAvailable: () => false,
      remove: async () => {
        throw new Error('direct provider unavailable in test');
      },
    },
  }));
  vi.doMock('../providers/cloudProvider', () => ({
    cloudRemovalProvider: {
      id: 'cloud',
      isAvailable: () => false,
      remove: async () => {
        throw new Error('cloud provider unavailable in test');
      },
    },
  }));
}

describe('background removal admission capacity', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('admits ai-quality once the measured host budget covers it', async () => {
    // An 8 GB host measures ~8 GB available → 6 GB tracked budget. Before the
    // fix this same request was refused against the 400 MB placeholder.
    await installBudget(6 * GIB);
    const seenMethods: string[] = [];
    mockProviders(seenMethods);

    const { dispatchBackgroundRemoval } = await import('../providers/dispatch');
    const result = await dispatchBackgroundRemoval(makeImageData(480, 640), {
      method: 'ai-quality',
    });

    expect(seenMethods).toEqual(['ai-quality']);
    expect(result.method).toBe('ai-quality');
  });

  it('reserves from the model that will load, not a fixed constant', async () => {
    const { estimateInferenceReservation } = await import('../../inference/admission');
    const { getModelById } = await import('../../inference/modelCatalog');

    // 480x640 high-quality request: weights x2 + 4x the RGBA frame.
    const weights = getModelById('birefnet-general-lite')?.sizeBytes ?? 0;
    const expected = Math.max(128 * MIB, weights * 2) + Math.ceil(480 * 640 * 4 * 4);
    expect(
      estimateInferenceReservation({
        width: 480,
        height: 640,
        modelBytes: Math.max(128 * MIB, weights * 2),
      }),
    ).toBe(expected);
    // The old constant charged 512 MiB for a 224 MB model and ignored the
    // user's actual selection.
    expect(Math.max(128 * MIB, weights * 2)).toBeLessThan(512 * MIB);
  });

  it('retries ai-balanced when the budget cannot fit ai-quality', async () => {
    await installBudget(200 * MIB);
    const seenMethods: string[] = [];
    mockProviders(seenMethods);

    const { dispatchBackgroundRemoval } = await import('../providers/dispatch');
    const result = await dispatchBackgroundRemoval(makeImageData(480, 640), {
      method: 'ai-quality',
    });

    // Nothing ran at ai-quality: the refusal happens before any provider.
    expect(seenMethods).toEqual(['ai-balanced']);
    expect(result.method).toBe('ai-balanced');
  });

  it('honours an explicit model instead of substituting ai-balanced', async () => {
    await installBudget(200 * MIB);
    const seenMethods: string[] = [];
    mockProviders(seenMethods);

    const { dispatchBackgroundRemoval, BackgroundRemovalCapacityError } = await import(
      '../providers/dispatch'
    );
    const error = await dispatchBackgroundRemoval(makeImageData(480, 640), {
      method: 'ai-quality',
      modelId: 'birefnet-general-lite',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BackgroundRemovalCapacityError);
    expect((error as { code?: string }).code).toBe('insufficient-memory');
    expect((error as Error).message).toMatch(/shared local-AI memory budget/);
    // Never a raw byte count a person has to decode.
    expect((error as Error).message).not.toMatch(/\d{6,} bytes/);
    expect(seenMethods).toEqual([]);
  });
});
