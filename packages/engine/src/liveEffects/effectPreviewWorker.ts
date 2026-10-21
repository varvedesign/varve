import { cpuEffectProvider } from './cpuProvider';
import type {
  EffectPreviewBackend,
  EffectPreviewWorkerRequest,
  EffectPreviewWorkerResponse,
} from './effectPreviewRunner';
import {
  applyWasmEffect,
  canUseWasmEffect,
  loadWasmEffectsBeforeDeadline,
} from './wasmEffectsLoader';

interface EffectWorkerScope {
  onmessage: ((event: MessageEvent<EffectPreviewWorkerRequest>) => void) | null;
  postMessage(message: EffectPreviewWorkerResponse, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as EffectWorkerScope;

scope.onmessage = (event) => {
  const { id, request, rgba } = event.data;
  try {
    const source = new Uint8ClampedArray(rgba);
    if (
      !Number.isSafeInteger(request.width) ||
      !Number.isSafeInteger(request.height) ||
      request.width < 1 ||
      request.height < 1 ||
      source.byteLength !== request.width * request.height * 4
    ) {
      throw new Error('Effect worker received invalid dimensions or RGBA bytes.');
    }
    void runEffect(request, source)
      .then(
        ({ result, backend }) => {
          const output = result.buffer;
          if (
            !(output instanceof ArrayBuffer) ||
            result.byteOffset !== 0 ||
            result.byteLength !== output.byteLength
          ) {
            throw new Error('Canonical effect provider returned a non-transferable buffer.');
          }
          scope.postMessage({ type: 'result', id, rgba: output, backend }, [output]);
        },
        (error: unknown) => {
          scope.postMessage(
            { type: 'error', id, message: error instanceof Error ? error.message : String(error) },
            [],
          );
        },
      )
      .catch((error: unknown) => {
        scope.postMessage(
          { type: 'error', id, message: error instanceof Error ? error.message : String(error) },
          [],
        );
      });
  } catch (error) {
    scope.postMessage(
      { type: 'error', id, message: error instanceof Error ? error.message : String(error) },
      [],
    );
  }
};

async function runEffect(
  request: EffectPreviewWorkerRequest['request'],
  source: Uint8ClampedArray,
): Promise<{ readonly result: Uint8ClampedArray; readonly backend: EffectPreviewBackend }> {
  const wasm = canUseWasmEffect(request) ? await loadWasmEffectsBeforeDeadline() : null;
  if (wasm) {
    try {
      const output = applyWasmEffect(
        wasm,
        request,
        new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
      );
      return { result: new Uint8ClampedArray(output), backend: 'wasm-effects' };
    } catch {
      // A corrupt or incompatible optional module never blocks the CPU reference.
    }
  }
  return { result: await cpuEffectProvider.apply(request, source), backend: 'cpu-effects' };
}
