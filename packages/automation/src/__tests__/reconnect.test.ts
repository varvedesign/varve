/**
 * A retry is most needed exactly when a connection was lost, so it arrives on a
 * new one. These check that idempotency follows the client, not the connection,
 * without ever crossing from one client to another.
 */
import { createDocument } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { createStandardCatalog } from '../commands';
import { Executor } from '../executor';
import { HeadlessAuthority } from '../headless';
import { AutomationHost, type HostConnection } from '../live';

const RECT = { kind: 'rect', x: 0, y: 0, width: 10, height: 10 };

function setup() {
  const authority = new HeadlessAuthority({
    document: createDocument('Reconnect'),
    instanceId: 'rc',
  });
  const host = new AutomationHost({
    authority,
    executor: new Executor({ catalog: createStandardCatalog() }),
    serverInfo: { name: 'reconnect', version: '0' },
    admit: async (request) =>
      request.credential === 'token-a' || request.credential === 'token-b'
        ? { grants: ['read', 'edit'], label: request.client.name, kind: 'agent' }
        : null,
  });
  const nodes = () => Object.keys(authority.getDocument().nodes).length;
  return { authority, host, nodes };
}

async function connect(host: AutomationHost, name: string, credential = 'token-a') {
  const opened = host.open({ transport: 'ipc' });
  if (!opened.ok) throw new Error(opened.message);
  const connection: HostConnection = opened.connection;
  const send = async (id: number, method: string, params: unknown) => {
    const line = await connection.handleLine(
      JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    );
    return line === null ? null : (JSON.parse(line) as Record<string, any>);
  };
  const hello = await send(0, 'session.hello', {
    credential,
    client: { name, version: '1' },
    protocolVersions: ['varve.control/1'],
  });
  const execute = (id: number, extra: Record<string, unknown>) =>
    send(id, 'command.execute', { command: 'varve.node.create', args: RECT, ...extra });
  return { connection, hello, execute };
}

describe('idempotency follows the client across a reconnect', () => {
  it('replays the original result to the same client on a new connection, without a second edit', async () => {
    const t = setup();
    const before = t.nodes();
    const first = await connect(t.host, 'agent');
    const original = await first.execute(1, { idempotencyKey: 'k1' });
    expect(original?.result.outcome).toBe('applied');
    first.connection.close(); // the reply was lost with the connection

    const second = await connect(t.host, 'agent');
    const retried = await second.execute(2, { idempotencyKey: 'k1', attempt: 2 });
    expect(retried?.result.idempotency).toMatchObject({ replayed: true });
    expect(retried?.result.created).toEqual(original?.result.created);
    expect(t.nodes()).toBe(before + 1);
  });

  it('still refuses the same key with a different request, across the reconnect', async () => {
    const t = setup();
    const first = await connect(t.host, 'agent');
    await first.execute(1, { idempotencyKey: 'k1' });
    first.connection.close();
    const second = await connect(t.host, 'agent');
    const changed = await second.connection
      .handleLine(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'command.execute',
          params: {
            command: 'varve.node.create',
            args: { ...RECT, width: 99 },
            idempotencyKey: 'k1',
          },
        }),
      )
      .then((line) => JSON.parse(line as string));
    expect(changed.result.error.code).toBe('IDEMPOTENCY_MISMATCH');
  });

  it("does not hand one client another client's result, even for the same key", async () => {
    const t = setup();
    const before = t.nodes();
    const a = await connect(t.host, 'agent-a');
    await a.execute(1, { idempotencyKey: 'shared-key' });
    const b = await connect(t.host, 'agent-b');
    // b did not make this request; a declared retry finds no record of b's own.
    const retried = await b.execute(2, { idempotencyKey: 'shared-key', attempt: 2 });
    expect(retried?.result.idempotency?.replayed).not.toBe(true);
    expect(retried?.result.outcome).not.toBe('applied');
    expect(t.nodes()).toBe(before + 1);
    // And b's first attempt with that key is its own edit.
    const own = await b.execute(3, { idempotencyKey: 'shared-key' });
    expect(own?.result.outcome).toBe('applied');
    expect(t.nodes()).toBe(before + 2);
  });

  it('keeps clients with different credentials apart even when they declare the same name', async () => {
    const t = setup();
    const before = t.nodes();
    const a = await connect(t.host, 'agent', 'token-a');
    await a.execute(1, { idempotencyKey: 'k' });
    const b = await connect(t.host, 'agent', 'token-b');
    const retried = await b.execute(2, { idempotencyKey: 'k', attempt: 2 });
    expect(retried?.result.idempotency?.replayed).not.toBe(true);
    expect(t.nodes()).toBe(before + 1);
  });

  it('still names the connection that wrote each change, so attribution is not blurred', async () => {
    const t = setup();
    const first = await connect(t.host, 'agent');
    const second = await connect(t.host, 'agent');
    expect(first.hello?.result.principal.id).not.toBe(second.hello?.result.principal.id);
    await first.execute(1, {});
    await second.execute(2, {});
    const history = t.authority.listTransactions(10);
    const writers = new Set(history.map((entry) => entry.origin.principalId));
    expect(writers.size).toBe(2);
  });
});
