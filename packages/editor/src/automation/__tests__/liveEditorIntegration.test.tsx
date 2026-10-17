/**
 * Connected-mode integration against the real `EditorProvider`.
 *
 * Nothing here fakes the editor: the document, the undo stack, the transaction
 * layer and the render flush are the editor's own. The only stand-in is the
 * publishing effect, which is what the shell's `registerEditorActions` effect
 * does on every state change.
 */
import { act, render, waitFor } from '@testing-library/react';
import type { HostConnection } from '@varve/automation';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import { activeSurfaceRootIds } from '../../navigation/navigationBounds';
import {
  loadAutomationController,
  peekAutomationController,
  publishEditorToAutomation,
  resetAutomationControllerForTesting,
} from '../liveEditor';

type Editor = ReturnType<typeof useEditor>;

const CREDENTIAL = 'integration-secret';

/** The loaded controller; a test that reaches for it before enabling is wrong. */
function ctrl() {
  const loaded = peekAutomationController();
  if (!loaded) throw new Error('the automation controller has not been loaded');
  return loaded;
}
let editor: Editor | undefined;

function Publisher() {
  const ctx = useEditor();
  editor = ctx;
  useEffect(() => {
    publishEditorToAutomation(ctx);
  });
  return null;
}

async function mount() {
  render(
    <EditorProvider>
      <Publisher />
    </EditorProvider>,
  );
  await waitFor(() => expect(editor).toBeDefined());
}

function live(): Editor {
  if (!editor) throw new Error('editor not mounted');
  return editor;
}

