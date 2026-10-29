// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDocument, makeFrameNode, makeShapeNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useEditor: vi.fn(),
}));

vi.mock('../../../context', () => ({
  useEditor: mocks.useEditor,
}));

import { MaskSection } from './MaskSection';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function createMockEditor(doc: any) {
  return {
    state: {
      document: doc,
      sectionVisibility: { mask: { collapsed: false } },
    },
    addMaskToSelected: vi.fn(),
    removeMaskFromSelected: vi.fn(),
    toggleMask: vi.fn(),
    invertMask: vi.fn(),
    setMaskFeather: vi.fn(),
    setMaskDensity: vi.fn(),
    setMaskHideSource: vi.fn(),
    setMaskLinked: vi.fn(),
    setMaskType: vi.fn(),
    setMaskFillRule: vi.fn(),
    announce: vi.fn(),
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    abortTransaction: vi.fn(),
  };
}

/** A masked frame with the children a clip mask needs. */
function maskedFrame() {
  const doc = createDocument('test doc');
  const child1 = makeShapeNode('child-1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
  const child2 = makeShapeNode('child-2', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
  doc.nodes['child-1'] = child1;
  doc.nodes['child-2'] = child2;
  const frame = makeFrameNode('frame-1', { children: ['child-1', 'child-2'] });
  frame.mask = { type: 'clip', visible: true, inverted: false, sourceNodeId: 'child-1' };
  doc.nodes['frame-1'] = frame;
  return { doc, frame };
}

describe('MaskSection', () => {
  it('renders active mask card with visibility, invert, and remove actions', () => {
    const doc = createDocument('test doc');
    const editor = createMockEditor(doc);
    mocks.useEditor.mockReturnValue(editor);

    const frame = makeFrameNode('frame-1', {
      children: ['child-1', 'child-2'],
    });
    frame.mask = {
      type: 'clip',
      visible: true,
      inverted: false,
      sourceNodeId: 'child-1',
    };

    render(<MaskSection nodes={[frame]} />);

    expect(screen.getByText('Clip mask')).toBeInTheDocument();

    const toggleBtn = screen.getByRole('button', { name: 'Disable mask' });
    expect(toggleBtn).toBeInTheDocument();
    fireEvent.click(toggleBtn);
    expect(editor.toggleMask).toHaveBeenCalledTimes(1);

    const invertBtn = screen.getByRole('button', { name: 'Enable inversion' });
    expect(invertBtn).toBeInTheDocument();
    fireEvent.click(invertBtn);
    expect(editor.invertMask).toHaveBeenCalledTimes(1);

    const removeBtn = screen.getByRole('button', { name: 'Remove mask' });
    expect(removeBtn).toBeInTheDocument();
    fireEvent.click(removeBtn);
    expect(editor.removeMaskFromSelected).toHaveBeenCalledTimes(1);
  });

  it('renders creation buttons when eligible container has no mask', () => {
    const doc = createDocument('test doc');
    const editor = createMockEditor(doc);
    mocks.useEditor.mockReturnValue(editor);

    const child1 = makeShapeNode('child-1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    const child2 = makeShapeNode('child-2', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    doc.nodes['child-1'] = child1;
    doc.nodes['child-2'] = child2;

    const frame = makeFrameNode('frame-1', {
      children: ['child-1', 'child-2'],
    });
    doc.nodes['frame-1'] = frame;

    render(<MaskSection nodes={[frame]} />);

    expect(screen.getByRole('group', { name: 'Add mask' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add clip mask' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add alpha mask' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add luminance mask' })).toBeEnabled();
  });

  it('coalesces a density slider drag into one undo entry', () => {
    const { doc, frame } = maskedFrame();
    const editor = createMockEditor(doc);
    mocks.useEditor.mockReturnValue(editor);

    render(<MaskSection nodes={[frame]} />);
    const slider = screen.getByRole('slider', { name: 'Mask density' });

    // A real drag: one pointerdown, many intermediate values, one pointerup.
    fireEvent.pointerDown(slider, { button: 0, pointerId: 1 });
    for (const value of ['0.9', '0.8', '0.7', '0.6', '0.5']) {
      fireEvent.change(slider, { target: { value } });
    }
    fireEvent.pointerUp(slider, { button: 0, pointerId: 1 });

    expect(editor.setMaskDensity).toHaveBeenCalledTimes(5);
    expect(editor.beginTransaction).toHaveBeenCalledTimes(1);
    expect(editor.commitTransaction).toHaveBeenCalledTimes(1);
    expect(editor.abortTransaction).not.toHaveBeenCalled();
  });

  it('coalesces a keyboard density burst into one undo entry', () => {
    const { doc, frame } = maskedFrame();
    const editor = createMockEditor(doc);
    mocks.useEditor.mockReturnValue(editor);

    render(<MaskSection nodes={[frame]} />);
    const slider = screen.getByRole('slider', { name: 'Mask density' });

    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyUp(slider, { key: 'ArrowLeft' });

    expect(editor.beginTransaction).toHaveBeenCalledTimes(1);
    expect(editor.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('leaves the undo stack untouched when the slider is only clicked, not moved', () => {
    const { doc, frame } = maskedFrame();
    const editor = createMockEditor(doc);
    mocks.useEditor.mockReturnValue(editor);

    render(<MaskSection nodes={[frame]} />);
    const slider = screen.getByRole('slider', { name: 'Mask density' });

    fireEvent.pointerDown(slider, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(slider, { button: 0, pointerId: 1 });

    // The gesture still opens and closes exactly one transaction; the editor
    // drops empty transactions, so a click that changes nothing is not an
    // undo step.
    expect(editor.beginTransaction).toHaveBeenCalledTimes(1);
    expect(editor.commitTransaction).toHaveBeenCalledTimes(1);
  });
});
