/**
 * The automation controller: policy, credential, session and activity for one
 * editor window.
 *
 * It owns the things a person decides (is automation on, what may a client do,
 * is every change held for approval) and the lifetime rule that makes connected
 * mode honest: **one runtime per document session**. When the active session or
 * its document changes, the runtime is disposed and its connections close; a
 * client attaches again and is shown the document that is open now. A dead pin
 * is refused, never retargeted.
 *
 * It does not own a transport. A transport (the desktop bridge, an in-page
 * port used by tests) asks for a connection with `openConnection` and feeds it
 * lines, exactly as it would feed any other `HostConnection`.
 */
import {
  type AdmissionRequest,
  type ApprovalDecision,
  type ApprovalRequest,
  type AuthorizationClass,
  AutomationHost,
  createStandardCatalog,
  Executor,
  type HostOpenResult,
  type HostStatus,
  LiveAuthority,
  type ObservedReceipt,
  type TransportKind,
} from '@varve/automation';
import type { EditorContextValue } from '../context';
import { createEditorBindings } from './editorBindings';
import { createLiveExternals, type RenderNode } from './liveExternals';
import { createLiveEditorPort, type EditorLivePort } from './livePort';

export interface AutomationPolicy {
  /** Off until a person turns it on; nothing listens or answers while off. */
  enabled: boolean;
  /** What a connecting client may do. Read-only unless a person widens it. */
  grants: readonly AuthorizationClass[];
  /** Hold every change until a person approves it. */
  requireApproval: boolean;
}

export const DEFAULT_AUTOMATION_POLICY: AutomationPolicy = {
  enabled: false,
  grants: ['read'],
  requireApproval: false,
};

export interface ActivityEntry {
  /** Monotonic within this window; a stable identity for rendering. */
  seq: number;
  at: number;
  client: string;
  command: string;
  outcome: string;
  summary: string;
  /** Machine code when the request was refused. */
  code?: string;
  revision: number;
}

export interface ControllerSession {
  sessionId: string;
  documentId: string;
  documentName: string;
  generation: string;
}

export interface ControllerStatus {
  policy: AutomationPolicy;
  /** Whether a credential exists. The credential itself is never in status. */
  credentialSet: boolean;
  session: ControllerSession | null;
  host: HostStatus | null;
  pendingApprovals: ApprovalRequest[];
  activity: ActivityEntry[];
}

export interface ControllerOptions {
  instanceId: string;
  serverInfo: { name: string; version: string };
  now?: () => number;
  /** How long a held change waits for a person before it is refused. */
  approvalTimeoutMs?: number;
  /** Replaces the export pipeline as the renderer behind capture. For tests. */
  render?: RenderNode;
}

const ACTIVITY_LIMIT = 200;

