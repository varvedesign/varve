/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react';
import { createDocument } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorState } from '../context/types';
import type { ToolContext } from './types';

const manager = vi.hoisted(() => ({
  activeToolId: 'select' as string,
  setTool: vi.fn((toolId: string) => {
    manager.activeToolId = toolId;
  }),
  getTool: vi.fn(() => null),
}));

vi.mock('../canvas/toolDispatcher', () => ({ getToolManager: () => manager }));

import { useToolManagerSync } from './useToolManagerSync';

afterEach(() => {
  cleanup();
  manager.activeToolId = 'select';
  manager.setTool.mockClear();
  manager.getTool.mockClear();
});

function makeState(activeId: string, tool: EditorState['tool']): EditorState {
  return {
    activeId,
    tool,
    brushSettings: { smoothing: 0 },
    document: { ...createDocument(activeId, true), id: activeId },
  } as EditorState;
}

describe('useToolManagerSync', () => {
  it('leaves crop mode when the active document session changes', () => {
    const editor = {
      updateDoc: vi.fn(),
      setTool: vi.fn(),
      announce: vi.fn(),
    };
    const buildToolCtx = vi.fn(() => ({}) as ToolContext);
    manager.activeToolId = 'crop';

    const { rerender } = renderHook(
      ({ state }) => useToolManagerSync(editor, state, buildToolCtx),
      { initialProps: { state: makeState('first-session', 'crop') } },
    );

    act(() => {
      rerender({ state: makeState('second-session', 'crop') });
    });

    expect(manager.setTool).toHaveBeenLastCalledWith('select', expect.any(Object));
    expect(manager.activeToolId).toBe('select');
    expect(editor.setTool).toHaveBeenCalledWith('select');
  });
});
