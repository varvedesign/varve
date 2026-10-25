/** Audit-only transport to the production Rust TensorSession implementation.
 * Never replaces inference in the application and never synthesizes outputs. */
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { once } from 'node:events';
import type { WorkerTensor } from '../../packages/engine/src/inference/inferenceWorker';
import {
  decodeNativeTensors,
  encodeNativeTensors,
} from '../../packages/engine/src/inference/nativeTensorWire';

export class NativeTensorProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private header = Buffer.alloc(4);
  private packet: Buffer | null = null;
  private offset = 0;
  private diagnostic = '';
  private pending: { resolve: (packet: Buffer) => void; reject: (error: Error) => void } | null =
    null;
  private sequence = 0;

  constructor(
    binary: string,
    readonly modelId: string,
    path: string,
  ) {
    this.child = spawn(binary, [path], { stdio: 'pipe' });
    this.child.stderr.on('data', (data: Buffer) => {
      this.diagnostic = (this.diagnostic + data.toString()).slice(-8000);
    });
    this.child.on('error', (error) => this.pending?.reject(error));
    this.child.on('close', (code) =>
      this.pending?.reject(new Error(`${modelId} exited (${code}): ${this.diagnostic}`)),
    );
    this.child.stdout.on('data', (data: Buffer) => this.receive(data));
  }

  private receive(chunk: Buffer): void {
    let consumed = 0;
    while (consumed < chunk.length) {
      const target = this.packet ?? this.header;
      const count = Math.min(target.length - this.offset, chunk.length - consumed);
      chunk.copy(target, this.offset, consumed, consumed + count);
      consumed += count;
      this.offset += count;
      if (this.offset !== target.length) continue;
      this.offset = 0;
      if (!this.packet) {
        const length = this.header.readUInt32LE();
        if (length < 8 || length > 256 * 1024 * 1024) {
          this.pending?.reject(new Error('Invalid native audit packet length'));
          this.child.kill();
          return;
        }
        this.packet = Buffer.allocUnsafe(length);
      } else {
        const packet = this.packet;
        this.packet = null;
        this.pending?.resolve(packet);
        this.pending = null;
      }
    }
  }

  async run(tensors: Record<string, WorkerTensor>, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.pending) throw new Error('Native audit process already executing');
    const context = {
      requestId: `${++this.sequence}`,
      sessionId: this.modelId,
      modelId: this.modelId,
    };
    const packet = encodeNativeTensors(context, tensors);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(packet.length);
    const abort = () => this.child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 120_000);
    try {
      const reply = await new Promise<Buffer>((resolve, reject) => {
        this.pending = { resolve, reject };
        this.child.stdin.write(length);
        this.child.stdin.write(packet, (error) => {
          if (error) reject(error);
        });
      });
      const decoded = decodeNativeTensors(Uint8Array.from(reply).buffer);
      if (
        decoded.context.modelId !== this.modelId ||
        decoded.context.requestId !== context.requestId
      ) {
        throw new Error('Native audit identity mismatch');
      }
      signal?.throwIfAborted();
      return decoded;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  async close(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const exited = once(this.child, 'close');
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 5000);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
  }
}
