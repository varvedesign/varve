/**
 * Chunked operation uploads: an embedded image asset produces a capture above
 * the inline frame ceiling (the document's own inline-asset bound is 10 MB),
 * so the engine must frame it in chunks that the host can reassemble.
 *
 * The defect this locks down: an oversized inline operation frame used to be
 * closed on by the host, which stranded the editor in a reconnect loop with
 * the operation permanently unacknowledged.
 */

import { sha256Utf8 } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { planChunkedOperation, sliceByUtf8Bytes } from './chunkedOperation';
import type { RoomOperation } from './protocol';
import { PROTOCOL_LIMITS, utf8ByteLength } from './protocol';
import { CollabSyncEngine, type CollabTransport } from './syncEngine';

function makeAssetOperation(bytes: number, clientOpId = 'op-image-1'): RoomOperation {
  const dataUrl = `data:image/png;base64,${'A'.repeat(bytes)}`;
  return {
    clientOpId,
    basedOnSeq: 0,
    actorId: 'actor-1',
    actorName: 'Tester',
    transactionId: 'tx-1',
    label: 'Insert image',
    kind: 'modify',
    originAuthor: 'local-user',
    revertsClientOpId: null,
    capture: {
      transactionId: 'tx-1',
      changes: [
        {
          changeType: 'added',
          entityId: 'asset-1',
          entityType: 'asset',
          propertyPath: 'assets',
          after: {
            id: 'asset-1',
            storage: 'embedded',
            mimeType: 'image/png',
            dataUrl,
            naturalWidth: 1,
            naturalHeight: 1,
            byteLength: bytes,
            hash: 'deadbeef',
          },
          summary: 'Added image asset',
        },
      ],
      summary: { label: 'Insert image', affectedEntityIds: ['asset-1'], kind: 'modify' },
      beforeHash: 'a'.repeat(64),
      afterHash: 'b'.repeat(64),
    },
  };
}

class RecordingTransport implements CollabTransport {
  readonly frames: string[] = [];
  connected = true;
  connect(): void {}
  send(message: Parameters<CollabTransport['send']>[0]): boolean {
    return this.sendFrame(JSON.stringify(message));
  }
  sendFrame(text: string): boolean {
    if (!this.connected) return false;
    this.frames.push(text);
    return true;
  }
  close(): void {
    this.connected = false;
  }
  onOpen(): void {}
  onFrame(): void {}
  onDisconnect(): void {}
}

function engineWith(transport: CollabTransport): CollabSyncEngine {
  return new CollabSyncEngine({
    roomUrl: 'ws://127.0.0.1:1/room/r',
    inviteToken: 't',
    displayName: 'Tester',
    clientId: 'client-1',
    handlers: {
      applySnapshot: () => true,
      applyRemoteOperation: () => {},
      onRoster: () => {},
      onCursor: () => {},
      onSelection: () => {},
      onViewport: () => {},
      onChat: () => {},
      onNotice: () => {},
      onStatus: () => {},
    },
    createTransport: () => transport,
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
  });
}

describe('sliceByUtf8Bytes', () => {
  it('never exceeds the byte budget except for one indivisible code point', () => {
    // Escapes, not literals: the repo bans emoji glyphs in source
    // (`pnpm audit:emoji`). U+1F44D + U+1F3FD is the same two-code-point
    // sequence the surrogate-pair assertions below are about.
    const text = 'a漢字\u{1F44D}\u{1F3FD}b'.repeat(500);
    for (const max of [1, 2, 3, 4, 5, 7, 64, 1024]) {
      const parts = sliceByUtf8Bytes(text, max);
      // A single code point is the smallest unit that can be emitted, so the
      // guarantee is "at most `max` bytes, or one code point when it alone
      // exceeds the budget" (4 bytes is the largest code point).
      for (const part of parts) {
        expect(utf8ByteLength(part)).toBeLessThanOrEqual(Math.max(max, 4));
      }
      expect(parts.join('')).toBe(text);
    }
  });

  it('never splits a surrogate pair across a boundary', () => {
    const text = '\u{1F44D}\u{1F3FD}'.repeat(50);
    for (const part of sliceByUtf8Bytes(text, 4)) {
      expect(part).not.toMatch(/[\uD800-\uDBFF]$/);
      expect(part).not.toMatch(/^[\uDC00-\uDFFF]/);
    }
  });
});

