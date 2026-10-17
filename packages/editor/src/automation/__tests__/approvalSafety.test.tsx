/**
 * An approval is a decision about one specific operation at one specific moment.
 *
 * These run through the real editor and controller, because the property that
 * matters - a decision cannot be replayed, redirected, outlive its document or
 * its moment - is a property of the whole path, not of any one function.
 */
import { act, render, waitFor } from '@testing-library/react';
import type { HostConnection } from '@varve/automation';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import {
  loadAutomationController,
  peekAutomationController,
  publishEditorToAutomation,
  resetAutomationControllerForTesting,
} from '../liveEditor';

type Editor = ReturnType<typeof useEditor>;
const CREDENTIAL = 'approval-secret';
let editor: Editor | undefined;

function Publisher() {
  const ctx = useEditor();
  editor = ctx;
  useEffect(() => {
    publishEditorToAutomation(ctx);
  });
  return null;
}

const live = (): Editor => {
  if (!editor) throw new Error('editor not mounted');
  return editor;
};
const ctrl = () => {
  const c = peekAutomationController();
  if (!c) throw new Error('controller not loaded');
  return c;
};

async function setup(approvalTimeoutMs?: number) {
  render(
    <EditorProvider>
      <Publisher />
    </EditorProvider>,
  );
  await waitFor(() => expect(editor).toBeDefined());
  const controller = await loadAutomationController(
    approvalTimeoutMs === undefined ? {} : { approvalTimeoutMs },
  );
  controller.setCredential(CREDENTIAL);
  controller.setPolicy({ enabled: true, grants: ['read', 'edit'], requireApproval: true });
  act(() => {
    publishEditorToAutomation(live());
  });
}

