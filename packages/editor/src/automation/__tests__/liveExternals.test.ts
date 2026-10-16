import { createDocument } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import type { EditorContextValue } from '../../context';
import { createLiveExternals, type RenderedNode, type RenderNode } from '../liveExternals';

type Session = {
  id: string;
  name: string;
  dirty: boolean;
  filePath?: string;
  fileId?: string;
  libraryStorage?: boolean;
  saveHandleId?: string;
  downloadName?: string;
};

function fakeEditor(
  options: {
    session?: Session | null;
    save?: () => Promise<boolean>;
    revisions?: number[];
    saveIssue?: { message: string } | null;
    document?: ReturnType<typeof createDocument>;
  } = {},
) {
  const document = options.document ?? createDocument('Doc');
  const revisions = [...(options.revisions ?? [3])];
  let last = revisions[0] ?? 3;
  const save = vi.fn(options.save ?? (async () => true));
  const editor = {
    save,
    readAutomationState: () => {
      last = revisions.length > 1 ? (revisions.shift() as number) : (revisions[0] ?? last);
      return {
        document,
        revision: last,
        sessionId: 's1',
        transactionOpen: false,
        session: options.session === undefined ? null : options.session,
        saveIssue: options.saveIssue ?? null,
      };
    },
  } as unknown as EditorContextValue;
  return { editor, save, document };
}

const env = {} as never;

describe('varve.document.save in a live session', () => {
  const run = (editor: EditorContextValue, args: unknown = {}) =>
    createLiveExternals({ editor: () => editor })['varve.document.save']?.(args, env);

  it('never chooses a destination: another path is refused without saving', async () => {
    const t = fakeEditor({
      session: { id: 's1', name: 'A', dirty: true, filePath: '/work/a.varve' },
    });
    const r = await run(t.editor, { path: '/tmp/elsewhere.varve' });
    expect(r).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(t.save).not.toHaveBeenCalled();
  });

  it.each([
    ['has never been saved', null],
    ['has no chosen destination', { id: 's1', name: 'A', dirty: true }],
    ['is download-only', { id: 's1', name: 'A', dirty: true, downloadName: 'a.varve' }],
    [
      'has only a library identity that was never chosen',
      { id: 's1', name: 'A', dirty: true, fileId: 'f1' },
    ],
  ] as const)(
    'refuses, and does not open a save dialog, when the document %s',
    async (_label, session) => {
      const t = fakeEditor({ session: session as Session | null });
      const r = await run(t.editor);
      expect(r).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
      expect((r as { hint?: string }).hint).toContain('Nothing was written');
      expect(t.save).not.toHaveBeenCalled();
    },
  );

  it('refuses a browser file handle, which can need a permission prompt', async () => {
    const t = fakeEditor({ session: { id: 's1', name: 'A', dirty: true, saveHandleId: 'h' } });
    const r = await run(t.editor);
    expect(r).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(t.save).not.toHaveBeenCalled();
  });

  it('saves to the place the person already chose, and reports which revision was written', async () => {
    const t = fakeEditor({
      session: { id: 's1', name: 'A', dirty: true, filePath: '/work/a.varve' },
      revisions: [5],
    });
    const r = await run(t.editor);
    expect(t.save).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({
      ok: true,
      output: { path: '/work/a.varve', revision: 5 },
      durable: { saved: true, path: '/work/a.varve' },
    });
  });

  it('saves a document the person put in the library, naming the library not a path', async () => {
    const t = fakeEditor({
      session: { id: 's1', name: 'A', dirty: true, fileId: 'f9', libraryStorage: true },
    });
    const r = await run(t.editor);
    expect(r).toMatchObject({ ok: true, output: { path: 'varve-library:f9' } });
  });

  it('says so when the document changed during the save, and does not claim it is all saved', async () => {
    const t = fakeEditor({
      session: { id: 's1', name: 'A', dirty: true, filePath: '/work/a.varve' },
      revisions: [5, 6],
    });
    const r = await run(t.editor);
    expect(r).toMatchObject({ ok: true, output: { revision: 5 }, durable: { saved: false } });
    expect((r as { summary: string }).summary).toContain('now revision 6');
  });

  it("reports the editor's own reason when the save fails, and claims nothing was saved", async () => {
    const t = fakeEditor({
      session: { id: 's1', name: 'A', dirty: true, filePath: '/work/a.varve' },
      save: async () => false,
      saveIssue: { message: 'The file changed on disk since it was opened.' },
    });
    const r = await run(t.editor);
    expect(r).toMatchObject({ ok: false });
    expect((r as { message: string }).message).toContain('changed on disk');
  });

  it('is unavailable when the editor is gone', async () => {
    const r = await createLiveExternals({ editor: () => null })['varve.document.save']?.({}, env);
    expect(r).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  });
});

