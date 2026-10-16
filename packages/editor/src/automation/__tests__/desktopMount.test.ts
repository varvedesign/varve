import { describe, expect, it, vi } from 'vitest';
import type { AutomationSettingsStore } from '../../settings';
import {
  AutomationMount,
  type DesktopTransportApi,
  grantsFor,
  type MountController,
  type MountDeps,
} from '../desktopMount';

const ON_READ: AutomationSettingsStore = {
  enabled: true,
  grants: 'read',
  requireApproval: true,
  capture: false,
  save: false,
};
const ON_EDIT: AutomationSettingsStore = {
  enabled: true,
  grants: 'edit',
  requireApproval: false,
  capture: false,
  save: false,
};
const OFF: AutomationSettingsStore = {
  enabled: false,
  grants: 'read',
  requireApproval: true,
  capture: false,
  save: false,
};

function setup(
  options: { desktop?: boolean; document?: { id: string; name: string } | null } = {},
) {
  const calls: string[] = [];
  let documentListener: () => void = () => undefined;
  let watching = 0;
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
  let controllerLoaded = false;
  const controller = {
    instanceId: 'window-test',
    setPolicy: vi.fn(
      (p: { enabled: boolean; grants: readonly string[]; requireApproval: boolean }) =>
        void calls.push(`policy:${p.enabled}:${p.grants.join('+')}:${p.requireApproval}`),
    ),
    setCredential: vi.fn((c: string | null) => void calls.push(`credential:${c}`)),
    openConnection: vi.fn(),
  };
  const loadTransport = vi.fn(async () => transport);
  const loadController = vi.fn(async () => {
    controllerLoaded = true;
    return controller as unknown as MountController;
  });
  const deps: MountDeps = {
    loadController,
    peekController: () => (controllerLoaded ? (controller as unknown as MountController) : null),
    desktop: options.desktop ?? true,
    loadTransport,
    document: () => document,
    watchDocument: (listener) => {
      watching += 1;
      documentListener = listener;
      return () => {
        watching -= 1;
      };
    },
  };
  const mount = new AutomationMount(deps);
  return {
    mount,
    calls,
    transport,
    controller,
    loadController,
    loadTransport,
    relay,
    fireChange: () => documentListener(),
    watching: () => watching,
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
    // Nothing was ever enabled, so the heavy controller is never even loaded.
    expect(t.loadController).not.toHaveBeenCalled();
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
    expect(t.loadController).not.toHaveBeenCalled();
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

  it('drops a setting that a newer one superseded before it started', async () => {
    const t = setup();
    const first = t.mount.apply(ON_EDIT);
    const second = t.mount.apply(OFF);
    await Promise.all([first, second]);
    expect(t.mount.status().state).toBe('off');
    expect(t.transport.applyDesktopPolicy).not.toHaveBeenCalled();
    expect(t.loadController).not.toHaveBeenCalled();
  });

  it('turns off an enable that is already in flight, without ever enabling the controller', async () => {
    const t = setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    (t.transport.applyDesktopPolicy as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (input) => {
        await gate; // the endpoint is mid-start when the person changes their mind
        return {
          endpoint: '/run/varve/v-test/s',
          instanceId: input.instanceId,
          credential: 'late',
        };
      },
    );
    const enabling = t.mount.apply(ON_EDIT);
    await vi.waitFor(() => expect(t.transport.applyDesktopPolicy).toHaveBeenCalled());
    const disabling = t.mount.apply(OFF);
    release();
    await Promise.all([enabling, disabling]);

    expect(t.mount.status().state).toBe('off');
    expect(t.calls).toContain('endpoint.stop');
    expect(t.controller.setPolicy).not.toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
    expect(t.controller.setCredential).not.toHaveBeenCalledWith('late');
  });

  it('turns a running session off completely', async () => {
    const t = setup();
    await t.mount.apply(ON_EDIT);
    await t.mount.apply(OFF);
    expect(t.mount.status().state).toBe('off');
    expect(t.relay.stop).toHaveBeenCalled();
    expect(t.calls.at(-1)).toBe('endpoint.stop');
    expect(t.controller.setPolicy.mock.calls.at(-1)?.[0].enabled).toBe(false);
    expect(t.controller.setCredential).toHaveBeenLastCalledWith(null);
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
    await vi.waitFor(() => expect(t.mount.status().state).toBe('running'));
    await vi.waitFor(() => expect(t.transport.applyDesktopPolicy).toHaveBeenCalledTimes(2));
    expect(t.calls).toContain('apply:doc-2:edit');
    expect(t.controller.setCredential).toHaveBeenCalledWith('credential-2');
    expect(t.relay.stop).toHaveBeenCalled();
  });

  it('does not restart the endpoint for a notification about the same document', async () => {
    const t = setup();
    await t.mount.apply(ON_EDIT);
    t.fireChange();
    t.fireChange();
    await Promise.resolve();
    expect(t.transport.applyDesktopPolicy).toHaveBeenCalledTimes(1);
  });

  it('starts once the first document opens when it was persisted on at a document-less start', async () => {
    const t = setup({ document: null });
    await t.mount.apply(ON_EDIT);
    expect(t.mount.status().state).toBe('starting');
    expect(t.watching()).toBe(1);

    t.openDocument({ id: 'doc-9', name: 'Nine' });
    t.fireChange();
    await vi.waitFor(() => expect(t.mount.status().state).toBe('running'));
    expect(t.calls).toContain('apply:doc-9:edit');
  });

  it('applying the setting it already runs with is a no-op, so unrelated edits keep clients', async () => {
    const t = setup();
    await t.mount.apply(ON_EDIT);
    await t.mount.apply({ ...ON_EDIT });
    await t.mount.apply({ ...ON_EDIT });
    expect(t.transport.applyDesktopPolicy).toHaveBeenCalledTimes(1);
    expect(t.relay.stop).not.toHaveBeenCalled();
  });

  it('restarts when the grants really change, and stops watching documents when turned off', async () => {
    const t = setup();
    await t.mount.apply(ON_READ);
    await t.mount.apply(ON_EDIT);
    expect(t.transport.applyDesktopPolicy).toHaveBeenCalledTimes(2);
    expect(t.calls).toContain('apply:doc-1:edit');
    expect(t.watching()).toBe(1);
    await t.mount.apply(OFF);
    expect(t.watching()).toBe(0);
  });

  it('maps each setting to exactly the permissions it names, nothing implied', async () => {
    const base = { enabled: true, requireApproval: true, capture: false, save: false };
    expect(grantsFor({ ...base, grants: 'read' })).toEqual(['read']);
    expect(grantsFor({ ...base, grants: 'edit' })).toEqual(['read', 'edit']);
    expect(grantsFor({ ...base, grants: 'edit', save: true })).toEqual(['read', 'edit', 'export']);
    expect(grantsFor({ ...base, grants: 'read', capture: true })).toEqual(['read', 'capture']);
    // Saving presupposes changes: a read-only setting never yields export.
    expect(grantsFor({ ...base, grants: 'read', save: true })).toEqual(['read']);
    expect(grantsFor({ ...base, grants: 'edit', capture: true, save: true })).toEqual([
      'read',
      'edit',
      'export',
      'capture',
    ]);
  });

  it('hands the controller the permissions and restarts when only capture or save changes', async () => {
    const t = setup();
    await t.mount.apply({ ...ON_EDIT, capture: true, save: true });
    expect(t.controller.setPolicy).toHaveBeenLastCalledWith({
      enabled: true,
      grants: ['read', 'edit', 'export', 'capture'],
      requireApproval: false,
    });
    expect(t.transport.applyDesktopPolicy).toHaveBeenCalledTimes(1);
    await t.mount.apply({ ...ON_EDIT, capture: true, save: false });
    expect(t.transport.applyDesktopPolicy).toHaveBeenCalledTimes(2);
    expect(t.controller.setPolicy).toHaveBeenLastCalledWith({
      enabled: true,
      grants: ['read', 'edit', 'capture'],
      requireApproval: false,
    });
  });
});
