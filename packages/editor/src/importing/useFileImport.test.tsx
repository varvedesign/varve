// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { type ImportFileInput, type ImportReport, ImportService } from '@varve/import';
import { addNode, createDocument, makeFrameNode, makeShapeNode } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileImportEditor } from './useFileImport';
import { useFileImport } from './useFileImport';

function reportFor(name: string): ImportReport {
  let document = createDocument(`${name} source`, true);
  const node = makeShapeNode(`${name}-root`, {
    kind: 'rect',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
  });
  document = addNode(document, node);
  return {
    startedAt: 0,
    completedAt: 1,
    durationMs: 1,
    totalFiles: 1,
    successCount: 1,
    partialCount: 0,
    failureCount: 0,
    unsupportedCount: 0,
    files: [
      {
        name,
        source: 'file-picker',
        format: 'svg',
        status: 'success',
        byteCount: 10,
        durationMs: 1,
        nodeCount: 1,
        artifacts: [{ kind: 'document-fragment', document, nodeIds: [node.id] }],
        warnings: [],
        unsupportedFeatures: [],
      },
    ],
    warnings: [],
  };
}

function editorFixture(): FileImportEditor {
  const document = createDocument('destination');
  return {
    state: {
      document,
      activeId: 'session',
      revision: 0,
      selectionRevision: 0,
      selection: [],
      workspaceMode: 'print',
      zoom: 1,
      pan: { x: 0, y: 0 },
      cameraRotation: 0,
    },
    announce: vi.fn(),
    addLutAdjustment: vi.fn(),
    batchImportNodes: vi.fn(),
    commitPreparedFragment: vi.fn(() => ['committed-root']),
  };
}

