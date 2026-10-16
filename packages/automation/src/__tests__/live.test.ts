import { createDocument, type Document } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import type { Availability, CommitInput, CommitResult, TransactionRecord } from '../authority';
import { createStandardCatalog } from '../commands';
import { Executor } from '../executor';
import { LiveAuthority, type LiveEditorPort, type LiveTargetInfo } from '../live/authority';
import { AutomationHost } from '../live/host';
import type { AuthorizationClass } from '../principal';

/**
 * A stand-in for the editor: it owns the document, the revision and the undo
 * stack, exactly as the real editor port must. Tests use it to make the
 * editor's half of the contract falsifiable — including the two behaviours a
 * real editor can exhibit and a naive authority would miss: a person editing
 * between the check and the install, and a revision that fails to advance.
 */
class FakeEditor implements LiveEditorPort {
  doc: Document;
  rev = 0;
  readonly undo: { label: string; origin: string }[] = [];
  installs = 0;
  statusValue: Availability = { ok: true };
  identity: LiveTargetInfo;
  /**
   * Run once at the start of the next `install`, simulating a person whose
   * keystroke lands after the executor read the revision.
   */
  interleave: (() => void) | null = null;
  /** Simulate an editor that accepts a document without advancing its revision. */
  freezeRevision = false;

  constructor(doc: Document) {
    this.doc = doc;
    this.identity = {
      instanceId: 'app-instance',
      generation: 'gen-1',
      documentId: doc.id,
      documentName: doc.name,
    };
  }

  info(): LiveTargetInfo {
    return this.identity;
  }

  revision(): number {
    return this.rev;
  }

  status(): Availability {
    return this.statusValue;
  }

  document(): Document {
    return this.doc;
  }

  install(input: CommitInput): CommitResult {
    const interleaved = this.interleave;
    this.interleave = null;
    interleaved?.();
    if (input.baseRevision !== this.rev) {
      return { ok: false, reason: 'revision-conflict', currentRevision: this.rev };
    }
    this.doc = input.plan.doc;
    if (!this.freezeRevision) this.rev += 1;
    this.installs += 1;
    this.undo.push({ label: input.plan.label, origin: input.origin.kind });
    return { ok: true, revision: this.rev, transactionId: `undo-${this.installs}` };
  }
}

/** A person editing the live document: one undo step, one new revision. */
function personEdit(editor: FakeEditor, next: Document, label = 'Person edit'): void {
  editor.doc = next;
  editor.rev += 1;
  editor.undo.push({ label, origin: 'user' });
}

function withNodeOpacity(doc: Document, nodeId: string, opacity: number): Document {
  const node = doc.nodes[nodeId];
  if (!node) throw new Error(`no node ${nodeId}`);
  return { ...doc, nodes: { ...doc.nodes, [nodeId]: { ...node, opacity } } };
}

/** Valid `varve.node.create` arguments; the rect variant requires all four. */
function rect(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: 'rect', x: 0, y: 0, width: 100, height: 50, ...overrides };
}

function liveSetup(document?: Document) {
  const editor = new FakeEditor(document ?? createDocument('Live'));
  const authority = new LiveAuthority({ port: editor });
  const executor = new Executor({ catalog: createStandardCatalog() });
  let tick = 0;
  const ctx = {
    principal: {
      id: 'client:1',
      kind: 'agent' as const,
      label: 'Test agent',
      transport: 'ipc' as const,
      grants: ['read', 'edit', 'view', 'capture', 'export', 'external'] as AuthorizationClass[],
    },
    authority,
    rng: () => {
      tick += 1;
      return `id${tick.toString(16).padStart(10, '0')}`;
    },
  };
  return {
    editor,
    authority,
    executor,
    ctx,
    run: (command: string, args?: unknown, extra?: Record<string, unknown>) =>
      executor.execute(ctx, { command, args, ...extra }),
    transactions: (limit?: number): TransactionRecord[] => authority.listTransactions(limit),
  };
}

function frame(id: number, method: string, params?: unknown): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    ...(params !== undefined ? { params } : {}),
  });
}

