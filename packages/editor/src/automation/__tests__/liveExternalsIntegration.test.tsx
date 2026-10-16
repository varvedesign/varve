/**
 * Save and capture over a real control connection into the real editor.
 *
 * Replaced: the platform (to observe whether a save dialog would open and what
 * would be written) and the pixel renderer (jsdom has no canvas; the real
 * pipeline is exercised in the browser run). Everything else - the provider,
 * the controller, the executor, the protocol - is the production code.
 */
import { act, render, waitFor } from '@testing-library/react';
import type { HostConnection } from '@varve/automation';
import { createMemoryPlatform, type Platform } from '@varve/platform';
import { addNode, type SceneNode } from '@varve/scene';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import {
  loadAutomationController,
  peekAutomationController,
  publishEditorToAutomation,
  resetAutomationControllerForTesting,
} from '../liveEditor';
import type { RenderNode } from '../liveExternals';

type Editor = ReturnType<typeof useEditor>;
const CREDENTIAL = 'externals-secret';
let editor: Editor | undefined;

function Publisher() {
  const ctx = useEditor();
  editor = ctx;
  useEffect(() => {
    publishEditorToAutomation(ctx);
  });
  return null;
}

function live(): Editor {
  if (!editor) throw new Error('editor not mounted');
  return editor;
}

function ctrl() {
  const loaded = peekAutomationController();
  if (!loaded) throw new Error('controller not loaded');
  return loaded;
}

function instrumentedPlatform() {
  const base = createMemoryPlatform();
  const choose = vi.fn(async () => ({ kind: 'cancelled' as const }));
  const write = vi.fn(async () => ({ kind: 'written' as const }));
  const read = vi.fn(async () => ({ ok: true as const, text: '' }));
  const platform: Platform = {
    ...base,
    chooseDocumentSaveTarget: choose,
    writeSaveTarget: write,
    readDocumentText: read,
  };
  return { platform, choose, write, read };
}

async function mount(platform: Platform) {
  render(
    <EditorProvider platform={platform}>
      <Publisher />
    </EditorProvider>,
  );
  await waitFor(() => expect(editor).toBeDefined());
}

async function enable(options: {
  grants: Array<'read' | 'edit' | 'capture' | 'export'>;
  requireApproval: boolean;
  render?: RenderNode;
}) {
  const controller = await loadAutomationController(
    options.render ? { render: options.render } : {},
  );
  controller.setCredential(CREDENTIAL);
  controller.setPolicy({
    enabled: true,
    grants: options.grants,
    requireApproval: options.requireApproval,
  });
  act(() => {
    publishEditorToAutomation(live());
  });
}

