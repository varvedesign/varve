import { createDocument } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { createStandardCatalog } from '../commands';
import { Executor } from '../executor';
import { HeadlessAuthority } from '../headless';
import { AutomationHost, createFrameRelay } from '../live';

function setup(maxConnections = 4, closeTransport?: (connectionId: string) => void) {
  const authority = new HeadlessAuthority({ document: createDocument('Relay'), instanceId: 'r' });
  const host = new AutomationHost({
    authority,
    executor: new Executor({ catalog: createStandardCatalog() }),
    serverInfo: { name: 'relay-test', version: '0' },
    admit: async (request) =>
      request.credential === 'ok'
        ? { grants: ['read', 'edit'], label: 'tester', kind: 'agent' }
        : null,
    maxConnections,
  });
  const relay = createFrameRelay(host, closeTransport ? { closeTransport } : {});
  const hello = JSON.stringify({
    jsonrpc: '2.0',
    id: 0,
    method: 'session.hello',
    params: {
      credential: 'ok',
      client: { name: 'c', version: '1' },
      protocolVersions: ['varve.control/1'],
    },
  });
  const info = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'command.execute',
    params: { command: 'varve.document.info', args: {} },
  });
  return { authority, host, relay, hello, info };
}

describe('createFrameRelay', () => {
  it('opens a host connection on first sight of a transport connection and reuses it', async () => {
    const t = setup();
    expect(t.relay.open).toBe(0);
    const first = await t.relay.frame('c1', t.hello);
    expect(first.closeAfter).toBe(false);
    expect(JSON.parse(first.frame as string).result.session).toBeDefined();
    expect(t.relay.open).toBe(1);
    const second = await t.relay.frame('c1', t.info);
    expect(JSON.parse(second.frame as string).result.outcome).toBe('ok');
    expect(t.relay.open).toBe(1);
    // A different transport connection is a different protocol session: it has
    // not said hello, so the first connection's handshake does not carry over,
    // and the protocol ends it.
    const other = await t.relay.frame('c2', t.info);
    expect(JSON.parse(other.frame as string).error).toBeDefined();
    expect(other.closeAfter).toBe(true);
    expect(t.relay.open).toBe(1);
  });

  it('tells the transport to close when the protocol ends the session, and lets go of it', async () => {
    const t = setup();
    const refused = await t.relay.frame('c1', t.info); // no hello
    expect(refused.closeAfter).toBe(true);
    expect(t.relay.open).toBe(0);
  });

  it('answers "close" and writes nothing when the host is full', async () => {
    const t = setup(1);
    await t.relay.frame('c1', t.hello);
    const full = await t.relay.frame('c2', t.hello);
    expect(full).toEqual({ frame: null, closeAfter: true });
    expect(t.relay.open).toBe(1);
  });

  it("uses the protocol's own wording for each transport-level refusal, then closes", async () => {
    for (const kind of ['frame-too-large', 'invalid-utf8', 'hello-timeout'] as const) {
      const t = setup();
      const answer = await t.relay.transportError(`c-${kind}`, { kind });
      expect(answer.closeAfter, kind).toBe(true);
      expect(typeof answer.frame, kind).toBe('string');
      const parsed = JSON.parse(answer.frame as string);
      expect(parsed.error?.code, kind).toBeLessThan(0);
      expect(parsed.error?.message, kind).toBeTruthy();
      expect(t.relay.open, kind).toBe(0);
    }
  });

  it('closes without inventing a frame for a refusal it does not know', async () => {
    const t = setup();
    const answer = await t.relay.transportError('c1', { kind: 'something-new' });
    expect(answer).toEqual({ frame: null, closeAfter: true });
    expect(t.relay.open).toBe(0);
  });

  it('closes every connection it opened', async () => {
    const t = setup();
    await t.relay.frame('c1', t.hello);
    await t.relay.frame('c2', t.hello);
    expect(t.host.status().connections.length).toBe(2);
    t.relay.closeAll();
    expect(t.relay.open).toBe(0);
    expect(t.host.status().connections.filter((c) => c.state !== 'closed')).toHaveLength(0);
  });

  it('forgets a connection the transport reports gone', async () => {
    const t = setup();
    await t.relay.frame('c1', t.hello);
    t.relay.closed('c1');
    expect(t.relay.open).toBe(0);
    t.relay.closed('never-seen');
    expect(t.relay.open).toBe(0);
  });

  describe('when the host ends a session itself', () => {
    it('asks the transport to close that connection, once', async () => {
      const closed: string[] = [];
      const t = setup(4, (id) => closed.push(id));
      const answer = await t.relay.frame('c1', t.hello);
      const principalId = JSON.parse(answer.frame as string).result.principal.id as string;
      await t.relay.frame('c2', t.hello);

      // A person disconnects one agent. The relay learns from the host, not from
      // the socket, so the socket has to be told.
      expect(t.host.revoke(principalId)).toBe(1);
      expect(closed).toEqual(['c1']);
      expect(t.relay.open).toBe(1);
      // The other session is untouched.
      expect(JSON.parse((await t.relay.frame('c2', t.info)).frame as string).result.outcome).toBe(
        'ok',
      );
    });

    it('does not ask for a close the transport already knows about', async () => {
      const closed: string[] = [];
      const t = setup(4, (id) => closed.push(id));
      await t.relay.frame('c1', t.hello);
      t.relay.closed('c1'); // the peer left
      await t.relay.frame('c2', t.info); // no hello: the protocol ends it
      await t.relay.frame('c3', t.hello);
      t.relay.closeAll(); // the endpoint is going away
      expect(closed).toEqual([]);
      expect(t.relay.open).toBe(0);
    });

    it('does not ask again when the transport reports what it was asked to do', async () => {
      const closed: string[] = [];
      const t = setup(4, (id) => closed.push(id));
      const answer = await t.relay.frame('c1', t.hello);
      t.host.revoke(JSON.parse(answer.frame as string).result.principal.id as string);
      t.relay.closed('c1'); // Rust's confirmation that the socket is gone
      expect(closed).toEqual(['c1']);
    });
  });
});