async function rpc(c: HostConnection, id: number, method: string, params: unknown) {
  const line = await c.handleLine(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  return line === null ? null : (JSON.parse(line) as Record<string, any>);
}

async function connect(): Promise<HostConnection> {
  const opened = ctrl().openConnection('ipc');
  if (!opened.ok) throw new Error(opened.message);
  await rpc(opened.connection, 0, 'session.hello', {
    credential: CREDENTIAL,
    client: { name: 'approval-test', version: '1' },
    protocolVersions: ['varve.control/1'],
  });
  return opened.connection;
}

const create = (c: HostConnection, id: number, x: number) =>
  rpc(c, id, 'command.execute', {
    command: 'varve.node.create',
    args: { kind: 'rect', x, y: 0, width: 10, height: 10 },
  });

const shapes = () =>
  Object.values(live().state.document.nodes).filter((n) => n.kind === 'shape').length;

beforeEach(() => {
  editor = undefined;
  resetAutomationControllerForTesting();
});
afterEach(() => resetAutomationControllerForTesting());

describe('approvals cannot be replayed, redirected or kept', () => {
  it('a decision is single-use: the second one answers false and changes nothing', async () => {
    await setup();
    const c = await connect();
    const pending = create(c, 1, 1);
    await waitFor(() => expect(ctrl().status().pendingApprovals).toHaveLength(1));
    const id = ctrl().status().pendingApprovals[0]?.receiptId as string;

    expect(ctrl().decide(id, { approved: true })).toBe(true);
    expect((await pending)?.result.outcome).toBe('applied');
    expect(shapes()).toBe(1);

    expect(ctrl().decide(id, { approved: true })).toBe(false);
    expect(shapes()).toBe(1);
  });

  it('an unknown or forged receipt id approves nothing', async () => {
    await setup();
    const c = await connect();
    const pending = create(c, 1, 1);
    await waitFor(() => expect(ctrl().status().pendingApprovals).toHaveLength(1));
    for (const forged of ['', 'r1', 'receipt-0', '__proto__', 'constructor', 'toString']) {
      expect(ctrl().decide(forged, { approved: true }), forged).toBe(false);
    }
    expect(shapes()).toBe(0);
    ctrl().decide(ctrl().status().pendingApprovals[0]?.receiptId as string, {
      approved: false,
      reason: 'cleanup',
    });
    await pending;
  });

  it('approving one held change does not approve another', async () => {
    await setup();
    const c = await connect();
    const first = create(c, 1, 1);
    const second = create(c, 2, 2);
    await waitFor(() => expect(ctrl().status().pendingApprovals.length).toBeGreaterThanOrEqual(1));
    // Pipelined requests are handled in order, so the second is not held until
    // the first is decided. Decide the first; then the second appears.
    const firstId = ctrl().status().pendingApprovals[0]?.receiptId as string;
    ctrl().decide(firstId, { approved: true });
    expect((await first)?.result.outcome).toBe('applied');
    await waitFor(() => expect(ctrl().status().pendingApprovals).toHaveLength(1));
    const secondId = ctrl().status().pendingApprovals[0]?.receiptId as string;
    expect(secondId).not.toBe(firstId);
    // The id that was already used cannot approve the new one.
    expect(ctrl().decide(firstId, { approved: true })).toBe(false);
    expect(shapes()).toBe(1);
    ctrl().decide(secondId, { approved: false, reason: 'no' });
    expect((await second)?.result.error.code).toBe('PERMISSION_DENIED');
    expect(shapes()).toBe(1);
  });

  it('an approval that nobody answers expires, and a late answer is too late', async () => {
    await setup(600);
    const c = await connect();
    const pending = create(c, 1, 1);
    await waitFor(() => expect(ctrl().status().pendingApprovals).toHaveLength(1));
    const id = ctrl().status().pendingApprovals[0]?.receiptId as string;
    const refused = await pending;
    expect(refused?.result.error.code).toBe('PERMISSION_DENIED');
    expect(refused?.result.error.message).toMatch(/in time|answered/i);
    expect(ctrl().status().pendingApprovals).toHaveLength(0);
    expect(ctrl().decide(id, { approved: true })).toBe(false);
    expect(shapes()).toBe(0);
  });

  it('does not apply a held change after a person edited the document in the meantime', async () => {
    await setup();
    const c = await connect();
    const pending = create(c, 1, 1);
    await waitFor(() => expect(ctrl().status().pendingApprovals).toHaveLength(1));
    const id = ctrl().status().pendingApprovals[0]?.receiptId as string;

    act(() => {
      live().updateDoc((doc) => ({ ...doc, name: 'A person got there first' }));
    });
    await waitFor(() => expect(live().state.document.name).toBe('A person got there first'));

    ctrl().decide(id, { approved: true });
    const result = await pending;
    expect(result?.result.outcome).toBe('rejected');
    expect(result?.result.error.message).toContain('while waiting for approval');
    expect(shapes()).toBe(0);
    expect(live().state.document.name).toBe('A person got there first');
  });

  it('a held change dies with its document session and cannot be approved afterwards', async () => {
    await setup();
    const c = await connect();
    const pending = create(c, 1, 1);
    await waitFor(() => expect(ctrl().status().pendingApprovals).toHaveLength(1));
    const id = ctrl().status().pendingApprovals[0]?.receiptId as string;
    const oldDocument = live().state.document.id;

    act(() => {
      live().newDocument();
    });
    await waitFor(() => expect(live().state.document.id).not.toBe(oldDocument));
    act(() => {
      publishEditorToAutomation(live());
    });

    expect(ctrl().status().pendingApprovals).toHaveLength(0);
    expect(ctrl().decide(id, { approved: true })).toBe(false);
    const result = await pending;
    expect(result === null || result.result.outcome !== 'applied').toBe(true);
    expect(shapes()).toBe(0);
  });

  it('turning automation off refuses everything held', async () => {
    await setup();
    const c = await connect();
    const pending = create(c, 1, 1);
    await waitFor(() => expect(ctrl().status().pendingApprovals).toHaveLength(1));
    ctrl().setPolicy({ enabled: false, grants: ['read'], requireApproval: true });
    expect(ctrl().status().pendingApprovals).toHaveLength(0);
    const result = await pending;
    expect(result === null || result.result.outcome !== 'applied').toBe(true);
    expect(shapes()).toBe(0);
  });

  it('pausing withdraws what is waiting, so answering the prompt later cannot apply it', async () => {
    await setup();
    const c = await connect();
    const pending = create(c, 1, 1);
    await waitFor(() => expect(ctrl().status().pendingApprovals).toHaveLength(1));
    const id = ctrl().status().pendingApprovals[0]?.receiptId as string;

    ctrl().pause();
    expect(ctrl().status().pendingApprovals).toHaveLength(0);
    expect(ctrl().decide(id, { approved: true })).toBe(false);
    const result = await pending;
    expect(result?.result.outcome).toBe('rejected');
    expect(result?.result.error.message).toContain('paused');
    expect(shapes()).toBe(0);
  });

  it('disconnecting an agent withdraws only what that agent was waiting to do', async () => {
    await setup();
    const doomed = await connect();
    const kept = await connect();
    const doomedWork = create(doomed, 1, 1);
    const keptWork = create(kept, 1, 2);
    await waitFor(() => expect(ctrl().status().pendingApprovals).toHaveLength(2));

    const pendingFor = (label: string) =>
      ctrl()
        .status()
        .pendingApprovals.filter((a) => a.principal.id === label);
    const principals = ctrl()
      .status()
      .host?.connections.map((c) => c.principalId) as string[];
    const doomedId = principals[0] as string;
    const doomedHeld = ctrl()
      .status()
      .pendingApprovals.find((a) => a.principal.id === doomedId);
    expect(doomedHeld).toBeDefined();

    expect(ctrl().revoke(doomedId)).toBe(1);
    expect(pendingFor(doomedId)).toHaveLength(0);
    expect(ctrl().decide(doomedHeld?.receiptId as string, { approved: true })).toBe(false);
    expect((await doomedWork)?.result.outcome).toBe('rejected');
    expect(shapes()).toBe(0);

    // The other agent's request is untouched and still needs its own decision.
    expect(ctrl().status().pendingApprovals).toHaveLength(1);
    const keptId = ctrl().status().pendingApprovals[0]?.receiptId as string;
    expect(ctrl().decide(keptId, { approved: true })).toBe(true);
    expect((await keptWork)?.result.outcome).toBe('applied');
    expect(shapes()).toBe(1);
  });
});