async function rpc(connection: HostConnection, id: number, method: string, params: unknown) {
  const line = await connection.handleLine(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  return line === null ? null : (JSON.parse(line) as Record<string, any>);
}

async function connect() {
  const opened = ctrl().openConnection('ipc');
  if (!opened.ok) throw new Error(opened.message);
  await rpc(opened.connection, 0, 'session.hello', {
    credential: CREDENTIAL,
    client: { name: 'externals-test', version: '1' },
    protocolVersions: ['varve.control/1'],
  });
  return opened.connection;
}

const execute = (c: HostConnection, id: number, command: string, args: unknown) =>
  rpc(c, id, 'command.execute', { command, args });

beforeEach(() => {
  editor = undefined;
  resetAutomationControllerForTesting();
});
afterEach(() => resetAutomationControllerForTesting());

describe('varve.document.save over the control channel', () => {
  it('does not open a save dialog for a document nobody has saved', async () => {
    const p = instrumentedPlatform();
    await mount(p.platform);
    await enable({ grants: ['read', 'edit', 'export'], requireApproval: false });
    const c = await connect();
    const r = await execute(c, 1, 'varve.document.save', {});
    expect(r?.result.outcome).toBe('rejected');
    expect(r?.result.error.code).toBe('UNAVAILABLE');
    expect(p.choose).not.toHaveBeenCalled();
    expect(p.write).not.toHaveBeenCalled();
  });

  it('refuses a caller-chosen path in a live session', async () => {
    const p = instrumentedPlatform();
    await mount(p.platform);
    await enable({ grants: ['read', 'edit', 'export'], requireApproval: false });
    act(() => {
      live().openFile('f1', 'Saved', '/work/a.varve', null);
    });
    const c = await connect();
    const r = await execute(c, 1, 'varve.document.save', { path: '/etc/passwd' });
    expect(r?.result.error.code).toBe('PERMISSION_DENIED');
    expect(p.write).not.toHaveBeenCalled();
  });

  it('is held for the person, and writes only where they chose once approved', async () => {
    const p = instrumentedPlatform();
    await mount(p.platform);
    await enable({ grants: ['read', 'edit', 'export'], requireApproval: true });
    act(() => {
      live().openFile('f1', 'Saved', '/work/a.varve', null);
    });
    const c = await connect();

    const pending = execute(c, 1, 'varve.document.save', {});
    await waitFor(() => expect(ctrl().status().pendingApprovals).toHaveLength(1));
    expect(ctrl().status().pendingApprovals[0]?.command).toBe('varve.document.save');
    expect(p.write).not.toHaveBeenCalled();

    ctrl().decide(ctrl().status().pendingApprovals[0]?.receiptId as string, { approved: true });
    const done = await pending;
    expect(done?.result.outcome).toBe('applied');
    expect(p.write).toHaveBeenCalledTimes(1);
    const [target] = p.write.mock.calls[0] as unknown as [{ kind: string; path: string }];
    expect(target).toMatchObject({ kind: 'native-file', path: '/work/a.varve' });
    expect(done?.result.output.path).toBe('/work/a.varve');
    expect(done?.result.durable.saved).toBe(true);
  });

  it('does not save when the person declines', async () => {
    const p = instrumentedPlatform();
    await mount(p.platform);
    await enable({ grants: ['read', 'edit', 'export'], requireApproval: true });
    act(() => {
      live().openFile('f1', 'Saved', '/work/a.varve', null);
    });
    const c = await connect();
    const pending = execute(c, 1, 'varve.document.save', {});
    await waitFor(() => expect(ctrl().status().pendingApprovals).toHaveLength(1));
    ctrl().decide(ctrl().status().pendingApprovals[0]?.receiptId as string, {
      approved: false,
      reason: 'no',
    });
    const done = await pending;
    expect(done?.result.error.code).toBe('PERMISSION_DENIED');
    expect(p.write).not.toHaveBeenCalled();
  });

  it('needs the save permission, which edit does not imply', async () => {
    const p = instrumentedPlatform();
    await mount(p.platform);
    await enable({ grants: ['read', 'edit'], requireApproval: false });
    act(() => {
      live().openFile('f1', 'Saved', '/work/a.varve', null);
    });
    const c = await connect();
    const r = await execute(c, 1, 'varve.document.save', {});
    expect(r?.result.error.code).toBe('PERMISSION_DENIED');
    expect(p.write).not.toHaveBeenCalled();
  });

  it('a read-only client cannot write', async () => {
    const p = instrumentedPlatform();
    await mount(p.platform);
    await enable({ grants: ['read'], requireApproval: false });
    act(() => {
      live().openFile('f1', 'Saved', '/work/a.varve', null);
    });
    const c = await connect();
    const r = await execute(c, 1, 'varve.document.save', {});
    expect(r?.result.error.code).toBe('PERMISSION_DENIED');
    expect(p.write).not.toHaveBeenCalled();
  });
});

describe('varve.capture.node over the control channel', () => {
  const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const renderer: RenderNode = vi.fn(async ({ scale }) => ({
    bytes: PNG,
    width: Math.round(100 * scale),
    height: Math.round(50 * scale),
    scale,
    bounds: { x: 10, y: 20, w: 100, h: 50 },
    warnings: [],
    settled: true,
    backend: 'test-renderer',
  }));

  it('is unavailable without the capture permission, even with edit', async () => {
    const p = instrumentedPlatform();
    await mount(p.platform);
    await enable({ grants: ['read', 'edit'], requireApproval: false, render: renderer });
    const c = await connect();
    const r = await execute(c, 1, 'varve.capture.node', { nodeId: 'anything' });
    expect(r?.result.error.code).toBe('PERMISSION_DENIED');
    expect(renderer).not.toHaveBeenCalled();
  });

  it('captures the revision an edit produced, with no approval prompt once granted', async () => {
    const p = instrumentedPlatform();
    await mount(p.platform);
    // Approval is ON: a capture the person granted by name must not wait on it.
    await enable({ grants: ['read', 'capture'], requireApproval: true, render: renderer });
    const owner = await connect();
    const info = await execute(owner, 1, 'varve.document.info', {});
    expect(info?.result.outcome).toBe('ok');

    // A person draws a rectangle (not an agent), then an agent asks for its pixels.
    const id = 'cap-rect';
    act(() => {
      live().updateDoc((doc) =>
        addNode(doc, {
          id,
          kind: 'shape',
          name: 'Box',
          shape: 'rect',
          x: 0,
          y: 0,
          w: 100,
          h: 50,
        } as unknown as SceneNode),
      );
    });
    await waitFor(() => expect(live().state.document.nodes[id]).toBeDefined());
    const revision = live().readAutomationState().revision;

    const r = await execute(owner, 2, 'varve.capture.node', { nodeId: id, maxDimension: 200 });
    expect(r?.result.outcome).toBe('applied');
    expect(ctrl().status().pendingApprovals).toHaveLength(0);
    const out = r?.result.output;
    expect(out).toMatchObject({
      kind: 'document-pixels',
      nodeId: id,
      revision,
      complete: true,
      backend: 'test-renderer',
      image: { mimeType: 'image/png', bytes: PNG.length },
    });
    expect(Uint8Array.from(atob(out.image.data), (ch) => ch.charCodeAt(0))).toEqual(PNG);
    expect(out.scale).toBeCloseTo(2, 5);
  });

  it('refuses an unknown node before rendering', async () => {
    const p = instrumentedPlatform();
    await mount(p.platform);
    await enable({ grants: ['read', 'capture'], requireApproval: false, render: renderer });
    const c = await connect();
    (renderer as ReturnType<typeof vi.fn>).mockClear();
    const r = await execute(c, 1, 'varve.capture.node', { nodeId: 'nope' });
    expect(r?.result.error.code).toBe('UNKNOWN_TARGET');
    expect(renderer).not.toHaveBeenCalled();
  });
});
