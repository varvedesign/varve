import {
  addNode,
  createComponent,
  createDocument,
  makeFrameNode,
  makeShapeNode,
} from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import type { EditorContextValue } from '../context';
import { buildCanvasContextMenuItems } from './canvasContextMenu';

describe('canvas component menu', () => {
  it('creates a component from one selected frame and closes the menu', () => {
    let document = createDocument('component menu', true);
    document = addNode(document, makeFrameNode('frame-1', { name: 'Button' }));
    const createComponentFromFrame = vi.fn();
    const recordAction = vi.fn();
    const closeMenu = vi.fn();
    const editor = {
      state: { document, selection: ['frame-1'] },
      createComponentFromFrame,
      recordAction,
    } as unknown as EditorContextValue;

    const items = buildCanvasContextMenuItems({ editor, closeMenu });
    const action = items.find((item) => 'label' in item && item.label === 'Create Component');
    expect(action && 'onAction' in action).toBe(true);
    if (!action || !('onAction' in action)) throw new Error('Create Component action missing');

    action.onAction();

    expect(createComponentFromFrame).toHaveBeenCalledWith('Button', 'frame-1', []);
    expect(recordAction).toHaveBeenCalledWith('menu:create-component');
    expect(closeMenu).toHaveBeenCalledOnce();
  });

  it('does not offer component creation for a non-frame selection', () => {
    let document = createDocument('shape menu', true);
    document = addNode(
      document,
      makeShapeNode('shape-1', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }),
    );
    const editor = {
      state: { document, selection: ['shape-1'] },
      createComponentFromFrame: vi.fn(),
      recordAction: vi.fn(),
    } as unknown as EditorContextValue;

    const items = buildCanvasContextMenuItems({ editor, closeMenu: vi.fn() });

    expect(items.some((item) => 'label' in item && item.label === 'Create Component')).toBe(false);
  });

  it('does not offer component creation for an existing master frame', () => {
    let document = createDocument('existing master menu', true);
    document = addNode(document, makeFrameNode('frame-1', { name: 'Button' }));
    document = createComponent(document, 'Button', 'frame-1', []).doc;
    const editor = {
      state: { document, selection: ['frame-1'] },
      createComponentFromFrame: vi.fn(),
      recordAction: vi.fn(),
    } as unknown as EditorContextValue;

    const items = buildCanvasContextMenuItems({ editor, closeMenu: vi.fn() });

    expect(items.some((item) => 'label' in item && item.label === 'Create Component')).toBe(false);
  });

  it('does not offer component creation for a component instance frame', () => {
    let document = createDocument('component instance menu', true);
    document = addNode(
      document,
      makeFrameNode('instance-1', { name: 'Button instance', componentId: 'component-1' }),
    );
    const editor = {
      state: { document, selection: ['instance-1'] },
      createComponentFromFrame: vi.fn(),
      recordAction: vi.fn(),
    } as unknown as EditorContextValue;

    const items = buildCanvasContextMenuItems({ editor, closeMenu: vi.fn() });

    expect(items.some((item) => 'label' in item && item.label === 'Create Component')).toBe(false);
  });
});
