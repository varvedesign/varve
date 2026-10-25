// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDecode, mockDecodeBytes, mockInvoke, mockListen } = vi.hoisted(() => ({
  mockDecode: vi.fn(),
  mockDecodeBytes: vi.fn(),
  mockInvoke: vi.fn(),
  mockListen: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mockListen }));
vi.mock('../maskDecode', () => ({
  decodeMaskBytes: mockDecodeBytes,
  decodeMaskDataUrl: mockDecode,
}));

describe('Tauri background-removal provider', () => {
  beforeEach(() => {
    Object.assign(window, { __TAURI__: {} });
    mockInvoke.mockReset();
    mockListen.mockReset().mockResolvedValue(vi.fn());
    mockDecode.mockReset().mockResolvedValue({ mask: new Uint8Array([255]), width: 1, height: 1 });
    mockDecodeBytes
      .mockReset()
      .mockResolvedValue({ mask: new Uint8Array([255]), width: 1, height: 1 });
    const fakeContext = { putImageData: vi.fn() };
    const fakeBlob = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) } as Blob;
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => fakeContext,
      toBlob: (callback: (blob: Blob) => void) => callback(fakeBlob),
    } as unknown as HTMLCanvasElement);
  });

  it('does not start a native background-model download cancelled during listener setup', async () => {
    let ready!: (unlisten: () => void) => void;
    mockListen.mockImplementation(
      () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
    );
    const { downloadNativeBackgroundRemovalModel } = await import('../providers/tauriProvider');
    const controller = new AbortController();
    const unlisten = vi.fn();
    const pending = downloadNativeBackgroundRemovalModel(
      'birefnet-general-lite',
      undefined,
      controller.signal,
    );
    const rejected = expect(pending).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(ready).toBeTypeOf('function'));
    controller.abort();
    ready(unlisten);
    await rejected;
    expect(mockInvoke).not.toHaveBeenCalledWith(
      'download_background_removal_model',
      expect.anything(),
    );
    expect(unlisten).toHaveBeenCalledOnce();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, '__TAURI__');
  });

  it('requires both a ready native runtime and the requested model', async () => {
    mockInvoke.mockResolvedValue({ runtimeReady: true, installed: false, sizeBytes: 0 });
    const { tauriRemovalProvider } = await import('../providers/tauriProvider');

    await expect(tauriRemovalProvider.isAvailable({ method: 'ai-quality' })).resolves.toBe(false);

    mockInvoke.mockResolvedValue({ runtimeReady: true, installed: true, sizeBytes: 224_005_088 });
    await expect(tauriRemovalProvider.isAvailable({ method: 'ai-quality' })).resolves.toBe(true);
  });

  it('checks the installed Full artifact instead of declining native execution', async () => {
    mockInvoke.mockResolvedValue({ runtimeReady: true, installed: true, sizeBytes: 972_666_916 });
    const { tauriRemovalProvider } = await import('../providers/tauriProvider');
    await expect(
      tauriRemovalProvider.isAvailable({ method: 'ai-quality', modelId: 'birefnet-general' }),
    ).resolves.toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('native_background_removal_model_status', {
      modelId: 'birefnet-general',
    });
  });

  it('executes and reports the requested INT8 artifact and precision', async () => {
    mockInvoke.mockResolvedValue({
      maskBase64: 'test',
      confidence: 0.9,
      method: 'ai-balanced',
      modelId: 'u2netp-int8',
      processingTimeMs: 1,
      width: 1,
      height: 1,
      executionProvider: 'native-cpu',
    });
    const { tauriRemovalProvider } = await import('../providers/tauriProvider');
    const result = await tauriRemovalProvider.remove(new ImageData(1, 1), {
      method: 'ai-balanced',
      modelId: 'u2netp-int8',
    });
    expect(result).toMatchObject({
      modelId: 'u2netp-int8',
      modelPrecision: 'int8',
      executionProvider: 'native-cpu',
    });
  });

  it('sends and reports the exact native model used for an explicit Full request', async () => {
    mockInvoke.mockResolvedValue({
      maskBase64: 'test',
      confidence: 0.98,
      method: 'ai-quality',
      modelId: 'birefnet-general',
      processingTimeMs: 123,
      width: 1,
      height: 1,
    });
    const { tauriRemovalProvider } = await import('../providers/tauriProvider');
    const result = await tauriRemovalProvider.remove(
      new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1),
      { method: 'ai-quality', modelId: 'birefnet-general' },
    );
    expect(mockInvoke).toHaveBeenCalledWith('preflight_native_background_removal', {
      modelId: 'birefnet-general',
      width: 1,
      height: 1,
    });
    const args = mockInvoke.mock.calls.find(
      ([command]) => command === 'remove_background_binary',
    )?.[2] as { headers: { 'x-varve-bg-remove-options': string } };
    expect(JSON.parse(args.headers['x-varve-bg-remove-options']).modelId).toBe('birefnet-general');
    expect(result.modelId).toBe('birefnet-general');
  });

  it.each(['birefnet-general-lite', undefined])(
    'rejects an explicit Full result with mismatched or missing model provenance (%s)',
    async (modelId) => {
      mockInvoke.mockResolvedValue({
        maskBase64: 'test',
        confidence: 0.9,
        method: 'ai-quality',
        modelId,
        processingTimeMs: 10,
        width: 1,
        height: 1,
      });
      const { tauriRemovalProvider } = await import('../providers/tauriProvider');
      await expect(
        tauriRemovalProvider.remove(new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1), {
          method: 'ai-quality',
          modelId: 'birefnet-general',
        }),
      ).rejects.toThrow(/model/i);
      expect(mockDecode).not.toHaveBeenCalled();
    },
  );

  it('preflights native memory before encoding the source canvas', async () => {
    const commands: string[] = [];
    mockInvoke.mockImplementation(async (command: string) => {
      commands.push(command);
      if (command === 'preflight_native_background_removal') return undefined;
      return {
        maskBase64: 'test',
        confidence: 0.98,
        method: 'ai-quality',
        processingTimeMs: 123,
        width: 1,
        height: 1,
      };
    });
    const { tauriRemovalProvider } = await import('../providers/tauriProvider');

    await tauriRemovalProvider.remove(new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1), {
      method: 'ai-quality',
    });

    expect(commands).toEqual(['preflight_native_background_removal', 'remove_background_binary']);
    expect(mockInvoke).toHaveBeenCalledWith('preflight_native_background_removal', {
      modelId: 'birefnet-general-lite',
      width: 1,
      height: 1,
    });
  });

  it('cancels the native request by identity and discards its late result after execution settles', async () => {
    let finish!: (result: unknown) => void;
    mockInvoke.mockImplementation((command: string) => {
      if (command === 'remove_background_binary') {
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      return Promise.resolve();
    });
    const { tauriRemovalProvider } = await import('../providers/tauriProvider');
    const controller = new AbortController();
    const result = tauriRemovalProvider.remove(
      new ImageData(1, 1),
      { method: 'ai-quality' },
      controller.signal,
    );
    const rejected = expect(result).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const args = mockInvoke.mock.calls.find(
      ([command]) => command === 'remove_background_binary',
    )?.[2] as { headers: { 'x-varve-bg-remove-options': string } };
    const { requestId } = JSON.parse(args.headers['x-varve-bg-remove-options']);
    controller.abort();
    const cancellation = mockInvoke.mock.calls.find(
      ([command]) => command === 'cancel_background_removal',
    );
    finish({ maskBase64: 'test', method: 'ai-quality', width: 1, height: 1 });
    await rejected;
    expect(requestId).toEqual(expect.any(String));
    expect(cancellation).toEqual(['cancel_background_removal', { requestId }]);
    expect(mockDecode).not.toHaveBeenCalled();
  });

  it('returns a source-reconstructable raw mask and native backend telemetry', async () => {
    mockInvoke.mockResolvedValue({
      maskBase64: 'test',
      confidence: 0.98,
      method: 'ai-quality',
      processingTimeMs: 123,
      width: 1,
      height: 1,
    });
    const { tauriRemovalProvider } = await import('../providers/tauriProvider');
    const result = await tauriRemovalProvider.remove(
      new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1),
      { method: 'ai-quality' },
    );

    expect(result.executionProvider).toBe('native');
    expect(result.rawMask).toEqual(new Uint8Array([255]));
    expect(result.method).toBe('ai-quality');
  });

  it('defaults native decontamination to false to match worker/direct providers', async () => {
    mockInvoke.mockResolvedValue({
      maskBase64: 'test',
      confidence: 0.9,
      method: 'ai-quality',
      processingTimeMs: 10,
      width: 1,
      height: 1,
    });
    const { tauriRemovalProvider } = await import('../providers/tauriProvider');
    await tauriRemovalProvider.remove(new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1), {
      method: 'ai-quality',
    });
    const args = mockInvoke.mock.calls.find(
      ([command]) => command === 'remove_background_binary',
    )?.[2] as { headers: { 'x-varve-bg-remove-options': string } };
    expect(JSON.parse(args.headers['x-varve-bg-remove-options']).decontaminate).toBe(false);

    await tauriRemovalProvider.remove(new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1), {
      method: 'ai-quality',
      decontaminate: true,
    });
    const explicit = mockInvoke.mock.calls.filter(
      ([command]) => command === 'remove_background_binary',
    ) as Array<[string, ArrayBuffer, { headers: { 'x-varve-bg-remove-options': string } }]>;
    expect(
      JSON.parse(explicit.at(-1)?.[2].headers['x-varve-bg-remove-options'] ?? '{}').decontaminate,
    ).toBe(true);
  });

  it('uses the versioned binary envelope for a native mask response', async () => {
    const metadata = new TextEncoder().encode(
      JSON.stringify({
        confidence: 0.98,
        method: 'ai-quality',
        processingTimeMs: 123,
        width: 1,
        height: 1,
        executionProvider: 'native-webgpu',
      }),
    );
    const maskBytes = new Uint8Array([137, 80, 78, 71]);
    const wire = new Uint8Array(8 + metadata.length + maskBytes.length);
    wire.set([0x56, 0x42, 0x47, 0x31], 0);
    new DataView(wire.buffer).setUint32(4, metadata.length, true);
    wire.set(metadata, 8);
    wire.set(maskBytes, 8 + metadata.length);
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'preflight_native_background_removal') return undefined;
      return wire.buffer;
    });

    const { tauriRemovalProvider } = await import('../providers/tauriProvider');
    const result = await tauriRemovalProvider.remove(
      new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1),
      { method: 'ai-quality' },
    );

    expect(mockInvoke).toHaveBeenCalledWith(
      'remove_background_binary',
      expect.any(ArrayBuffer),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-varve-bg-remove-options': expect.stringContaining('ai-quality'),
        }),
      }),
    );
    expect(mockDecodeBytes).toHaveBeenCalledWith(maskBytes);
    expect(result.executionProvider).toBe('native-webgpu');
  });

  it('forwards native download progress and uses the fixed model-id command', async () => {
    let progressHandler: ((event: { payload: unknown }) => void) | undefined;
    mockListen.mockImplementation(
      async (_event: string, handler: (event: { payload: unknown }) => void) => {
        progressHandler = handler;
        return vi.fn();
      },
    );
    mockInvoke.mockImplementation(async (command: string, args: Record<string, string>) => {
      if (command === 'download_background_removal_model') {
        progressHandler?.({
          payload: {
            requestId: args.requestId,
            modelId: args.modelId,
            loaded: 50,
            total: 100,
          },
        });
        return 100;
      }
      return undefined;
    });
    const progress = vi.fn();
    const { downloadNativeBackgroundRemovalModel } = await import('../providers/tauriProvider');
    await downloadNativeBackgroundRemovalModel('birefnet-general-lite', progress);

    expect(progress).toHaveBeenCalledWith(50, 100);
    expect(mockInvoke).toHaveBeenCalledWith(
      'download_background_removal_model',
      expect.objectContaining({ modelId: 'birefnet-general-lite' }),
    );
  });
});
