import { fireEvent, render } from '@testing-library/react';
import type { Guide } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { GuideOverlay } from './GuideOverlay';

vi.mock('../../canvas/cameraState', () => ({
  editorScreenToWorld: (_camera: unknown, x: number, y: number) => [x, y],
  editorWorldToScreen: (_camera: unknown, x: number, y: number) => [x, y],
  getEditorViewport: () => ({ width: 800, height: 600 }),
}));

function setRect(
  element: Element,
  rect: { left: number; top: number; width: number; height: number },
) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      ...rect,
      x: rect.left,
      y: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON: () => rect,
    }),
  });
}

function renderGuide(guide: Guide, onDuplicateGuide = vi.fn(() => `${guide.id}-copy`)) {
  const onRemoveGuide = vi.fn();
  const onMoveGuide = vi.fn();
  const onToggleLock = vi.fn();
  const onSelectGuide = vi.fn();
  const view = render(
    <>
      <div className="ruler-top-wrapper" />
      <div className="ruler-left-wrapper" />
      <GuideOverlay
        guides={[guide]}
        zoom={1}
        pan={{ x: 0, y: 0 }}
        onMoveGuide={onMoveGuide}
        onRemoveGuide={onRemoveGuide}
        onToggleLock={onToggleLock}
        onDuplicateGuide={onDuplicateGuide}
        onSelectGuide={onSelectGuide}
      />
    </>,
  );
  const topRuler = view.container.querySelector('.ruler-top-wrapper')!;
  const leftRuler = view.container.querySelector('.ruler-left-wrapper')!;
  const overlay = view.container.querySelector('.guide-overlay')!;
  setRect(topRuler, { left: 20, top: 0, width: 780, height: 20 });
  setRect(leftRuler, { left: 0, top: 20, width: 20, height: 580 });
  setRect(overlay, { left: 0, top: 0, width: 800, height: 600 });
  const hitArea = view.container.querySelector('.guide-overlay__hit-area')!;
  Object.defineProperty(hitArea, 'setPointerCapture', { value: vi.fn(), configurable: true });
  const renderGuides = (guides: Guide[]) =>
    view.rerender(
      <>
        <div className="ruler-top-wrapper" />
        <div className="ruler-left-wrapper" />
        <GuideOverlay
          guides={guides}
          zoom={1}
          pan={{ x: 0, y: 0 }}
          onMoveGuide={onMoveGuide}
          onRemoveGuide={onRemoveGuide}
          onToggleLock={onToggleLock}
          onDuplicateGuide={onDuplicateGuide}
          onSelectGuide={onSelectGuide}
        />
      </>,
    );
  return {
    ...view,
    hitArea,
    onMoveGuide,
    onRemoveGuide,
    onSelectGuide,
    onDuplicateGuide,
    renderGuides,
  };
}

describe('guide pointer button ownership', () => {
  it('leaves non-primary pointer buttons available to canvas gestures', () => {
    const { hitArea, onSelectGuide } = renderGuide({
      id: 'guide-1',
      axis: 'vertical',
      position: 120,
      locked: false,
    });
    const capture = (hitArea as HTMLElement & { setPointerCapture: ReturnType<typeof vi.fn> })
      .setPointerCapture;

    fireEvent.pointerDown(hitArea, {
      pointerId: 1,
      button: 1,
      clientX: 120,
      clientY: 100,
    });

    expect(onSelectGuide).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });
});

