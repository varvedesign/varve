import { describe, expect, it } from 'vitest';
import { CLIENT_ERROR, ControlClient, type LineTransport, RpcError } from '../control/client';

/** A transport whose server side is driven by the test. */
function fakeTransport() {
  let lineHandler: (line: string) => void = () => undefined;
  let closeHandler: (error?: Error) => void = () => undefined;
  const sent: Array<{ id: number; method: string }> = [];
  const transport: LineTransport = {
    send: (line) => {
      sent.push(JSON.parse(line) as { id: number; method: string });
    },
    onLine: (handler) => {
      lineHandler = handler;
    },
    onClose: (handler) => {
      closeHandler = handler;
    },
    close: () => closeHandler(),
  };
  return {
    transport,
    sent,
    reply: (message: unknown) => lineHandler(JSON.stringify(message)),
    raw: (line: string) => lineHandler(line),
    drop: (error?: Error) => closeHandler(error),
  };
}

describe('ControlClient reply correlation', () => {
  it('resolves the request whose id the reply names, regardless of arrival order', async () => {
    const t = fakeTransport();
    const client = new ControlClient(t.transport);
    const first = client.request('a');
    const second = client.request('b');
    t.reply({ jsonrpc: '2.0', id: 2, result: 'for-b' });
    t.reply({ jsonrpc: '2.0', id: 1, result: 'for-a' });
    expect(await second).toBe('for-b');
    expect(await first).toBe('for-a');
  });

  it('ignores a reply for an id it never sent and counts it', async () => {
    const t = fakeTransport();
    const client = new ControlClient(t.transport, { requestTimeoutMs: 50 });
    const pending = client.request('a');
    t.reply({ jsonrpc: '2.0', id: 999, result: 'stale success' });
    await expect(pending).rejects.toBeInstanceOf(RpcError);
    expect(client.unsolicited).toBe(1);
  });

  it('ignores a late reply after a timeout and reports the outcome as unknown', async () => {
    const t = fakeTransport();
    const client = new ControlClient(t.transport, { requestTimeoutMs: 20 });
    const pending = client.request('command.execute');
    await expect(pending).rejects.toMatchObject({ code: CLIENT_ERROR.TIMEOUT });
    await expect(pending).rejects.toThrow(/outcome of a mutation is unknown/);
    t.reply({ jsonrpc: '2.0', id: 1, result: { outcome: 'applied' } });
    expect(client.unsolicited).toBe(1);
  });

  it('accepts only the first reply to an id', async () => {
    const t = fakeTransport();
    const client = new ControlClient(t.transport);
    const pending = client.request('a');
    t.reply({ jsonrpc: '2.0', id: 1, result: 'first' });
    t.reply({ jsonrpc: '2.0', id: 1, result: 'second' });
    expect(await pending).toBe('first');
    expect(client.unsolicited).toBe(1);
  });

  it('treats a reply with both result and error, or neither, as malformed', async () => {
    const t = fakeTransport();
    const client = new ControlClient(t.transport);
    const both = client.request('a');
    t.reply({ jsonrpc: '2.0', id: 1, result: 1, error: { code: 1, message: 'x' } });
    await expect(both).rejects.toMatchObject({ code: CLIENT_ERROR.MALFORMED_REPLY });
    const neither = client.request('b');
    t.reply({ jsonrpc: '2.0', id: 2 });
    await expect(neither).rejects.toMatchObject({ code: CLIENT_ERROR.MALFORMED_REPLY });
  });

  it('surfaces JSON-RPC errors with code and data', async () => {
    const t = fakeTransport();
    const client = new ControlClient(t.transport);
    const pending = client.request('a');
    t.reply({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'bad', data: { x: 1 } } });
    await expect(pending).rejects.toMatchObject({ code: -32602, data: { x: 1 } });
  });

  it('rejects in-flight and later requests when the connection drops', async () => {
    const t = fakeTransport();
    const client = new ControlClient(t.transport);
    const pending = client.request('a');
    t.drop();
    await expect(pending).rejects.toMatchObject({ code: CLIENT_ERROR.CLOSED });
    await expect(client.request('b')).rejects.toMatchObject({ code: CLIENT_ERROR.CLOSED });
  });

  it('ignores lines that are not JSON objects', async () => {
    const t = fakeTransport();
    const client = new ControlClient(t.transport, { requestTimeoutMs: 20 });
    const pending = client.request('a');
    t.raw('not json');
    t.raw('42');
    t.raw('{"id":1,"id":2,"result":1}'); // duplicate key: invalid
    await expect(pending).rejects.toMatchObject({ code: CLIENT_ERROR.TIMEOUT });
    expect(client.unsolicited).toBe(3);
  });
});
