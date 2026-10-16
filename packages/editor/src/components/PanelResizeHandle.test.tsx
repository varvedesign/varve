// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBuiltinPanels } from '../workspace/panelDefinitions';
import { resetPanelRegistry, tryGetPanelDefinition } from '../workspace/panelRegistry';
import {
  defaultPanelWidth,
  PanelResizeHandle,
  panelLimits,
  resolveDisplayWidths,
} from './PanelResizeHandle';

beforeEach(() => {
  resetPanelRegistry();
  registerBuiltinPanels();
});

describe('resolveDisplayWidths', () => {
  it('returns the desired widths unchanged when the viewport has room', () => {
    const resolved = resolveDisplayWidths({ layers: 320, inspector: 400 }, 1920);
    expect(resolved).toEqual({ layers: 320, inspector: 400 });
  });

  it('shrinks the display value but never mutates the desired value', () => {
    const desired = { layers: 480, inspector: 600 };
    const resolved = resolveDisplayWidths(desired, 1000);
    // 1000 - 320 canvas minimum - 600 other panel leaves 80px for layers,
    // which is below the layers minimum, so the minimum wins and the canvas
    // yields. The point of the test is that `desired` is untouched.
    expect(resolved.layers).toBeLessThanOrEqual(desired.layers);
    expect(desired).toEqual({ layers: 480, inspector: 600 });
  });

  it('passes nulls through (default CSS clamp owns those panels)', () => {
    expect(resolveDisplayWidths({ layers: null, inspector: null }, 1440)).toEqual({
      layers: null,
      inspector: null,
    });
  });
});

describe('PanelResizeHandle semantics', () => {
  it('removes the grid-only splitter while the dock tree owns resizing', () => {
    const onResize = vi.fn();
    const { rerender } = render(
      <PanelResizeHandle side="layers" width={180} onResize={onResize} visible={false} />,
    );
    expect(screen.queryByRole('separator')).toBeNull();
    rerender(<PanelResizeHandle side="layers" width={180} onResize={onResize} />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(onResize).toHaveBeenCalledWith(196);
    rerender(<PanelResizeHandle side="layers" width={196} onResize={onResize} visible={false} />);
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('exposes the default width when no persisted width exists', () => {
    render(<PanelResizeHandle side="layers" width={null} onResize={vi.fn()} />);

    const splitter = screen.getByRole('separator', { name: 'Resize layers panel' });
    expect(splitter).toHaveAttribute(
      'aria-valuenow',
      String(defaultPanelWidth('layers', window.innerWidth)),
    );
    expect(splitter).toHaveAttribute('aria-valuemin', '180');
    expect(splitter).toHaveAttribute('aria-valuemax', '576');
    expect(splitter).toHaveAttribute('aria-valuetext', expect.stringContaining('pixels'));
    expect(splitter).toHaveAttribute('aria-controls', 'editor-layers-panel');
  });

  it('exposes a persisted width and supports keyboard resize', () => {
    const onResize = vi.fn();
    render(<PanelResizeHandle side="inspector" width={360} onResize={onResize} />);

    const splitter = screen.getByRole('separator', { name: 'Resize inspector panel' });
    expect(splitter).toHaveAttribute('aria-valuenow', '360');
    expect(splitter).toHaveAttribute('aria-controls', 'editor-inspector-panel');

    fireEvent.keyDown(splitter, { key: 'ArrowLeft' });
    expect(onResize).toHaveBeenCalledWith(376);
    fireEvent.keyDown(splitter, { key: 'Home' });
    expect(onResize).toHaveBeenCalledWith(240);
  });

  it('reads its usable range from the panel registry, not a second copy', () => {
    // The desktop dock sizes these same panels from the registry's
    // preferred/maximum sizes. If a definition changes, the compact tier must
    // follow it instead of keeping its own hard-coded range.
    const layers = panelLimits('layers');
    expect(layers).toEqual({ min: 180, max: 576 });
    const inspector = panelLimits('inspector');
    expect(inspector).toEqual({ min: 240, max: 640 });
    for (const side of ['layers', 'inspector'] as const) {
      const definition = tryGetPanelDefinition(side);
      expect(definition?.minimumSize.width).toBe(panelLimits(side).min);
      // The maximum is the declared `maximumSize` when a definition sets one,
      // and otherwise the derived policy: twice the preferred width. Either
      // way the compact tier must report the same number the dock enforces.
      const declaredMaximum =
        definition?.maximumSize?.width ?? (definition?.preferredSize?.width ?? 0) * 2;
      expect(declaredMaximum).toBe(panelLimits(side).max);
    }
  });
});
