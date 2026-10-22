// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBuiltinPanels } from '../../workspace/panelDefinitions';
import { resetPanelRegistry } from '../../workspace/panelRegistry';
import { WorkspaceBottomPanels } from './WorkspaceBottomPanels';

vi.mock('../Inspector/panels/EmailPreviewPanel', () => ({
  EmailPreviewPanel: () => <section aria-label="Email Preview" />,
}));

describe('WorkspaceBottomPanels', () => {
  beforeEach(() => {
    resetPanelRegistry();
    registerBuiltinPanels();
  });

  it('mounts the configured Email Preview alongside an existing timeline', () => {
    render(
      <WorkspaceBottomPanels showEmailPreview>
        <div data-testid="timeline-content" />
      </WorkspaceBottomPanels>,
    );

    expect(screen.getByTestId('workspace-bottom-panels')).toHaveClass(
      'workspace-bottom-panels--split',
    );
    expect(screen.getByTestId('timeline-content')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Email Preview' })).toBeInTheDocument();
  });

  it('renders Email Preview without forcing a timeline panel to be visible', () => {
    render(<WorkspaceBottomPanels showEmailPreview />);

    expect(screen.getByRole('region', { name: 'Email Preview' })).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-content')).toBeNull();
  });

  it('exposes tab groups as keyboard-operable panel selectors', () => {
    const onSelectDockTab = vi.fn();
    render(
      <WorkspaceBottomPanels
        showEmailPreview={false}
        dockTabGroups={[
          {
            nodeId: 'tab-group',
            rect: { x: 0, y: 0, width: 360, height: 300 },
            activePanelInstanceId: 'layers-one',
            panels: [
              { instanceId: 'layers-one', panelTypeId: 'layers' },
              { instanceId: 'inspector-one', panelTypeId: 'inspector' },
            ],
            style: { position: 'absolute', left: 10, top: 20, width: 360, height: 32 },
          },
        ]}
        onSelectDockTab={onSelectDockTab}
      />,
    );

    const layersTab = screen.getByRole('tab', { name: 'Layers' });
    const inspectorTab = screen.getByRole('tab', { name: 'Inspector' });
    expect(layersTab).toHaveAttribute('aria-selected', 'true');
    expect(inspectorTab).toHaveAttribute('aria-selected', 'false');
    fireEvent.keyDown(layersTab, { key: 'ArrowRight' });
    expect(onSelectDockTab).toHaveBeenCalledWith('tab-group', 'inspector-one');
    expect(inspectorTab).toHaveFocus();
  });

  it('offers last-known-good recovery before resetting a saved arrangement', () => {
    const onRestoreLastKnownGood = vi.fn();
    render(
      <WorkspaceBottomPanels
        showEmailPreview={false}
        dockRecovery={{
          message: 'The saved layout failed to restore.',
          canRetrySaved: true,
          canRestoreLastKnownGood: true,
          onRetrySaved: vi.fn(),
          onRestoreLastKnownGood,
          onUseDefault: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /restore last working layout/i }));
    expect(onRestoreLastKnownGood).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /retry saved layout/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /use default arrangement/i })).toBeInTheDocument();
  });

  // F-03 (shell audit 2026-10-21): every panel header showed a permanent text
  // button "Move". The handle is a grip now; its name, tooltip and keyboard
  // path are unchanged.
  it('draws the panel move handle as a named grip without visible text', () => {
    const noop = () => {};
    const handle = {
      panelTypeId: 'layers' as const,
      title: 'Layers',
      style: {},
      onPointerDown: noop,
      onPointerMove: noop,
      onPointerUp: noop,
      onPointerCancel: noop,
      onLostPointerCapture: noop,
      onBlur: noop,
      onKeyDown: noop,
    };
    render(
      <WorkspaceBottomPanels
        showEmailPreview={false}
        dockPanelMoveHandles={[
          { ...handle, instanceId: 'layers-header' },
          { ...handle, instanceId: 'layers-tab', tabGroupNodeId: 'tab-group' },
        ]}
      />,
    );

    const grips = screen.getAllByRole('button', { name: 'Drag to move Layers panel' });
    expect(grips).toHaveLength(2);
    for (const grip of grips) {
      expect(grip).toHaveTextContent(/^$/);
      expect(grip.querySelector('svg')).not.toBeNull();
      expect(grip).toHaveAttribute('title', expect.stringContaining('Customize Workspace'));
    }
  });
});