describe('planChunkedOperation', () => {
  it('declares a digest over the exact frame bytes the host reassembles', () => {
    const frame = JSON.stringify({ type: 'operation', payload: 'x'.repeat(1_000_000) });
    const plan = planChunkedOperation(frame, 'upload-1');
    if (!plan.ok) throw new Error('plan must be ok');
    expect(plan.totalBytes).toBe(utf8ByteLength(frame));
    expect(plan.digest).toBe(sha256Utf8(frame));
    expect(plan.chunks.join('')).toBe(frame);
    expect(plan.chunkCount).toBe(plan.chunks.length);
    for (const chunk of plan.chunks) {
      expect(utf8ByteLength(chunk)).toBeLessThanOrEqual(PROTOCOL_LIMITS.maxUploadChunkBytes);
    }
  });

  it('refuses a frame beyond the host ceiling instead of truncating it', () => {
    const plan = planChunkedOperation('x'.repeat(1), 'upload-1');
    expect(plan.ok).toBe(true);
    const tooLarge = planChunkedOperation(
      JSON.stringify({ pad: 'x'.repeat(PROTOCOL_LIMITS.maxChunkedOperationBytes + 1) }),
      'upload-2',
    );
    expect(tooLarge).toEqual({ ok: false, reason: 'too-large', totalBytes: expect.any(Number) });
  });
});

describe('CollabSyncEngine operation framing', () => {
  it('sends a small operation inline', () => {
    const transport = new RecordingTransport();
    const engine = engineWith(transport);
    engine.start();
    engine.submitOperation(makeAssetOperation(16));
    const operationFrames = transport.frames.filter(
      (frame) => JSON.parse(frame).type === 'operation',
    );
    expect(operationFrames).toHaveLength(1);
  });

  it('chunks an image-sized operation and reassembles to the inline frame', () => {
    const transport = new RecordingTransport();
    const engine = engineWith(transport);
    engine.start();
    const op = makeAssetOperation(3_000_000);
    engine.submitOperation(op);

    const parsed = transport.frames.map((frame) => JSON.parse(frame) as { type: string });
    const beginIndex = parsed.findIndex((frame) => frame.type === 'operation-begin');
    expect(beginIndex).toBeGreaterThanOrEqual(0);
    const upload = parsed.slice(beginIndex);
    expect(upload.at(-1)!.type).toBe('operation-end');
    const chunkFrames = upload.filter((frame) => frame.type === 'operation-chunk');
    expect(chunkFrames.length).toBeGreaterThan(1);

    const begin = upload[0] as unknown as {
      uploadId: string;
      totalBytes: number;
      chunkCount: number;
      digest: string;
    };
    expect(begin.chunkCount).toBe(chunkFrames.length);
    const reassembled = (upload as Array<{ type: string; data?: string }>)
      .filter((frame) => frame.type === 'operation-chunk')
      .map((frame) => frame.data ?? '')
      .join('');
    expect(utf8ByteLength(reassembled)).toBe(begin.totalBytes);
    expect(sha256Utf8(reassembled)).toBe(begin.digest);
    const reassembledOp = (JSON.parse(reassembled) as { op: RoomOperation }).op;
    expect(reassembledOp.clientOpId).toBe(op.clientOpId);
    expect(reassembledOp.capture.changes[0]!.after).toEqual(
      op.capture.changes[0]!.after as unknown,
    );
  });

  it('keeps a pending large operation recoverable and reports an unshareable one', () => {
    const transport = new RecordingTransport();
    const notices: string[] = [];
    const engine = new CollabSyncEngine({
      roomUrl: 'ws://127.0.0.1:1/room/r',
      inviteToken: 't',
      displayName: 'Tester',
      clientId: 'client-1',
      handlers: {
        applySnapshot: () => true,
        applyRemoteOperation: () => {},
        onRoster: () => {},
        onCursor: () => {},
        onSelection: () => {},
        onViewport: () => {},
        onChat: () => {},
        onNotice: (notice) => notices.push(notice.message),
        onStatus: () => {},
      },
      createTransport: () => transport,
      timers: { setTimeout: () => 0, clearTimeout: () => {} },
    });
    engine.start();
    const op = makeAssetOperation(1_000, 'op-small');
    engine.submitOperation(op);
    expect(engine.isPending(op.clientOpId)).toBe(true);

    // A frame the host will never accept is refused with a notice and is NOT
    // left pending forever.
    const huge = makeAssetOperation(PROTOCOL_LIMITS.maxChunkedOperationBytes + 1_000, 'op-huge');
    expect(engine.submitOperation(huge)).toBe(false);
    expect(engine.isPending(huge.clientOpId)).toBe(false);
    expect(notices.some((message) => /too large to share/i.test(message))).toBe(true);
  });
});