async function hostSetup(
  options: {
    grants?: readonly AuthorizationClass[];
    document?: Document;
    maxConnections?: number;
  } = {},
) {
  const session = liveSetup(options.document);
  const host = new AutomationHost({
    authority: session.authority,
    executor: session.executor,
    serverInfo: { name: 'varve', version: 'test' },
    maxConnections: options.maxConnections ?? 8,
    admit: (request) =>
      request.credential === 'good-token'
        ? {
            grants: options.grants ?? ['read', 'edit'],
            label: `Client ${request.connectionId}`,
            kind: 'agent' as const,
          }
        : null,
  });
  const openOrThrow = () => {
    const result = host.open({ transport: 'ipc' });
    if (!result.ok) throw new Error(`open failed: ${result.message}`);
    return result.connection;
  };
  const hello = async (connection: ReturnType<typeof openOrThrow>, credential = 'good-token') =>
    JSON.parse(
      (await connection.handleLine(
        frame(1, 'session.hello', {
          credential,
          client: { name: 'test-client', version: '1' },
          protocolVersions: ['varve.control/1'],
        }),
      )) as string,
    );
  return { ...session, host, open: openOrThrow, hello };
}

describe('live authority', () => {
  it('reports connected identity from the editor, not an invented one', () => {
    const { authority, editor } = liveSetup();
    expect(authority.info()).toEqual({
      mode: 'connected',
      instanceId: 'app-instance',
      generation: 'gen-1',
      documentId: editor.doc.id,
      documentName: 'Live',
    });
  });

  it('installs a command through the editor as exactly one undo step', async () => {
    const { run, editor } = liveSetup();
    const before = editor.undo.length;
    const receipt = await run('varve.node.create', rect({ name: 'Agent rect' }));
    expect(receipt.error).toBeUndefined();
    expect(receipt.outcome).toBe('applied');
    expect(editor.installs).toBe(1);
    // One command, one undo entry, labelled the way the person will read it.
    expect(editor.undo.length).toBe(before + 1);
    expect(editor.undo.at(-1)?.label).toBe('Create rect');
    expect(editor.undo.at(-1)?.origin).toBe('agent');
    expect(Object.keys(editor.doc.nodes)).toContain(receipt.created[0]);
    expect(receipt.revision).toEqual({ before: 0, after: 1 });
  });

  it('refuses when the person edited between the plan and the install', async () => {
    const { run, editor } = liveSetup();
    editor.interleave = () => {
      personEdit(editor, { ...editor.doc, name: 'Person was typing' }, 'Typing');
    };
    const receipt = await run('varve.node.create', rect());
    expect(receipt.outcome).toBe('rejected');
    expect(receipt.error?.code).toBe('REVISION_CONFLICT');
    // The person's work survived and nothing of the agent's landed.
    expect(editor.doc.name).toBe('Person was typing');
    expect(Object.keys(editor.doc.nodes)).toHaveLength(1);
    expect(editor.installs).toBe(0);
  });

  it('refuses a stale expectedRevision instead of overwriting newer work', async () => {
    const { run, editor } = liveSetup();
    const stale = editor.rev;
    personEdit(editor, { ...editor.doc, name: 'Moved on' });
    const receipt = await run('varve.node.create', rect(), { expectedRevision: stale });
    expect(receipt.outcome).toBe('rejected');
    expect(receipt.error?.code).toBe('REVISION_CONFLICT');
    expect(editor.doc.name).toBe('Moved on');
    expect(editor.installs).toBe(0);
  });

  it('accepts a fresh expectedRevision so a careful caller is not punished', async () => {
    const { run, editor } = liveSetup();
    const receipt = await run('varve.node.create', rect(), { expectedRevision: editor.rev });
    expect(receipt.outcome).toBe('applied');
  });

  it('never retargets a session whose document was replaced', async () => {
    const { run, editor } = liveSetup();
    const other = createDocument('Something else');
    editor.identity = { ...editor.identity, documentId: other.id, documentName: other.name };
    editor.doc = other;

    const receipt = await run('varve.node.create', rect());
    expect(receipt.outcome).toBe('rejected');
    expect(receipt.error?.code).toBe('UNAVAILABLE');
    // The other document is untouched: no silent fallback, no cross-document edit.
    expect(Object.keys(other.nodes)).toHaveLength(1);
    expect(editor.installs).toBe(0);
  });

  it('refuses a replaced generation even for a read', async () => {
    const { run, editor } = liveSetup();
    editor.identity = { ...editor.identity, generation: 'gen-2' };
    const availability = await run('varve.document.info');
    expect(availability.outcome).toBe('rejected');
    expect(availability.error?.code).toBe('UNAVAILABLE');
  });

  it('separates a caller target pin from a dead session', async () => {
    const { run } = liveSetup();
    const wrongDocument = await run('varve.document.info', undefined, {
      target: { documentId: 'not-this-document' },
    });
    expect(wrongDocument.error?.code).toBe('TARGET_MISMATCH');
    const wrongInstance = await run('varve.document.info', undefined, {
      target: { instanceId: 'some-other-window' },
    });
    expect(wrongInstance.error?.code).toBe('TARGET_MISMATCH');
  });

  it('propagates an editor that cannot serve the session at all', async () => {
    const { run, editor } = liveSetup();
    editor.statusValue = { ok: false, code: 'UNAVAILABLE', message: 'the window was closed' };
    const receipt = await run('varve.document.info');
    expect(receipt.outcome).toBe('rejected');
    expect(receipt.error?.code).toBe('UNAVAILABLE');
    expect(receipt.error?.message).toBe('the window was closed');
  });

  it('reports a non-advancing revision instead of claiming success', async () => {
    const { run, editor } = liveSetup();
    editor.freezeRevision = true;
    const receipt = await run('varve.node.create', rect());
    expect(receipt.outcome).toBe('rejected');
    // An editor contract violation is not a target mismatch: the client did
    // nothing wrong and must not be told to re-attach.
    expect(receipt.error?.code).toBe('INVARIANT_VIOLATION');
    expect(receipt.error?.message).toContain('without advancing its revision');
  });

  it('rolls back one agent transaction without erasing a person’s later work', async () => {
    const session = liveSetup();
    const create = await session.run('varve.node.create', rect({ name: 'Agent rect' }));
    const agentNode = create.created[0] as string;
    const second = await session.run('varve.node.create', rect({ name: 'Later agent rect' }));
    const laterNode = second.created[0] as string;
    expect(create.transactionId).toBeTruthy();

    // The person tweaks the *other* node after the agent's first edit.
    personEdit(session.editor, withNodeOpacity(session.editor.doc, laterNode, 0.5));
    const undoBefore = session.editor.undo.length;

    const rollback = await session.run('varve.history.rollback', {
      transactionId: create.transactionId,
    });
    expect(rollback.error).toBeUndefined();
    expect(rollback.outcome).toBe('applied');
    // The agent's node is gone, the person's edit is intact...
    expect(Object.keys(session.editor.doc.nodes)).not.toContain(agentNode);
    expect(session.editor.doc.nodes[laterNode]?.opacity).toBe(0.5);
    // ...and the rollback is a new step on top of history, never a pop.
    expect(session.editor.undo.length).toBe(undoBefore + 1);
    expect(session.transactions()[0]?.revertsTransactionId).toBe(create.transactionId);
  });

  it('refuses a rollback that would erase work on the same node', async () => {
    const session = liveSetup();
    const create = await session.run('varve.node.create', rect());
    const nodeId = create.created[0] as string;
    const set = await session.run('varve.node.set', { nodeIds: [nodeId], opacity: 0.25 });
    expect(set.outcome).toBe('applied');
    expect(set.transactionId).toBeTruthy();

    personEdit(session.editor, withNodeOpacity(session.editor.doc, nodeId, 0.9), 'Person opacity');
    const undoBefore = session.editor.undo.length;

    const rollback = await session.run('varve.history.rollback', {
      transactionId: set.transactionId,
    });
    expect(rollback.outcome).toBe('rejected');
    expect(rollback.error?.code).toBe('CONFLICT');
    expect(session.editor.doc.nodes[nodeId]?.opacity).toBe(0.9);
    expect(session.editor.undo.length).toBe(undoBefore);
  });

  it('rejects unknown arguments before the editor sees anything', async () => {
    const { run, editor } = liveSetup();
    const receipt = await run('varve.node.create', rect({ kerning: 4 }));
    expect(receipt.outcome).toBe('rejected');
    expect(receipt.error?.code).toBe('INVALID_ARGUMENT');
    expect(editor.installs).toBe(0);
  });

  it('reports the ids a transaction touched, so an agent can find its own work again', async () => {
    const session = liveSetup();
    const create = await session.run('varve.node.create', rect());
    const nodeId = create.created[0] as string;
    const history = await session.run('varve.history.list');
    const entry = (history.output as { transactions: { created?: string[] }[] }).transactions[0];
    // Without these an agent that lost its receipt can see that something
    // happened but cannot name the transaction to roll back.
    expect(entry?.created).toEqual([nodeId]);
  });

  it('filters history by subject to answer "who changed this layer"', async () => {
    const session = liveSetup();
    const first = await session.run('varve.node.create', rect({ name: 'Kept' }));
    const second = await session.run('varve.node.create', rect({ name: 'Noise' }));
    const kept = first.created[0] as string;
    const noise = second.created[0] as string;

    const filtered = await session.run('varve.history.list', { subject: kept });
    const rows = (filtered.output as { transactions: { created?: string[] }[] }).transactions;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.created).toEqual([kept]);

    const unrelated = await session.run('varve.history.list', { subject: 'does-not-exist' });
    expect((unrelated.output as { transactions: unknown[] }).transactions).toHaveLength(0);
    // The noise node is still reported when asked for directly.
    const direct = await session.run('varve.history.list', { subject: noise });
    const directRows = (direct.output as { transactions: { created?: string[] }[] }).transactions;
    expect(directRows).toHaveLength(1);
    expect(directRows[0]?.created).toEqual([noise]);
  });
});