describe('guide ruler deletion', () => {
  it('emphasizes the guide while its pointer drag is active', () => {
    const { hitArea, container, rerender } = renderGuide({
      id: 'guide-v',
      axis: 'vertical',
      position: 120,
    });
    const line = container.querySelector('.guide-overlay__line')!;

    expect(line.getAttribute('stroke-width')).toBe('1');
    fireEvent.pointerDown(hitArea, { pointerId: 1, button: 0, clientX: 120, clientY: 100 });
    rerender(
      <>
        <div className="ruler-top-wrapper" />
        <div className="ruler-left-wrapper" />
        <GuideOverlay
          guides={[{ id: 'guide-v', axis: 'vertical', position: 120 }]}
          zoom={1}
          pan={{ x: 0, y: 0 }}
          onMoveGuide={vi.fn()}
          onRemoveGuide={vi.fn()}
          onToggleLock={vi.fn()}
        />
      </>,
    );

    expect(container.querySelector('.guide-overlay__line')?.getAttribute('stroke-width')).toBe('2');
  });

  it('removes an unlocked vertical guide when released on the top ruler', () => {
    const { hitArea, onRemoveGuide } = renderGuide({
      id: 'guide-v',
      axis: 'vertical',
      position: 120,
    });

    fireEvent.pointerDown(hitArea, { pointerId: 1, button: 0, clientX: 120, clientY: 100 });
    fireEvent.pointerUp(hitArea, { pointerId: 1, clientX: 120, clientY: 10 });

    expect(onRemoveGuide).toHaveBeenCalledOnce();
    expect(onRemoveGuide).toHaveBeenCalledWith('guide-v');
  });

  it('removes an unlocked horizontal guide when released on the left ruler', () => {
    const { hitArea, onRemoveGuide } = renderGuide({
      id: 'guide-h',
      axis: 'horizontal',
      position: 120,
    });

    fireEvent.pointerDown(hitArea, { pointerId: 1, button: 0, clientX: 100, clientY: 120 });
    fireEvent.pointerUp(hitArea, { pointerId: 1, clientX: 10, clientY: 120 });

    expect(onRemoveGuide).toHaveBeenCalledWith('guide-h');
  });

  it('keeps the guide when it is released outside its ruler', () => {
    const { hitArea, onRemoveGuide } = renderGuide({
      id: 'guide-v',
      axis: 'vertical',
      position: 120,
    });

    fireEvent.pointerDown(hitArea, { pointerId: 1, button: 0, clientX: 120, clientY: 100 });
    fireEvent.pointerUp(hitArea, { pointerId: 1, clientX: 300, clientY: 200 });

    expect(onRemoveGuide).not.toHaveBeenCalled();
  });

  it('does not remove locked guides when released on a ruler', () => {
    const { hitArea, onRemoveGuide } = renderGuide({
      id: 'locked-v',
      axis: 'vertical',
      position: 120,
      locked: true,
    });

    fireEvent.pointerDown(hitArea, { pointerId: 1, button: 0, clientX: 120, clientY: 100 });
    fireEvent.pointerUp(hitArea, { pointerId: 1, clientX: 120, clientY: 10 });

    expect(onRemoveGuide).not.toHaveBeenCalled();
  });

  it('does not remove a guide when its pointer drag is cancelled on a ruler', () => {
    const { hitArea, onRemoveGuide } = renderGuide({
      id: 'guide-v',
      axis: 'vertical',
      position: 120,
    });

    fireEvent.pointerDown(hitArea, { pointerId: 1, button: 0, clientX: 120, clientY: 100 });
    fireEvent.pointerCancel(hitArea, { pointerId: 1, clientX: 120, clientY: 10 });

    expect(onRemoveGuide).not.toHaveBeenCalled();
  });

  it('ignores a ruler release from a different pointer identity', () => {
    const { hitArea, onRemoveGuide } = renderGuide({
      id: 'guide-v',
      axis: 'vertical',
      position: 120,
    });

    fireEvent.pointerDown(hitArea, { pointerId: 1, button: 0, clientX: 120, clientY: 100 });
    fireEvent.pointerUp(hitArea, { pointerId: 2, clientX: 120, clientY: 10 });

    expect(onRemoveGuide).not.toHaveBeenCalled();
    fireEvent.pointerUp(hitArea, { pointerId: 1, clientX: 120, clientY: 10 });
    expect(onRemoveGuide).toHaveBeenCalledWith('guide-v');
  });

  it('completes an Alt-duplicate drag captured by the original guide', () => {
    const original: Guide = { id: 'guide-v', axis: 'vertical', position: 120 };
    const duplicate: Guide = { id: 'guide-v-copy', axis: 'vertical', position: 160 };
    const { hitArea, container, renderGuides, onDuplicateGuide, onMoveGuide } =
      renderGuide(original);

    fireEvent.pointerDown(hitArea, {
      pointerId: 1,
      button: 0,
      altKey: true,
      clientX: 120,
      clientY: 100,
    });
    fireEvent.pointerMove(hitArea, { pointerId: 1, clientX: 160, clientY: 100 });
    expect(onDuplicateGuide).toHaveBeenCalledWith('guide-v', 160);

    renderGuides([original, duplicate]);
    const hitAreas = container.querySelectorAll('.guide-overlay__hit-area');
    fireEvent.pointerMove(hitAreas[0]!, { pointerId: 1, clientX: 190, clientY: 100 });
    expect(onMoveGuide).toHaveBeenCalledWith('guide-v-copy', 190);

    fireEvent.pointerUp(hitAreas[0]!, { pointerId: 1, clientX: 160, clientY: 100 });
    fireEvent.pointerMove(container.querySelector('.guide-overlay')!, {
      pointerId: 1,
      clientX: 160,
      clientY: 100,
    });

    const lines = container.querySelectorAll('.guide-overlay__line');
    expect(lines[1]?.getAttribute('stroke-width')).toBe('2');
  });
});
