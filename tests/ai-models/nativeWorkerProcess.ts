/** Audit transport only. The actual inference worker does preprocessing and
 * decoding; each native RPC runs the real Rust TensorSession via stdio.
 * It does not replace Tauri IPC in the app or synthesize model results. */
import type {
  WorkerInferRequest,
  WorkerInferResult,
  WorkerRequest,
  WorkerResponse,
} from '../../packages/engine/src/inference/inferenceWorker';
import type { NativeWorkerCall } from '../../packages/engine/src/inference/nativeWorkerRuntime';
import { NativeTensorProcess } from './nativeTensorProcess';

export interface AuditGraph {
  path: string;
  inputNames: string[];
  outputNames: string[];
}

export class NativeWorkerProcess {
  readonly calls: Array<{ model: string; provider: string | undefined }> = [];
  private readonly sessions = new Map<string, NativeTensorProcess>();
  private readonly pending = new Map<
    string,
    {
      resolve: (result: WorkerInferResult) => void;
      reject: (error: Error) => void;
    }
  >();
  private sequence = 0;
  readonly scope = {
    onmessage: null as ((event: MessageEvent<WorkerRequest>) => Promise<void>) | null,
    postMessage: (message: WorkerResponse) => {
      if (message.type === 'native-call') {
        void this.nativeCall(message).then(
          (result) => this.reply(message.callId, { result }),
          (error: unknown) => this.reply(message.callId, { error: String(error) }),
        );
      } else if (
        message.type === 'result' ||
        message.type === 'error' ||
        message.type === 'fatal'
      ) {
        const pending = this.pending.get(message.requestId);
        this.pending.delete(message.requestId);
        if (message.type === 'result') pending?.resolve(message);
        else pending?.reject(new Error(message.message));
      }
    },
  };

  constructor(
    private readonly binary: string,
    private readonly graphs: Record<string, AuditGraph>,
  ) {}

  private reply(callId: string, reply: { result?: unknown; error?: string }): void {
    void this.scope.onmessage?.({
      data: { type: 'native-reply', callId, ...reply },
    } as MessageEvent<WorkerRequest>);
  }

  private async nativeCall(call: NativeWorkerCall): Promise<unknown> {
    if (call.operation === 'open') {
      const graph = this.graphs[call.modelId];
      if (!graph || this.sessions.has(call.modelId)) throw new Error('Unexpected audit graph open');
      this.sessions.set(
        call.modelId,
        new NativeTensorProcess(this.binary, call.modelId, graph.path),
      );
      return {
        sessionId: call.modelId,
        modelId: call.modelId,
        ...graph,
        executionProvider: 'native-cpu',
      };
    }
    const session = this.sessions.get(call.sessionId);
    if (!session) throw new Error('Unknown native audit session');
    if (call.operation === 'release') {
      await session.close();
      this.sessions.delete(call.sessionId);
      return;
    }
    const reply = await session.run(call.tensors);
    this.calls.push({ model: call.modelId, provider: reply.context.executionProvider });
    return reply.tensors;
  }

  infer(request: Omit<WorkerInferRequest, 'requestId'>): Promise<WorkerInferResult> {
    if (!this.scope.onmessage) throw new Error('Production inference worker is not loaded');
    const requestId = `audit-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      void this.scope.onmessage!({
        data: { ...request, runtime: 'native', requestId },
      } as MessageEvent<WorkerRequest>).catch(reject);
    });
  }

  async close(): Promise<void> {
    await this.scope.onmessage?.({
      data: { type: 'release', requestId: 'audit-release' },
    } as MessageEvent<WorkerRequest>);
    await Promise.all([...this.sessions.values()].map((session) => session.close()));
    this.sessions.clear();
  }
}
