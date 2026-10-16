import { describe, expect, it, vi } from 'vitest';
import type { AutomationSettingsStore } from '../../settings';
import { AutomationMount, type DesktopTransportApi, type MountDeps } from '../desktopMount';

const ON_READ: AutomationSettingsStore = { enabled: true, grants: 'read', requireApproval: true };
const ON_EDIT: AutomationSettingsStore = { enabled: true, grants: 'edit', requireApproval: false };
const OFF: AutomationSettingsStore = { enabled: false, grants: 'read', requireApproval: true };

function setup(
  options: { desktop?: boolean; document?: { id: string; name: string } | null } = {},
) {
  const calls: string[] = [];
  let changeListener: () => void = () => undefined;
  let document = options.document === undefined ? { id: 'doc-1', name: 'One' } : options.document;
  let credentialCounter = 0;

  const relay = { stop: vi.fn(() => void calls.push('relay.stop')) };
  const transport: DesktopTransportApi = {
    applyDesktopPolicy: vi.fn(async (input) => {
      calls.push(`apply:${input.documentId}:${input.grants}`);
      credentialCounter += 1;
      return {
        endpoint: '/run/varve/v-test/s',
        instanceId: input.instanceId,
        credential: `credential-${credentialCounter}`,
      };
    }),
    stopDesktopEndpoint: vi.fn(async () => void calls.push('endpoint.stop')),
    attachDesktopRelay: vi.fn(async () => {
      calls.push('relay.attach');
      return relay;
    }),
  };
  const controller = {
    setPolicy: vi.fn(
      (p: { enabled: boolean; grants: readonly string[]; requireApproval: boolean }) =>
        void calls.push(`policy:${p.enabled}:${p.grants.join('+')}:${p.requireApproval}`),
    ),
    setCredential: vi.fn((c: string | null) => void calls.push(`credential:${c}`)),
    openConnection: vi.fn(),
    onChange: vi.fn((listener: () => void) => {
      changeListener = listener;
      return () => undefined;
    }),
  };
  const loadTransport = vi.fn(async () => transport);
  const deps: MountDeps = {
    controller: controller as unknown as MountDeps['controller'],
    desktop: options.desktop ?? true,
    loadTransport,
    instanceId: 'window-test',
    document: () => document,
  };
  const mount = new AutomationMount(deps);
  return {
    mount,
    calls,
    transport,
    controller,
    loadTransport,
    relay,
    fireChange: () => changeListener(),
    openDocument: (next: { id: string; name: string }) => {
      document = next;
    },
  };
}

describe('AutomationMount', () => {
  it('stays off, and loads nothing, until a person turns it on', async () => {
    const t = setup();
    await t.mount.apply(OFF);
    expect(t.mount.status().state).toBe('off');
    expect(t.controller.setPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    expect(t.transport.applyDesktopPolicy).not.toHaveBeenCalled();
  });

  it('starts the endpoint before it enables the controller, then relays frames', async () => {
    const t = setup();
    await t.mount.apply(ON_EDIT);
    expect(t.calls.filter((c) => !c.startsWith('policy:false') && c !== 'credential:null')).toEqual(
      [
        'apply:doc-1:edit',
        'credential:credential-1',
        'policy:true:read+edit:false',
        'relay.attach',
      ],
    );
    expect(t.mount.status()).toMatchObject({
      state: 'running',
      endpoint: '/run/varve/v-test/s',
      instanceId: 'window-test',
    });
  });

  it('grants read only for a read setting and keeps approval on', async () => {
    const t = setup();
    await t.mount.apply(ON_READ);
    expect(t.controller.setPolicy).toHaveBeenLastCalledWith({
      enabled: true,
      grants: ['read'],
      requireApproval: true,
    });
  });

  it('reports a browser as unreachable instead of pretending to listen', async () => {
    const t = setup({ desktop: false });
    await t.mount.apply(ON_EDIT);
    expect(t.mount.status().state).toBe('unreachable');
    expect(t.mount.status().message).toContain('desktop application');
    expect(t.loadTransport).not.toHaveBeenCalled();
    expect(t.controller.setPolicy).not.toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  it('fails closed when the endpoint does not start', async () => {
    const t = setup();
    (t.transport.applyDesktopPolicy as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await t.mount.apply(ON_EDIT);
    expect(t.mount.status().state).toBe('error');
    expect(t.controller.setPolicy).not.toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
    expect(t.calls).toContain('endpoint.stop');
  });

  it('tears everything down when the relay cannot attach', async () => {
    const t = setup();
    (t.transport.attachDesktopRelay as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('listen failed'),
    );
    await t.mount.apply(ON_EDIT);
    expect(t.mount.status()).toMatchObject({ state: 'error', message: 'listen failed' });
    const last = t.controller.setPolicy.mock.calls.at(-1)?.[0];
    expect(last?.enabled).toBe(false);
    expect(t.controller.setCredential).toHaveBeenLastCalledWith(null);
    expect(t.calls).toContain('endpoint.stop');
  });

  it('applies settings in order, so a quick on-then-off ends off with the endpoint stopped', async () => {
    const t = setup();
    const first = t.mount.apply(ON_EDIT);
    const second = t.mount.apply(OFF);
    await Promise.all([first, second]);
    expect(t.mount.status().state).toBe('off');
    expect(t.calls.at(-1)).toBe('endpoint.stop');
    const policies = t.controller.setPolicy.mock.calls.map((c) => c[0].enabled);
    expect(policies.at(-1)).toBe(false);
  });

  it('recovers when the endpoint outlived a webview reload and no longer yields a credential', async () => {
    const t = setup();
    (t.transport.applyDesktopPolicy as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('the endpoint reported itself running without an endpoint, identity or credential'),
    );
    await t.mount.apply(ON_EDIT);
    expect(t.mount.status().state).toBe('running');
    expect(t.calls).toContain('endpoint.stop');
    expect(t.transport.applyDesktopPolicy).toHaveBeenCalledTimes(2);
  });

  it('waits, without opening an endpoint, until there is a document', async () => {
    const t = setup({ document: null });
    await t.mount.apply(ON_EDIT);
    expect(t.mount.status()).toMatchObject({
      state: 'starting',
      message: 'waiting for a document to open',
    });
    expect(t.transport.applyDesktopPolicy).not.toHaveBeenCalled();
  });

  it('re-scopes the endpoint to a different document, adopting its new credential', async () => {
    const t = setup();
    await t.mount.apply(ON_EDIT);
    expect(t.transport.applyDesktopPolicy).toHaveBeenCalledTimes(1);

    t.openDocument({ id: 'doc-2', name: 'Two' });
    t.fireChange();
    await vi.waitFor(() => expect(t.transport.applyDesktopPolicy).toHaveBeenCalledTimes(2));
    await t.mount.apply(ON_EDIT); // let the queued re-scope settle
    expect(t.calls).toContain('apply:doc-2:edit');
    expect(t.controller.setCredential).toHaveBeenCalledWith('credential-2');
    expect(t.relay.stop).toHaveBeenCalled();
  });

  it('does not restart the endpoint for activity on the same document', async () => {
    const t = setup();
    await t.mount.apply(ON_EDIT);
    t.fireChange();
    t.fireChange();
    await Promise.resolve();
    expect(t.transport.applyDesktopPolicy).toHaveBeenCalledTimes(1);
  });
});
