/**
 * Turns the person's setting into a running (or stopped) connected session.
 *
 * Three things have to agree for a client to reach a running Varve: the desktop
 * endpoint (Rust), the controller (policy and the per-document runtime), and
 * the relay between them. This module owns that sequence and nothing else, so
 * the rules live in one place:
 *
 * - **Fail closed.** The endpoint starts first and the controller is enabled
 *   only after it did. Any failure leaves both off; there is no state in which
 *   the controller accepts clients but nothing can be told why it is not
 *   reachable.
 * - **Latest setting wins, strictly in order.** Applications are serialized, so
 *   two quick toggles cannot interleave a stop with a start and strand a
 *   half-built endpoint.
 * - **The endpoint follows the document.** When the editor opens a different
 *   document the endpoint is re-scoped (its instance record names the
 *   document), which also mints a fresh credential and closes old clients. A
 *   client is never carried across to a document it did not attach to.
 * - **A browser reports "unreachable", it does not pretend.** A page cannot
 *   open a listener; the status says so.
 */
import { isTauriRuntime } from '@varve/platform';
import type { AutomationSettingsStore } from '../settings';
import type { AutomationController } from './controller';
import type { ConnectionAcceptor, DesktopEndpoint, RelayHandle } from './desktopTransport';
import { currentDocumentIdentity, getAutomationController } from './liveEditor';

export type MountState = 'off' | 'starting' | 'running' | 'unreachable' | 'error';

export interface MountStatus {
  state: MountState;
  /** Socket path, for the settings surface and `varve mcp --connect`. */
  endpoint: string | null;
  instanceId: string | null;
  /** Why the state is `unreachable` or `error`, in words a person can act on. */
  message: string | null;
}

/** The desktop transport functions the mount needs. Injectable for tests. */
export interface DesktopTransportApi {
  applyDesktopPolicy(input: {
    enabled: boolean;
    grants: 'read' | 'edit';
    documentId: string;
    documentName: string;
    instanceId: string;
  }): Promise<DesktopEndpoint | null>;
  stopDesktopEndpoint(): Promise<void>;
  attachDesktopRelay(acceptor: ConnectionAcceptor): Promise<RelayHandle>;
}

export interface MountDeps {
  controller: Pick<
    AutomationController,
    'setPolicy' | 'setCredential' | 'openConnection' | 'onChange'
  >;
  /** True when a local listener can exist (the desktop application). */
  desktop: boolean;
  loadTransport: () => Promise<DesktopTransportApi>;
  instanceId: string;
  /** The document session the editor is showing, if it has published yet. */
  document: () => { id: string; name: string } | null;
}

interface Scope {
  documentId: string;
  grants: 'read' | 'edit';
}

const OFF: MountStatus = { state: 'off', endpoint: null, instanceId: null, message: null };