describe('automation host', () => {
  it('mints one principal per connection, so receipts name the writer', async () => {
    const { open, hello, run } = await hostSetup();
    const first = open();
    const second = open();
    const a = await hello(first);
    const b = await hello(second);
    expect(a.result.principal.id).not.toBe(b.result.principal.id);
    expect(a.result.session.mode).toBe('connected');
    expect(a.result.catalog.commands).toBeGreaterThan(0);

    const created = JSON.parse(
      (await first.handleLine(
        frame(2, 'command.execute', { command: 'varve.node.create', args: rect() }),
      )) as string,
    );
    expect(created.result.outcome).toBe('applied');

    const history = await run('varve.history.list');
    expect(history.outcome).toBe('ok');
    const transactions = (history.output as { transactions: TransactionRecord[] }).transactions;
    expect(transactions[0]?.origin.principalId).toBe(a.result.principal.id);
    expect(transactions[0]?.origin.transport).toBe('ipc');
  });

  it('admits a read-only client that cannot mutate, through the real control channel', async () => {
    const { open, hello } = await hostSetup({ grants: ['read'] });
    const connection = open();
    await hello(connection);
    const created = JSON.parse(
      (await connection.handleLine(
        frame(2, 'command.execute', { command: 'varve.node.create', args: rect() }),
      )) as string,
    );
    expect(created.result.outcome).toBe('rejected');
    expect(created.result.error.code).toBe('PERMISSION_DENIED');
    const read = JSON.parse(
      (await connection.handleLine(
        frame(3, 'command.execute', { command: 'varve.document.info' }),
      )) as string,
    );
    expect(read.result.outcome).toBe('ok');
  });

  it('refuses a bad credential without saying whether the token exists', async () => {
    const { open, hello } = await hostSetup();
    const refused = await hello(open(), 'wrong-token');
    expect(refused.error.code).toBe(-32001);
    expect(refused.error.message).toBe('credential refused');
  });

  it('pausing blocks commits while reads keep working and say why', async () => {
    const { open, hello, host } = await hostSetup();
    const connection = open();
    await hello(connection);
    const applied = JSON.parse(
      (await connection.handleLine(
        frame(2, 'command.execute', { command: 'varve.node.create', args: rect() }),
      )) as string,
    );
    expect(applied.result.outcome).toBe('applied');

    host.pause('automation was stopped in Varve');
    const blocked = JSON.parse(
      (await connection.handleLine(
        frame(3, 'command.execute', { command: 'varve.node.create', args: rect() }),
      )) as string,
    );
    expect(blocked.result.outcome).toBe('rejected');
    expect(blocked.result.error.code).toBe('UNAVAILABLE');
    expect(blocked.result.error.message).toContain('automation was stopped in Varve');

    const stillReadable = JSON.parse(
      (await connection.handleLine(
        frame(4, 'command.execute', { command: 'varve.document.info' }),
      )) as string,
    );
    expect(stillReadable.result.outcome).toBe('ok');

    host.resume();
    const allowed = JSON.parse(
      (await connection.handleLine(
        frame(5, 'command.execute', { command: 'varve.node.create', args: rect() }),
      )) as string,
    );
    expect(allowed.result.outcome).toBe('applied');
  });

  it('pausing does not undo work that was already committed', async () => {
    const { open, hello, host, editor } = await hostSetup();
    const connection = open();
    await hello(connection);
    await connection.handleLine(
      frame(2, 'command.execute', { command: 'varve.node.create', args: rect() }),
    );
    const nodesAfter = Object.keys(editor.doc.nodes).length;
    host.pause();
    expect(Object.keys(editor.doc.nodes)).toHaveLength(nodesAfter);
    expect(editor.undo.at(-1)?.origin).toBe('agent');
  });

  it('revoking a client closes its connections and refuses its credential', async () => {
    const { open, hello, host, editor } = await hostSetup();
    const doomed = open();
    const kept = open();
    const doomedSession = await hello(doomed);
    await hello(kept);
    const revokedId = doomedSession.result.principal.id as string;
    // The key is what a surface offers to re-admit, and what makes the refusal
    // outlive the connection.
    const clientKey = host.status().connections.find((c) => c.principalId === revokedId)?.clientKey;
    expect(clientKey).toBeTruthy();

    expect(host.revoke(revokedId)).toBe(1);
    expect(doomed.shouldClose).toBe(true);
    const nodesBefore = Object.keys(editor.doc.nodes).length;
    expect(
      await doomed.handleLine(
        frame(9, 'command.execute', { command: 'varve.node.create', args: rect() }),
      ),
    ).toBeNull();
    expect(Object.keys(editor.doc.nodes)).toHaveLength(nodesBefore);
    expect(host.revokedClients()).toEqual([clientKey]);

    // The claim under test: a client that already holds the credential cannot
    // simply reconnect as a new principal and carry on.
    const reconnected = open();
    const refused = await hello(reconnected);
    expect(refused.error?.code).toBe(-32001);
    expect(refused.error?.message).toBe('credential refused');

    // And a re-admission is a decision a person can make, not a one-way door.
    expect(host.clearRevocation(clientKey as string)).toBe(true);
    const readmitted = open();
    const admitted = await hello(readmitted);
    expect(admitted.result?.principal?.id).toBeTruthy();

    // The client that was never revoked was never disturbed.
    expect(kept.shouldClose).toBe(false);
    const stillWorks = JSON.parse(
      (await kept.handleLine(
        frame(10, 'command.execute', { command: 'varve.node.create', args: rect() }),
      )) as string,
    );
    expect(stillWorks.result.outcome).toBe('applied');
  });

  it('caps concurrent connections rather than accepting an unbounded number', async () => {
    const { host } = await hostSetup({ maxConnections: 2 });
    expect(host.open({ transport: 'ipc' }).ok).toBe(true);
    expect(host.open({ transport: 'ipc' }).ok).toBe(true);
    const third = host.open({ transport: 'ipc' });
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.reason).toBe('full');
      expect(third.message).toContain('2 connections');
    }
  });

  it('stops accepting connections without disturbing the ones already open', async () => {
    const { open, hello, host } = await hostSetup();
    const existing = open();
    await hello(existing);
    host.stopAccepting();
    expect(host.open({ transport: 'ipc' }).ok).toBe(false);
    const stillWorks = JSON.parse(
      (await existing.handleLine(
        frame(2, 'command.execute', { command: 'varve.document.info' }),
      )) as string,
    );
    expect(stillWorks.result.outcome).toBe('ok');
  });

  it('reports connection and policy state for the settings surface', async () => {
    const { open, hello, host } = await hostSetup();
    const connection = open();
    await hello(connection);
    const status = host.status();
    expect(status.protocol).toBe('varve.control/1');
    expect(status.paused).toBe(false);
    expect(status.connections).toHaveLength(1);
    expect(status.connections[0]?.principalId).toBeTruthy();
    expect(status.connections[0]?.client?.name).toBe('test-client');
    expect(status.connections[0]?.transport).toBe('ipc');
    connection.close();
    expect(host.status().connections).toHaveLength(0);
  });

  it('notifies a status listener and drops closed connections', async () => {
    const { open, host } = await hostSetup();
    const seen: number[] = [];
    const unsubscribe = host.onChange((status) => seen.push(status.connections.length));
    const connection = open();
    host.closeAll();
    unsubscribe();
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.at(-1)).toBe(0);
    expect(connection.shouldClose).toBe(true);
  });

  it('ignores a notification instead of running unconfirmed work', async () => {
    const { open, hello, editor } = await hostSetup();
    const connection = open();
    await hello(connection);
    const before = Object.keys(editor.doc.nodes).length;
    const response = await connection.handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'command.execute',
        params: { command: 'varve.node.create', args: rect() },
      }),
    );
    expect(response).toBeNull();
    expect(Object.keys(editor.doc.nodes)).toHaveLength(before);
  });
});