describe('varve.capture.node in a live session', () => {
  function rendered(overrides: Partial<RenderedNode> = {}): RenderedNode {
    return {
      bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      width: 400,
      height: 200,
      scale: 2,
      bounds: { x: 10, y: 20, w: 200, h: 100 },
      warnings: [],
      settled: true,
      backend: 'test-renderer',
      ...overrides,
    };
  }

  function withNode() {
    const document = createDocument('Doc');
    const id = 'n1';
    (document.nodes as Record<string, unknown>)[id] = {
      id,
      kind: 'rect',
      name: 'Box',
      w: 200,
      h: 100,
    };
    return { document, id };
  }

  const args = (nodeId: string, extra: object = {}) => ({
    nodeId,
    maxDimension: 800,
    background: 'white',
    ...extra,
  });

  it('refuses an unknown node before rendering anything', async () => {
    const render = vi.fn<RenderNode>();
    const t = fakeEditor();
    const r = await createLiveExternals({ editor: () => t.editor, render })['varve.capture.node']?.(
      args('missing'),
      env,
    );
    expect(r).toMatchObject({ ok: false, code: 'UNKNOWN_TARGET' });
    expect(render).not.toHaveBeenCalled();
  });

  it('renders the revision it read, reports the later one, and maps pixels to the document', async () => {
    const { document, id } = withNode();
    const t = fakeEditor({ document, revisions: [7, 9] });
    const render = vi.fn<RenderNode>(async () => rendered());
    const r = await createLiveExternals({ editor: () => t.editor, render })['varve.capture.node']?.(
      args(id),
      env,
    );
    expect(r).toMatchObject({ ok: true });
    const out = (r as { output: Record<string, unknown> }).output;
    expect(out).toMatchObject({
      kind: 'document-pixels',
      nodeId: id,
      revision: 7,
      currentRevision: 9,
      complete: true,
      width: 400,
      height: 200,
      scale: 2,
      bounds: { x: 10, y: 20, w: 200, h: 100 },
      background: 'white',
      backend: 'test-renderer',
    });
    const image = out.image as { mimeType: string; bytes: number; data: string };
    expect(image).toMatchObject({ mimeType: 'image/png', bytes: 8 });
    expect(atob(image.data).charCodeAt(1)).toBe(80);
    // The render was handed the one immutable snapshot, not a live reference.
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({ document, nodeId: id, background: 'white' }),
    );
  });

  it('asks for a scale that puts the longest edge at the requested size, never beyond 4x', async () => {
    const { document, id } = withNode();
    const t = fakeEditor({ document });
    const render = vi.fn<RenderNode>(async ({ scale }) =>
      rendered({ scale, width: Math.round(200 * scale), height: Math.round(100 * scale) }),
    );
    const handler = createLiveExternals({ editor: () => t.editor, render })['varve.capture.node'];
    await handler?.(args(id, { maxDimension: 400 }), env);
    expect(render.mock.calls[0]?.[0].scale).toBeCloseTo(2, 5);
    render.mockClear();
    await handler?.(args(id, { maxDimension: 2048 }), env);
    expect(render.mock.calls[0]?.[0].scale).toBe(4);
  });

  it('shrinks and re-renders when effects pushed the image past the requested size', async () => {
    const { document, id } = withNode();
    const t = fakeEditor({ document });
    const render = vi.fn<RenderNode>(async ({ scale }) =>
      rendered({ scale, width: Math.round(260 * scale), height: 120 }),
    );
    const r = await createLiveExternals({ editor: () => t.editor, render })['varve.capture.node']?.(
      args(id, { maxDimension: 400 }),
      env,
    );
    expect(render.mock.calls.length).toBeGreaterThan(1);
    const out = (r as { output: { width: number } }).output;
    expect(out.width).toBeLessThanOrEqual(400);
  });

  it('fails with a limit error, not a truncated image, when it cannot fit', async () => {
    const { document, id } = withNode();
    const t = fakeEditor({ document });
    const render = vi.fn<RenderNode>(async ({ scale }) =>
      rendered({ scale, width: 5000, height: 5000 }),
    );
    const r = await createLiveExternals({ editor: () => t.editor, render })['varve.capture.node']?.(
      args(id),
      env,
    );
    expect(r).toMatchObject({ ok: false, code: 'LIMIT_EXCEEDED' });
    expect(render.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('is honest that unsettled artwork makes the image not final', async () => {
    const { document, id } = withNode();
    const t = fakeEditor({ document });
    const render = vi.fn<RenderNode>(async () =>
      rendered({
        settled: false,
        warnings: ['Export proceeded while 2 image resource(s) were still loading'],
      }),
    );
    const r = await createLiveExternals({ editor: () => t.editor, render })['varve.capture.node']?.(
      args(id),
      env,
    );
    expect(r).toMatchObject({ ok: true, output: { complete: false } });
    expect((r as { summary: string }).summary).toContain('NOT final');
    expect((r as { output: { warnings: string[] } }).output.warnings[0]).toContain('still loading');
  });

  it('does not treat an informational warning as unfinished artwork', async () => {
    const { document, id } = withNode();
    const t = fakeEditor({ document });
    const render = vi.fn<RenderNode>(async () =>
      rendered({ warnings: ['scaled down to fit the raster safety policy'] }),
    );
    const r = await createLiveExternals({ editor: () => t.editor, render })['varve.capture.node']?.(
      args(id),
      env,
    );
    expect(r).toMatchObject({ ok: true, output: { complete: true } });
  });

  it('reports a render failure as unavailable, with nothing changed', async () => {
    const { document, id } = withNode();
    const t = fakeEditor({ document });
    const render = vi.fn<RenderNode>(async () => {
      throw new Error('Font face did not become ready for export: Inter');
    });
    const r = await createLiveExternals({ editor: () => t.editor, render })['varve.capture.node']?.(
      args(id),
      env,
    );
    expect(r).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect((r as { message: string }).message).toContain('Inter');
  });
});
