// @vitest-environment jsdom

/**
 * The Resources drawer's close control.
 *
 * Resources was the one compact drawer with no in-panel close, which left a
 * touch-only user with a 20px scrim strip at 320px as their only pointer route
 * out. These tests pin the control's presence in the drawer tier, its absence
 * in the docked tier (where the panel is not a drawer), and that activating it
 * runs the shell's closer.
 */

import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { createDocument } from '@varve/scene';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider } from '../../context';
import { ResourcesPanel } from './ResourcesPanel';

vi.setConfig({ testTimeout: 30000 });

/**
 * Present the shell as the compact (drawer) tier, or as the docked tier.
 * jsdom defines `matchMedia` as a read-only property, so it is redefined rather
 * than assigned.
 */
function setCompactTier(compact: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: compact && /max-width:\s*899px/.test(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function mountPanel(onCloseResponsivePanel?: () => void) {
  const shell = document.createElement('div');
  shell.className = 'editor-shell';
  const container = document.createElement('div');
  container.setAttribute('data-panel', 'library');
  shell.appendChild(container);
  document.body.appendChild(shell);
  render(
    <EditorProvider>
      <ResourcesPanel
        doc={createDocument({ name: 'Close control fixture' })}
        onInstallLibrary={vi.fn()}
        onUninstallLibrary={vi.fn()}
        {...(onCloseResponsivePanel ? { onCloseResponsivePanel } : {})}
      />
    </EditorProvider>,
    { container },
  );
  return () => shell.remove();
}

beforeEach(() => {
  localStorage.clear();
});

describe('ResourcesPanel drawer close control', () => {
  it('offers a named close control in the drawer tier and runs the shell closer', () => {
    setCompactTier(true);
    const onClose = vi.fn();
    const cleanup = mountPanel(onClose);

    const close = screen.getByRole('button', { name: 'Close Resources panel' });
    expect(close).toBeVisible();
    close.click();
    expect(onClose).toHaveBeenCalledOnce();
    cleanup();
  });

  it('renders no close control when the panel is docked', () => {
    setCompactTier(false);
    const cleanup = mountPanel(vi.fn());
    expect(screen.queryByRole('button', { name: 'Close Resources panel' })).toBeNull();
    cleanup();
  });

  it('omits the control when the shell provides no closer', () => {
    setCompactTier(true);
    const cleanup = mountPanel();
    expect(screen.queryByRole('button', { name: 'Close Resources panel' })).toBeNull();
    cleanup();
  });

  it('keeps the tab list scrollable so the close control is never the clipped one', () => {
    // jsdom does not apply external stylesheets, so this asserts the declaration
    // itself rather than a computed value: the row must be able to compress by
    // scrolling its tabs, because a non-shrinking list pushed the rightmost
    // control — the way out of the drawer — past the panel edge.
    const css = readFileSync(
      resolve(process.cwd(), 'packages/editor/src/components/ResourcesPanel/ResourcesPanel.css'),
      'utf8',
    );
    /** The declarations between a selector and the end of its block. */
    const blockFor = (marker: string): string => {
      const start = css.indexOf(marker);
      if (start < 0) return '';
      const open = css.indexOf('{', start);
      const close = css.indexOf('}', open);
      return open < 0 || close < 0 ? '' : css.slice(open + 1, close);
    };
    const tabsRule = blockFor('.resources-panel__tabs {');
    expect(tabsRule).toContain('flex: 1 1 auto');
    expect(tabsRule).toContain('overflow-x: auto');
    const controlsRule = blockFor('.resources-panel__tabs-row > .panel-detach-btn,');
    expect(controlsRule).toContain('flex: 0 0 auto');
  });
});