async function rpc(
  connection: HostConnection,
  id: number | string,
  method: string,
  params: unknown,
) {
  const line = await connection.handleLine(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  return line === null ? null : (JSON.parse(line) as Record<string, any>);
}

async function connect(credential = CREDENTIAL) {
  const opened = ctrl().openConnection('ipc');
  if (!opened.ok) throw new Error(opened.message);
  const connection = opened.connection;
  const hello = await rpc(connection, 'h', 'session.hello', {
    credential,
    client: { name: 'test-agent', version: '1' },
    protocolVersions: ['varve.control/1'],
  });
  return { connection, hello };
}

function execute(
  connection: HostConnection,
  id: number,
  command: string,
  args: unknown,
  extra = {},
) {
  return rpc(connection, id, 'command.execute', { command, args, ...extra });
}

const rect = { kind: 'rect', x: 10, y: 20, width: 30, height: 40 };

async function enable(
  grants: Array<'read' | 'edit' | 'export'> = ['read', 'edit'],
  requireApproval = false,
) {
  const controller = await loadAutomationController();
  controller.setCredential(CREDENTIAL);
  controller.setPolicy({ enabled: true, grants, requireApproval });
  // The shell re-publishes on every state change; do it once now that policy is set.
  act(() => {
    publishEditorToAutomation(live());
  });
}

beforeEach(() => {
  editor = undefined;
  resetAutomationControllerForTesting();
});

afterEach(() => {
  resetAutomationControllerForTesting();
});

describe('connected session over the real editor', () => {
  it('does not even load the controller until a person turns automation on', async () => {
    await mount();
    // The editor has rendered and published itself, and nothing was created.
    expect(peekAutomationController()).toBeNull();
    const controller = await loadAutomationController();
    const opened = controller.openConnection('ipc');
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.message).toContain('turned off');
  });

  it('refuses a wrong credential and never reveals the right one', async () => {
    await mount();
    await enable();
    const { hello } = await connect('guess');
    expect(hello?.error.code).toBe(-32001);
    expect(JSON.stringify(hello)).not.toContain(CREDENTIAL);
  });

  it('reports a connected session for the open document, not a headless one', async () => {
    await mount();
    await enable();
    const { connection, hello } = await connect();
    expect(hello?.result.session.mode).toBe('connected');
    expect(hello?.result.session.documentId).toBe(live().state.document.id);
    const info = await execute(connection, 1, 'varve.document.info', {});
    expect(info?.result.outcome).toBe('ok');
    expect(info?.result.output.instance.mode).toBe('connected');
  });

  it('applies an edit through the editor as one labelled undo step', async () => {
    await mount();
    await enable();
    const { connection } = await connect();
    const before = Object.keys(live().state.document.nodes).length;

    const created = await execute(connection, 2, 'varve.node.create', rect);
    expect(created?.result.outcome).toBe('applied');
    const id = created?.result.created[0] as string;
    await waitFor(() => expect(live().state.document.nodes[id]).toBeDefined());
    expect(Object.keys(live().state.document.nodes).length).toBe(before + 1);
    expect(live().state.canUndo).toBe(true);
    expect(live().state.dirty).toBe(true);
    expect(live().state.undoLabel).toBe('Create rect');

    // One undo removes exactly the agent's change.
    act(() => {
      live().undo();
    });
    await waitFor(() => expect(Object.keys(live().state.document.nodes).length).toBe(before));
    expect(live().state.document.nodes[id]).toBeUndefined();
  });

  it('keeps the revision monotonic across the agent, a person and undo', async () => {
    await mount();
    await enable();
    const { connection } = await connect();
    const r0 = (await execute(connection, 1, 'varve.document.info', {}))?.result.revision
      .after as number;

    const first = await execute(connection, 2, 'varve.node.create', rect);
    const r1 = first?.result.revision.after as number;
    expect(r1).toBeGreaterThan(r0);

    act(() => {
      live().updateDoc((doc) => ({ ...doc, name: 'Renamed by a person' }));
    });
    await waitFor(() => expect(live().state.document.name).toBe('Renamed by a person'));
    const r2 = (await execute(connection, 3, 'varve.document.info', {}))?.result.revision
      .after as number;
    expect(r2).toBeGreaterThan(r1);

    act(() => {
      live().undo();
    });
    await waitFor(() => expect(live().state.document.name).not.toBe('Renamed by a person'));
    const r3 = (await execute(connection, 4, 'varve.document.info', {}))?.result.revision
      .after as number;
    expect(r3).toBeGreaterThan(r2);
  });

  it('puts a created node on the surface the person is looking at, not on a hidden one', async () => {
    await mount();
    await enable();
    const { connection } = await connect();

    const created = await execute(connection, 1, 'varve.node.create', rect);
    expect(created?.result.outcome).toBe('applied');
    const id = created?.result.created[0] as string;
    await waitFor(() => expect(live().state.document.nodes[id]).toBeDefined());

    const doc = live().state.document;
    const roots = activeSurfaceRootIds(doc, live().state.workspaceMode);
    expect(roots.length).toBeGreaterThan(0);
    // Walk up from the new node: it must reach the active surface's content
    // root, or it renders but never appears in the Layers panel.
    const parentOf = (child: string) =>
      Object.entries(doc.nodes).find(([, n]) =>
        (n as { children?: string[] }).children?.includes(child),
      )?.[0];
    let cursor: string | undefined = id;
    let reached = false;
    while (cursor) {
      if (roots.includes(cursor)) {
        reached = true;
        break;
      }
      cursor = parentOf(cursor);
    }
    expect(reached).toBe(true);
    // And the session reports that same surface as its default.
    const info = await execute(connection, 2, 'varve.document.info', {});
    expect(roots).toContain(info?.result.output.defaultParentId);
  });

  it('refuses a plan based on a revision a person has since changed', async () => {
    await mount();
    await enable();
    const { connection } = await connect();
    const planned = (await execute(connection, 1, 'varve.document.info', {}))?.result.revision
      .after as number;

    act(() => {
      live().updateDoc((doc) => ({ ...doc, name: 'A person edited first' }));
    });
    await waitFor(() => expect(live().state.document.name).toBe('A person edited first'));

    const stale = await execute(connection, 2, 'varve.node.create', rect, {
      expectedRevision: planned,
    });
    expect(stale?.result.outcome).toBe('rejected');
    expect(stale?.result.error.code).toBe('REVISION_CONFLICT');
    expect(live().state.document.name).toBe('A person edited first');
    const created = Object.values(live().state.document.nodes).filter((n) => n.kind === 'shape');
    expect(created).toHaveLength(0);
  });

  it("does not fold a change into a person's open transaction", async () => {
    await mount();
    await enable();
    const { connection } = await connect();

    act(() => {
      live().beginTransaction();
    });
    const busy = await execute(connection, 1, 'varve.node.create', rect);
    expect(busy?.result.outcome).toBe('rejected');
    expect(busy?.result.error.code).toBe('CONFLICT');
    expect(busy?.result.error.retryable).toBe(true);
    expect(
      Object.values(live().state.document.nodes).filter((n) => n.kind === 'shape'),
    ).toHaveLength(0);

    act(() => {
      live().commitTransaction();
    });
    const retried = await execute(connection, 2, 'varve.node.create', rect);
    expect(retried?.result.outcome).toBe('applied');
  });

  it('enforces the granted permissions through the same executor', async () => {
    await mount();
    await enable(['read']);
    const { connection } = await connect();
    const denied = await execute(connection, 1, 'varve.node.create', rect);
    expect(denied?.result.error.code).toBe('PERMISSION_DENIED');
    expect(
      Object.values(live().state.document.nodes).filter((n) => n.kind === 'shape'),
    ).toHaveLength(0);
  });

  it('closes a client when its document session is replaced and never retargets it', async () => {
    await mount();
    await enable();
    const { connection } = await connect();
    const first = ctrl().status().session;
    expect(first).not.toBeNull();

    act(() => {
      live().newDocument();
    });
    await waitFor(() => expect(live().state.document.id).not.toBe(first?.documentId));
    act(() => {
      publishEditorToAutomation(live());
    });

    const next = ctrl().status().session;
    expect(next?.generation).not.toBe(first?.generation);
    expect(next?.documentId).toBe(live().state.document.id);
    // The old client is gone; it must attach again.
    expect(connection.shouldClose).toBe(true);
    const stale = await execute(connection, 9, 'varve.node.create', rect);
    expect(stale).toBeNull();
  });

  it('stops answering when a person turns automation off', async () => {
    await mount();
    await enable();
    const { connection } = await connect();
    ctrl().setPolicy({
      enabled: false,
      grants: ['read'],
      requireApproval: false,
    });
    expect(connection.shouldClose).toBe(true);
    expect(ctrl().openConnection('ipc').ok).toBe(false);
  });

  it('holds a change for approval and applies it only after a person agrees', async () => {
    await mount();
    await enable(['read', 'edit'], true);
    const { connection } = await connect();
    const before = Object.keys(live().state.document.nodes).length;

    const pending = execute(connection, 1, 'varve.node.create', rect);
    await waitFor(() => expect(ctrl().status().pendingApprovals).toHaveLength(1));
    const held = ctrl().status().pendingApprovals[0];
    expect(held?.command).toBe('varve.node.create');
    expect(Object.keys(live().state.document.nodes).length).toBe(before);

    ctrl().decide(held?.receiptId as string, { approved: true });
    const result = await pending;
    expect(result?.result.outcome).toBe('applied');
    expect(Object.keys(live().state.document.nodes).length).toBe(before + 1);
  });

  it('refuses a change a person declines, and records it in the activity log', async () => {
    await mount();
    await enable(['read', 'edit'], true);
    const { connection } = await connect();
    const pending = execute(connection, 1, 'varve.node.create', rect);
    await waitFor(() => expect(ctrl().status().pendingApprovals).toHaveLength(1));
    const held = ctrl().status().pendingApprovals[0];
    ctrl().decide(held?.receiptId as string, {
      approved: false,
      reason: 'not now',
    });
    const result = await pending;
    expect(result?.result.error.code).toBe('PERMISSION_DENIED');
    expect(
      Object.values(live().state.document.nodes).filter((n) => n.kind === 'shape'),
    ).toHaveLength(0);

    const log = ctrl().status().activity;
    expect(log.at(-1)).toMatchObject({
      client: 'test-agent',
      command: 'varve.node.create',
      outcome: 'rejected',
      code: 'PERMISSION_DENIED',
    });
    // The log carries no arguments.
    expect(JSON.stringify(log)).not.toContain('"width"');
  });

  it('blocks new commits while paused but still lets a client read why', async () => {
    await mount();
    await enable();
    const { connection } = await connect();
    ctrl().pause('paused for review');
    const blocked = await execute(connection, 1, 'varve.node.create', rect);
    expect(blocked?.result.outcome).toBe('rejected');
    expect(blocked?.result.error.message).toContain('paused for review');
    const read = await execute(connection, 2, 'varve.document.info', {});
    expect(read?.result.outcome).toBe('ok');
    ctrl().resume();
    expect((await execute(connection, 3, 'varve.node.create', rect))?.result.outcome).toBe(
      'applied',
    );
  });
});