interface Runtime {
  session: ControllerSession;
  port: EditorLivePort;
  host: AutomationHost;
  unsubscribe: () => void;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class AutomationController {
  private policy: AutomationPolicy = DEFAULT_AUTOMATION_POLICY;
  private credential: string | null = null;
  private editor: EditorContextValue | null = null;
  private runtime: Runtime | null = null;
  private attachments = 0;
  private readonly activity: ActivityEntry[] = [];
  private activitySeq = 0;
  private readonly pending = new Map<string, PendingApproval>();
  private readonly listeners = new Set<(status: ControllerStatus) => void>();
  private readonly now: () => number;

  constructor(private readonly options: ControllerOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Identity of this window, shared with the discoverable endpoint record. */
  get instanceId(): string {
    return this.options.instanceId;
  }

  // ── Person's decisions ────────────────────────────────────────────────────

  setPolicy(policy: AutomationPolicy): void {
    this.policy = { ...policy, grants: [...policy.grants] };
    if (!policy.enabled) {
      this.dispose();
    } else {
      this.reconcile();
    }
    this.emit();
  }

  /** The secret clients present in `session.hello`. `null` removes access. */
  setCredential(credential: string | null): void {
    this.credential = credential && credential.length > 0 ? credential : null;
    if (this.credential === null) this.dispose();
    else this.reconcile();
    this.emit();
  }

  pause(reason = 'automation was paused by the person using Varve'): void {
    this.runtime?.host.pause(reason);
    this.emit();
  }

  resume(): void {
    this.runtime?.host.resume();
    this.emit();
  }

  /** Disconnect one client and refuse it until the person re-admits it. */
  revoke(principalId: string): number {
    const closed = this.runtime?.host.revoke(principalId) ?? 0;
    this.emit();
    return closed;
  }

  /** Approve or refuse one held change. Only the host UI reaches this. */
  decide(receiptId: string, decision: ApprovalDecision): boolean {
    const held = this.pending.get(receiptId);
    if (!held) return false;
    clearTimeout(held.timer);
    this.pending.delete(receiptId);
    held.resolve(decision);
    this.emit();
    return true;
  }

  // ── Editor and transports ─────────────────────────────────────────────────

  /** The editor reports every state it renders. Cheap while automation is off. */
  attach(editor: EditorContextValue): void {
    this.editor = editor;
    if (!this.policy.enabled || this.credential === null) return;
    const now = editor.readAutomationState();
    const live = this.runtime;
    if (
      live &&
      (live.session.sessionId !== now.sessionId || live.session.documentId !== now.document.id)
    ) {
      // The document session this runtime served is gone. Connections close; a
      // client attaches again and is shown what is open now.
      this.dispose();
    }
    if (!this.runtime) this.build(editor);
    this.runtime?.port.observe({
      document: now.document,
      revision: now.revision,
      sessionId: now.sessionId,
      transactionOpen: now.transactionOpen,
    });
  }

  /** Open a connection onto the current document session, if one may exist. */
  openConnection(transport: TransportKind = 'ipc'): HostOpenResult {
    if (!this.runtime) {
      return {
        ok: false,
        reason: 'stopped',
        message: this.policy.enabled
          ? 'no document session is open to attach to'
          : 'automation is turned off',
      };
    }
    return this.runtime.host.open({ transport });
  }

  status(): ControllerStatus {
    return {
      policy: this.policy,
      credentialSet: this.credential !== null,
      session: this.runtime?.session ?? null,
      host: this.runtime?.host.status() ?? null,
      pendingApprovals: [...this.pending.values()].map((held) => held.request),
      activity: [...this.activity],
    };
  }

  onChange(listener: (status: ControllerStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private reconcile(): void {
    if (this.editor && this.policy.enabled && this.credential !== null) this.attach(this.editor);
  }

  private build(editor: EditorContextValue): void {
    const now = editor.readAutomationState();
    this.attachments += 1;
    const generation = `${now.sessionId}-${this.attachments}`;
    const port = createLiveEditorPort({
      bindings: createEditorBindings(() => this.editor),
      instanceId: this.options.instanceId,
      generation,
    });
    const executor = new Executor({
      catalog: createStandardCatalog(),
      onReceipt: (observed) => this.record(observed),
    });
    const host = new AutomationHost({
      authority: new LiveAuthority({ port }),
      executor,
      serverInfo: this.options.serverInfo,
      admit: (request) => this.admit(request),
      approval: (request) => this.requestApproval(request),
      externals: createLiveExternals({
        editor: () => this.editor,
        ...(this.options.render ? { render: this.options.render } : {}),
      }),
      principalPrefix: 'client',
    });
    const unsubscribe = host.onChange(() => this.emit());
    this.runtime = {
      session: {
        sessionId: now.sessionId,
        documentId: now.document.id,
        documentName: now.document.name,
        generation,
      },
      port,
      host,
      unsubscribe,
    };
    this.emit();
  }

  private dispose(): void {
    const live = this.runtime;
    if (!live) return;
    this.runtime = null;
    live.unsubscribe();
    live.host.stopAccepting();
    live.host.closeAll();
    // A held change belongs to a session that no longer exists.
    for (const [id, held] of [...this.pending]) {
      clearTimeout(held.timer);
      this.pending.delete(id);
      held.resolve({ approved: false, reason: 'the document session ended' });
    }
    this.emit();
  }

  private admit(request: AdmissionRequest) {
    if (this.credential === null || !sameSecret(request.credential, this.credential)) return null;
    return {
      grants: this.policy.grants,
      label: request.client.name,
      kind: 'agent' as const,
    };
  }

  private requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    if (!this.policy.requireApproval) return Promise.resolve({ approved: true });
    // A capture the person granted by name changes nothing; asking each time
    // would be a focus-stealing prompt for something the grant already covers.
    if (request.authorization === 'capture') return Promise.resolve({ approved: true });
    return new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(request.receiptId);
          resolve({ approved: false, reason: 'no one answered in time' });
          this.emit();
        },
        this.options.approvalTimeoutMs ?? 5 * 60_000,
      );
      this.pending.set(request.receiptId, { request, resolve, timer });
      this.emit();
    });
  }

  private record({ principal, receipt }: ObservedReceipt): void {
    const command = 'command' in receipt ? receipt.command : 'batch';
    this.activity.push({
      seq: ++this.activitySeq,
      at: this.now(),
      client: principal.label,
      command,
      outcome: receipt.outcome,
      summary: receipt.summary.slice(0, 300),
      ...(receipt.error ? { code: receipt.error.code } : {}),
      revision: receipt.revision.after,
    });
    while (this.activity.length > ACTIVITY_LIMIT) this.activity.shift();
    this.emit();
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const status = this.status();
    for (const listener of [...this.listeners]) {
      try {
        listener(status);
      } catch {
        // A UI listener must never break the control path.
      }
    }
  }
}

/** Length-independent comparison so the secret's length is not a timing signal. */
function sameSecret(presented: string, expected: string): boolean {
  let diff = presented.length ^ expected.length;
  const length = Math.max(presented.length, expected.length);
  for (let i = 0; i < length; i++) {
    diff |= (presented.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return diff === 0;
}
