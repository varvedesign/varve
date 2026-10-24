import { invoke } from '@tauri-apps/api/core';
import { SessionCleanupFailedError } from './core/sessionCreation';
import { decodeNativeTensors, encodeNativeTensors } from './nativeTensorWire';
import type { NativeSessionInfo, NativeWorkerCall, NativeWorkerReply } from './nativeWorkerRuntime';

/** Main-thread Tauri transport for the worker. It outlives worker termination:
 * killing JavaScript cannot terminate native computations or free native ORT. */
export class NativeWorkerBridge {
  private sessions = new Map<string, string>();
  private pending = new Set<Promise<void>>();
  private activeRequests = new Set<string>();
  private retired = false;
  private releases = new Map<string, Promise<void>>();

  get sessionCount(): number {
    return this.sessions.size;
  }

  isExecuting(requestId: string): boolean {
    return this.activeRequests.has(requestId);
  }

  handle(
    message: NativeWorkerCall,
    reply: (message: NativeWorkerReply) => void,
    admitted: () => boolean,
  ): void {
    const operation = this.execute(message, admitted).then(
      (result) => reply({ type: 'native-reply', callId: message.callId, result }),
      (error: unknown) =>
        reply({
          type: 'native-reply',
          callId: message.callId,
          error: error instanceof Error ? error.message : String(error),
          fatal: error instanceof SessionCleanupFailedError,
        }),
    );
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => {});
  }

  cancel(requestId: string): void {
    // Failure to request cancellation does not release any ownership. The
    // native operation remains in pending until its invoke actually settles.
    void invoke('cancel_native_tensor_inference', { requestId }).catch(() => {});
  }

  private async execute(message: NativeWorkerCall, admitted: () => boolean): Promise<unknown> {
    if (this.retired) throw new Error('Native inference worker is retired');
    if (message.operation === 'release') return this.release(message.sessionId);
    if (!admitted()) throw new Error('Inference cancelled');
    if (this.activeRequests.has(message.requestId))
      throw new Error('Native request is already executing');
    this.activeRequests.add(message.requestId);
    try {
      if (message.operation === 'open') {
        const info = await invoke<NativeSessionInfo>('open_native_tensor_session', {
          requestId: message.requestId,
          modelId: message.modelId,
        });
        this.sessions.set(info.sessionId, info.modelId);
        if (
          info.modelId !== message.modelId ||
          info.executionProvider !== 'native-cpu' ||
          this.retired ||
          !admitted()
        ) {
          try {
            await this.release(info.sessionId);
          } catch (error) {
            throw new SessionCleanupFailedError(
              'Native session completed after cancellation and could not be released.',
              { cause: error },
            );
          }
          throw new Error('Native model identity changed or inference was cancelled');
        }
        return info;
      }
      if (this.sessions.get(message.sessionId) !== message.modelId)
        throw new Error('Native model/session identity mismatch');
      const context = {
        requestId: message.requestId,
        modelId: message.modelId,
        sessionId: message.sessionId,
      };
      const packet = encodeNativeTensors(context, message.tensors);
      const response = await invoke<ArrayBuffer | number[]>('run_native_tensor_session', packet);
      const decoded = decodeNativeTensors(response);
      if (
        decoded.context.modelId !== context.modelId ||
        decoded.context.requestId !== context.requestId ||
        decoded.context.sessionId !== context.sessionId ||
        decoded.context.executionProvider !== 'native-cpu'
      ) {
        throw new Error('Native inference result identity mismatch');
      }
      if (this.retired || !admitted()) throw new Error('Inference cancelled');
      return decoded.tensors;
    } finally {
      this.activeRequests.delete(message.requestId);
    }
  }

  private release(sessionId: string): Promise<void> {
    const pending = this.releases.get(sessionId);
    if (pending) return pending;
    if (!this.sessions.has(sessionId))
      return Promise.reject(new Error('Native session is not owned by this worker'));
    const release = invoke('release_native_tensor_session', { sessionId })
      .then(() => {
        this.sessions.delete(sessionId);
      })
      .finally(() => this.releases.delete(sessionId));
    this.releases.set(sessionId, release);
    return release;
  }

  async retire(): Promise<void> {
    this.retired = true;
    for (const requestId of this.activeRequests) this.cancel(requestId);
    await Promise.allSettled([...this.pending]);
    const results = await Promise.allSettled(
      [...this.sessions.keys()].map((id) => this.release(id)),
    );
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected')
      throw new Error(`Native session cleanup failed: ${String(failure.reason)}`);
  }
}