describe('useFileImport operation ownership', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'FileReader',
      class {
        result: ArrayBuffer | string | null = null;
        error: DOMException | null = null;
        onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
        onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
        onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;
        private aborted = false;

        readAsArrayBuffer(file: Blob) {
          void file.arrayBuffer().then((result) => {
            if (this.aborted) return;
            this.result = result;
            this.onload?.({} as ProgressEvent<FileReader>);
          });
        }

        abort() {
          this.aborted = true;
          this.onabort?.({} as ProgressEvent<FileReader>);
        }
      },
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('captures the picker destination before the browser file dialog opens', async () => {
    vi.spyOn(ImportService, 'importFiles').mockResolvedValue(reportFor('picked.svg'));
    const editor = editorFixture();
    const frame = makeFrameNode('destination-frame', {
      name: 'Destination',
      transform: [1, 0, 0, 1, 300, 200],
      w: 100,
      h: 80,
      children: [],
    });
    editor.state.document = addNode(editor.state.document, frame);
    editor.state.selection = [frame.id];

    const { result } = renderHook(() => useFileImport(editor));
    const click = vi.fn();
    result.current.inputRef.current = { click } as unknown as HTMLInputElement;

    act(() => result.current.openPicker());
    expect(click).toHaveBeenCalledTimes(1);

    // Camera changes while the native picker is open must not change the
    // placement captured by the initiating gesture.
    editor.state.pan = { x: 900, y: -400 };
    editor.state.zoom = 4;
    const event = {
      target: {
        files: [new File(['picked'], 'picked.svg', { type: 'image/svg+xml' })],
        value: '',
      },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.onFilesSelected(event);
    });

    expect(editor.commitPreparedFragment).toHaveBeenCalledWith(
      expect.objectContaining({
        targetParentId: frame.id,
        center: { x: 350, y: 240 },
      }),
    );
  });

  it('lets a newer picker gesture commit while an older decode settles late', async () => {
    const pending: Array<{
      resolve: (report: ImportReport) => void;
      signal?: AbortSignal;
    }> = [];
    const importSpy = vi
      .spyOn(ImportService, 'importFiles')
      .mockImplementation(
        (_inputs, _options, signal) =>
          new Promise<ImportReport>((resolve) => pending.push({ resolve, signal })),
      );
    const editor = editorFixture();
    const { result } = renderHook(() => useFileImport(editor));
    const firstEvent = {
      target: {
        files: [new File(['first'], 'first.svg', { type: 'image/svg+xml' })],
        value: '',
      },
    } as unknown as React.ChangeEvent<HTMLInputElement>;
    const secondEvent = {
      target: {
        files: [new File(['second'], 'second.svg', { type: 'image/svg+xml' })],
        value: '',
      },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    let firstRun!: Promise<void>;
    act(() => {
      firstRun = result.current.onFilesSelected(firstEvent);
    });
    await waitFor(() => expect(importSpy).toHaveBeenCalledTimes(1));

    let secondRun!: Promise<void>;
    act(() => {
      secondRun = result.current.onFilesSelected(secondEvent);
    });
    await waitFor(() => expect(importSpy).toHaveBeenCalledTimes(2));
    expect(pending[0]?.signal?.aborted).toBe(true);

    await act(async () => {
      pending[1]!.resolve(reportFor('second.svg'));
      await secondRun;
    });
    await act(async () => {
      pending[0]!.resolve(reportFor('first.svg'));
      await firstRun;
    });

    expect(editor.commitPreparedFragment).toHaveBeenCalledTimes(1);
    expect(editor.announce).toHaveBeenCalledWith('Imported 1 file; 0 failed');
  });

  it('reports file preparation separately from importer progress', async () => {
    let resolveBytes!: (value: ArrayBuffer) => void;
    const file = new File(['picked'], 'picked.svg', { type: 'image/svg+xml' });
    vi.spyOn(file, 'arrayBuffer').mockImplementation(
      () => new Promise<ArrayBuffer>((resolve) => (resolveBytes = resolve)),
    );
    let resolveImport!: (report: ImportReport) => void;
    let onProgress:
      | ((completed: number, total: number, file: ImportReport['files'][number]) => void)
      | undefined;
    let onFileStart: ((file: ImportFileInput, index: number) => void) | undefined;
    const importSpy = vi
      .spyOn(ImportService, 'importFiles')
      .mockImplementation((_files, options) => {
        onFileStart = options?.onFileStart;
        onProgress = options?.onProgress;
        return new Promise<ImportReport>((resolve) => (resolveImport = resolve));
      });
    const { result } = renderHook(() => useFileImport(editorFixture()));
    const event = {
      target: { files: [file], value: '' },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    let run!: Promise<void>;
    act(() => {
      run = result.current.onFilesSelected(event);
    });
    await waitFor(() =>
      expect(result.current.progress).toMatchObject({
        stage: 'preparing',
        current: 0,
        total: 1,
      }),
    );

    await act(async () => {
      resolveBytes(new ArrayBuffer(6));
      await waitFor(() => expect(importSpy).toHaveBeenCalledTimes(1));
    });
    expect(result.current.progress).toMatchObject({ stage: 'importing', current: 0, total: 1 });
    act(() =>
      onFileStart?.(
        { name: 'picked.svg', source: 'file-picker', size: 6, bytes: new Uint8Array(6) },
        0,
      ),
    );
    expect(result.current.progress).toMatchObject({
      stage: 'importing',
      current: 0,
      activeFileNames: ['picked.svg'],
    });
    act(() => onProgress?.(1, 1, reportFor('picked.svg').files[0]!));
    expect(result.current.progress).toMatchObject({
      stage: 'importing',
      current: 1,
      activeFileNames: [],
      fileName: 'picked.svg',
    });

    await act(async () => {
      resolveImport(reportFor('picked.svg'));
      await run;
    });
    expect(result.current.progress).toBeNull();
  });

  it('cancels a pending file read promptly without starting the importer', async () => {
    const file = new File(['picked'], 'picked.svg', { type: 'image/svg+xml' });
    vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise<ArrayBuffer>(() => {}));
    const importSpy = vi.spyOn(ImportService, 'importFiles');
    const { result } = renderHook(() => useFileImport(editorFixture()));
    const event = {
      target: { files: [file], value: '' },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    let run!: Promise<void>;
    act(() => {
      run = result.current.onFilesSelected(event);
    });
    await waitFor(() => expect(result.current.progress?.stage).toBe('preparing'));
    act(() => result.current.cancel());
    await act(async () => run);

    expect(importSpy).not.toHaveBeenCalled();
    expect(result.current.progress).toBeNull();
  });
});