describe('structure commands match the editor’s own actions', () => {
  type Doc = Editor['state']['document'];

  /** Where a node sits: its container, the container's full child order, its own transform. */
  function placement(doc: Doc, id: string) {
    const holder = Object.values(doc.nodes).find(
      (n) => 'children' in n && (n as { children: string[] }).children.includes(id),
    ) as { id: string; children: string[] } | undefined;
    const node = doc.nodes[id] as unknown as { transform?: number[]; name?: string; kind: string };
    return {
      container: holder?.id ?? null,
      order: holder?.children ?? doc.rootChildren,
      transform: node.transform,
      kind: node.kind,
      name: node.name,
    };
  }

  async function twoRects() {
    await mount();
    await enable();
    const { connection } = await connect();
    const a = (await execute(connection, 1, 'varve.node.create', rect))?.result
      .created[0] as string;
    const b = (await execute(connection, 2, 'varve.node.create', { ...rect, x: 100 }))?.result
      .created[0] as string;
    await waitFor(() => expect(live().state.document.nodes[b]).toBeDefined());
    return { connection, a, b };
  }

  const newGroupId = (doc: Doc, before: Doc): string =>
    Object.keys(doc.nodes).find((id) => !before.nodes[id] && doc.nodes[id]?.kind === 'group') ?? '';

  it('groups the way the Group action does', async () => {
    const { connection, a, b } = await twoRects();
    const base = live().state.document;

    const grouped = await execute(connection, 3, 'varve.node.group', { nodeIds: [a, b] });
    expect(grouped?.result.outcome).toBe('applied');
    const commandGroup = grouped?.result.created[0] as string;
    await waitFor(() => expect(live().state.document.nodes[commandGroup]).toBeDefined());
    const viaCommand = {
      group: placement(live().state.document, commandGroup),
      a: placement(live().state.document, a),
      b: placement(live().state.document, b),
      members: (live().state.document.nodes[commandGroup] as { children: string[] }).children,
    };

    // One undo removes exactly the agent's change, as for every other command.
    act(() => {
      live().undo();
    });
    await waitFor(() => expect(live().state.document.nodes[commandGroup]).toBeUndefined());

    act(() => {
      live().setSelectionRefs([a, b]);
    });
    act(() => {
      live().groupSelected();
    });
    await waitFor(() => expect(newGroupId(live().state.document, base)).not.toBe(''));
    const uiGroup = newGroupId(live().state.document, base);
    const viaUi = {
      group: placement(live().state.document, uiGroup),
      a: placement(live().state.document, a),
      b: placement(live().state.document, b),
      members: (live().state.document.nodes[uiGroup] as { children: string[] }).children,
    };

    // Same name, same place in the same container, same members in the same
    // order, same transforms. Only the new group's id may differ, so it is
    // masked wherever it appears.
    const norm = (p: ReturnType<typeof placement>, gid: string) => ({
      ...p,
      container: p.container === gid ? '<group>' : p.container,
      order: p.order.map((x) => (x === gid ? '<group>' : x)),
    });
    expect(norm(viaCommand.group, commandGroup)).toEqual(norm(viaUi.group, uiGroup));
    expect(norm(viaCommand.a, commandGroup)).toEqual(norm(viaUi.a, uiGroup));
    expect(norm(viaCommand.b, commandGroup)).toEqual(norm(viaUi.b, uiGroup));
    expect(viaCommand.members).toEqual(viaUi.members);
  });

  it('ungroups the way the Ungroup action does', async () => {
    const { connection, a, b } = await twoRects();
    const base = live().state.document;
    const grouped = await execute(connection, 3, 'varve.node.group', { nodeIds: [a, b] });
    const groupId = grouped?.result.created[0] as string;
    await waitFor(() => expect(live().state.document.nodes[groupId]).toBeDefined());
    expect(newGroupId(live().state.document, base)).toBe(groupId);
    const grouped$ = live().state.document;

    const ungrouped = await execute(connection, 4, 'varve.node.ungroup', { nodeId: groupId });
    expect(ungrouped?.result.outcome).toBe('applied');
    await waitFor(() => expect(live().state.document.nodes[groupId]).toBeUndefined());
    const viaCommand = {
      a: placement(live().state.document, a),
      b: placement(live().state.document, b),
    };

    act(() => {
      live().undo();
    });
    await waitFor(() => expect(live().state.document.nodes[groupId]).toBeDefined());
    expect(live().state.document.nodes[groupId]).toEqual(grouped$.nodes[groupId]);

    act(() => {
      live().setSelectionRefs([groupId]);
    });
    act(() => {
      live().ungroupSelected();
    });
    await waitFor(() => expect(live().state.document.nodes[groupId]).toBeUndefined());
    const viaUi = {
      a: placement(live().state.document, a),
      b: placement(live().state.document, b),
    };
    expect(viaCommand).toEqual(viaUi);
  });
});
