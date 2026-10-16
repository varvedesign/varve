/**
 * Cursor-chat framing.
 *
 * The defect these lock down: the composer broadcast one chat frame per
 * KEYSTROKE, and the host rate-limits finalized chat (0.5/s, burst 5). Typing
 * a normal message therefore spent the whole budget on drafts, and the frame
 * carrying the message the author pressed Enter on was dropped — silently, so
 * the author saw their input clear and nothing else. Drafts and finalized
 * messages now have separate budgets, the client coalesces drafts, and a
 * cancelled draft can actually be withdrawn (an empty final frame).
 */
import { describe, expect, it } from 'vitest';
import type { RoomOperation } from './protocol';
import { CollabSyncEngine, type CollabTimers, type CollabTransport } from './syncEngine';

/** Records frames and lets the test fire timers deterministically. */
class Harness {
  readonly frames: string[] = [];
  private readonly timers = new Map<number, () => void>();
  private nextHandle = 1;

  readonly transport: CollabTransport = {
    connect: () => {},
    send: (message) => this.send(JSON.stringify(message)),
    sendFrame: (text) => this.send(text),
    close: () => {},
    onOpen: () => {},
    onFrame: () => {},
    onDisconnect: () => {},
  };

  readonly timerImpl: CollabTimers = {
    setTimeout: (handler) => {
      const handle = this.nextHandle++;
      this.timers.set(handle, handler);
      return handle;
    },
    clearTimeout: (handle) => {
      this.timers.delete(handle as number);
    },
  };

  private send(text: string): boolean {
    this.frames.push(text);
    return true;
  }

  chatFrames(): Array<{ text: string; composing: boolean }> {
    return this.frames
      .map((frame) => JSON.parse(frame) as { type: string; message?: unknown })
      .filter((frame) => frame.type === 'chat')
      .map((frame) => {
        const message = frame.message as { text: string; composing: boolean };
        return { text: message.text, composing: message.composing };
      });
  }

  /** Run the queued timer callbacks (the engine keeps at most one draft timer). */
  fireTimers(): void {
    const pending = [...this.timers.entries()];
    this.timers.clear();
    for (const [, handler] of pending) handler();
  }
}

function makeEngine(harness: Harness): CollabSyncEngine {
  const engine = new CollabSyncEngine({
    roomUrl: 'ws://test/room/r',
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
    createTransport: () => harness.transport,
    timers: harness.timerImpl,
  });
  engine.start();
  return engine;
}

/** Put the engine live without a real host round-trip. */
function goLive(engine: CollabSyncEngine, harness: Harness): void {
  // A welcome frame is the only thing that makes the engine 'live'; the chat
  // path only needs that status, no actor identity is asserted here.
  const welcome = JSON.stringify({
    type: 'welcome',
    protocol: 1,
    roomSeq: 0,
    actorId: 'actor-1',
    role: 'editor',
    participants: [],
    snapshot: { uptoSeq: 0, documentJson: '{"id":"d"}' },
    sharedBaselineSeq: 0,
  });
  const handlers = harness.transport as unknown as {
    onFrame?: unknown;
  };
  void handlers;
  // The transport above ignores onFrame registration, so deliver through the
  // engine's own frame path by simulating an inbound message.
  (engine as unknown as { handleFrame(data: string): void }).handleFrame(welcome);
}

describe('cursor-chat framing', () => {
  it('coalesces keystrokes into one draft frame instead of one frame per key', () => {
    const harness = new Harness();
    const engine = makeEngine(harness);
    goLive(engine, harness);

    const typed = 'hello there';
    for (let index = 1; index <= typed.length; index++) {
      engine.sendChat(typed.slice(0, index), 'msg-1', true);
    }
    expect(harness.chatFrames()).toHaveLength(0); // nothing sent yet: coalesced

    harness.fireTimers();
    expect(harness.chatFrames()).toEqual([{ text: typed, composing: true }]);
  });

  it('sends the finalized message once, immediately, after the full draft', () => {
    const harness = new Harness();
    const engine = makeEngine(harness);
    goLive(engine, harness);

    for (const text of ['h', 'he', 'hel', 'hell', 'hello']) {
      engine.sendChat(text, 'msg-1', true);
    }
    harness.fireTimers(); // the draft went out
    engine.sendChat('hello world', 'msg-1', false); // Enter

    expect(harness.chatFrames()).toEqual([
      { text: 'hello', composing: true },
      { text: 'hello world', composing: false },
    ]);
    // The final frame is not queued behind a timer: it is already on the wire.
    harness.fireTimers();
    expect(harness.chatFrames()).toHaveLength(2);
  });

  it('withdraws a draft with an empty final frame and never sends the stale draft after it', () => {
    const harness = new Harness();
    const engine = makeEngine(harness);
    goLive(engine, harness);

    engine.sendChat('half-typed', 'msg-1', true);
    engine.sendChat('', 'msg-1', false); // Escape / blur
    harness.fireTimers(); // a queued draft must have been cancelled

    expect(harness.chatFrames()).toEqual([{ text: '', composing: false }]);
  });

  it('sends each finalized message immediately, under its own id', () => {
    const harness = new Harness();
    const engine = makeEngine(harness);
    goLive(engine, harness);

    // Two finalized messages under different ids (the composer mints a new id
    // per message) both go out.
    expect(engine.sendChat('first', 'msg-1', false)).toBe(true);
    expect(engine.sendChat('second', 'msg-2', false)).toBe(true);
    expect(harness.chatFrames()).toEqual([
      { text: 'first', composing: false },
      { text: 'second', composing: false },
    ]);
  });
});

describe('operation framing helpers', () => {
  it('an operation with an empty capture is not sent as a chunked upload', () => {
    // Regression guard: a capture with no changes must not produce a chunked
    // upload whose reassembled frame the host would reject.
    const op: RoomOperation = {
      clientOpId: 'op-empty',
      basedOnSeq: 0,
      actorId: 'a',
      actorName: 'T',
      transactionId: 'tx',
      label: 'noop',
      kind: 'modify',
      originAuthor: 'local-user',
      revertsClientOpId: null,
      capture: {
        transactionId: 'tx',
        changes: [],
        summary: { label: 'noop', affectedEntityIds: [], kind: 'modify' },
        beforeHash: 'a'.repeat(64),
        afterHash: 'b'.repeat(64),
      },
    };
    const harness = new Harness();
    const engine = makeEngine(harness);
    goLive(engine, harness);
    engine.submitOperation(op);
    const types = harness.frames.map((frame) => (JSON.parse(frame) as { type: string }).type);
    expect(types).toEqual(['operation']);
  });
});