export class AutomationMount {
  private current: MountStatus = OFF;
  private relay: RelayHandle | null = null;
  private scope: Scope | null = null;
  private latest: AutomationSettingsStore | null = null;
  private version = 0;
  private chain: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(status: MountStatus) => void>();
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: MountDeps) {
    // The controller rebuilds its runtime when the document session changes.
    // That is also when the endpoint must follow.
    this.unsubscribe = deps.controller.onChange(() => this.followDocument());
  }

  status(): MountStatus {
    return this.current;
  }

  onChange(listener: (status: MountStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Apply the person's setting. Resolves once this application has finished. */
  apply(settings: AutomationSettingsStore): Promise<void> {
    this.latest = settings;
    const version = ++this.version;
    this.chain = this.chain.then(() => this.run(settings, version));
    return this.chain;
  }

  dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
  }

  private set(next: MountStatus): void {
    this.current = next;
    for (const listener of [...this.listeners]) {
      try {
        listener(next);
      } catch {
        // A UI listener must never break the lifecycle.
      }
    }
  }

  private followDocument(): void {
    const settings = this.latest;
    if (!settings?.enabled || this.current.state !== 'running' || !this.scope) return;
    const now = this.deps.document();
    if (now && now.id !== this.scope.documentId) void this.apply(settings);
  }

  private async teardown(stopEndpoint: boolean): Promise<void> {
    this.relay?.stop();
    this.relay = null;
    this.scope = null;
    this.deps.controller.setPolicy({ enabled: false, grants: ['read'], requireApproval: true });
    this.deps.controller.setCredential(null);
    if (stopEndpoint && this.deps.desktop) {
      try {
        const transport = await this.deps.loadTransport();
        await transport.stopDesktopEndpoint();
      } catch {
        // The endpoint may already be gone. Stopping is best effort; the
        // controller is already refusing everything.
      }
    }
  }

  private async run(settings: AutomationSettingsStore, version: number): Promise<void> {
    if (version !== this.version) return; // a newer setting superseded this one

    if (!settings.enabled) {
      await this.teardown(true);
      this.set(OFF);
      return;
    }

    if (!this.deps.desktop) {
      await this.teardown(false);
      this.set({
        state: 'unreachable',
        endpoint: null,
        instanceId: null,
        message:
          'connected mode needs the desktop application; a browser page cannot accept a local connection',
      });
      return;
    }

    const document = this.deps.document();
    if (!document) {
      await this.teardown(true);
      this.set({
        state: 'starting',
        endpoint: null,
        instanceId: null,
        message: 'waiting for a document to open',
      });
      return;
    }

    this.set({ ...this.current, state: 'starting', message: null });
    try {
      const transport = await this.deps.loadTransport();
      if (version !== this.version) return;
      this.relay?.stop();
      this.relay = null;

      const input = {
        enabled: true,
        grants: settings.grants,
        documentId: document.id,
        documentName: document.name,
        instanceId: this.deps.instanceId,
      };
      let endpoint: DesktopEndpoint | null;
      try {
        endpoint = await transport.applyDesktopPolicy(input);
      } catch {
        // The endpoint kept running across a webview reload, so it reported
        // "unchanged" without a credential we no longer hold. Restart it: a
        // fresh endpoint mints a fresh credential, and that is the only way to
        // learn one.
        await transport.stopDesktopEndpoint();
        endpoint = await transport.applyDesktopPolicy(input);
      }
      if (version !== this.version) {
        await transport.stopDesktopEndpoint().catch(() => undefined);
        return;
      }
      if (!endpoint) {
        throw new Error('the desktop endpoint did not start');
      }

      this.deps.controller.setCredential(endpoint.credential);
      this.deps.controller.setPolicy({
        enabled: true,
        grants: settings.grants === 'edit' ? ['read', 'edit'] : ['read'],
        requireApproval: settings.requireApproval,
      });
      this.relay = await transport.attachDesktopRelay({
        open: (options) => this.deps.controller.openConnection(options.transport),
      });
      this.scope = { documentId: document.id, grants: settings.grants };
      this.set({
        state: 'running',
        endpoint: endpoint.endpoint,
        instanceId: endpoint.instanceId,
        message: null,
      });
    } catch (error) {
      await this.teardown(true);
      this.set({
        state: 'error',
        endpoint: null,
        instanceId: null,
        message: error instanceof Error ? error.message : 'the endpoint failed to start',
      });
    }
  }
}

let singleton: AutomationMount | null = null;

/** The window's mount, wired to the real controller and the desktop transport. */
export function getAutomationMount(): AutomationMount {
  if (!singleton) {
    const controller = getAutomationController();
    singleton = new AutomationMount({
      controller,
      desktop: isTauriRuntime(),
      loadTransport: () => import('./desktopTransport'),
      instanceId: controller.instanceId,
      document: () => {
        const now = currentDocumentIdentity();
        return now ? { id: now.id, name: now.name } : null;
      },
    });
  }
  return singleton;
}

export function resetAutomationMountForTesting(): void {
  singleton?.dispose();
  singleton = null;
}
