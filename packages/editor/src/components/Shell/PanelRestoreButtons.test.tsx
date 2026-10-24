/**
 * Panel restore buttons: the pointer route back to a hidden Layers or
 * Inspector panel. Moved out of SelectionInfoBar (TC-05) so they no longer
 * depend on the workspace showing its status bar.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import { PanelRestoreButtons } from './PanelRestoreButtons';

describe('PanelRestoreButtons', () => {
  it('renders restore buttons when panels are collapsed and restores them on click', () => {
    function TestToggle() {
      const { toggleLeftPanel, toggleRightPanel, state } = useEditor();
      return (
        <div>
          <button type="button" onClick={toggleLeftPanel}>
            Toggle Left
          </button>
          <button type="button" onClick={toggleRightPanel}>
            Toggle Right
          </button>
          <span data-testid="left-state">{String(state.leftPanelVisible)}</span>
          <span data-testid="right-state">{String(state.rightPanelVisible)}</span>
          <PanelRestoreButtons />
        </div>
      );
    }
    render(
      <EditorProvider>
        <TestToggle />
      </EditorProvider>,
    );
    expect(screen.queryByTestId('restore-left-panel')).toBeNull();
    expect(screen.queryByTestId('restore-right-panel')).toBeNull();

    // Collapse left panel
    fireEvent.click(screen.getByText('Toggle Left'));
    expect(screen.getByTestId('left-state')).toHaveTextContent('false');
    const restoreLeft = screen.getByTestId('restore-left-panel');
    expect(restoreLeft).toBeInTheDocument();
    expect(restoreLeft).toHaveAttribute('aria-label', 'Expand layers panel (Ctrl+B)');

    // Click restore button to expand left panel
    fireEvent.click(restoreLeft);
    expect(screen.getByTestId('left-state')).toHaveTextContent('true');
    expect(screen.queryByTestId('restore-left-panel')).toBeNull();

    // Collapse right panel
    fireEvent.click(screen.getByText('Toggle Right'));
    expect(screen.getByTestId('right-state')).toHaveTextContent('false');
    const restoreRight = screen.getByTestId('restore-right-panel');
    expect(restoreRight).toBeInTheDocument();
    expect(restoreRight).toHaveAttribute('aria-label', 'Expand inspector panel (Ctrl+Shift+B)');

    // Click restore button to expand right panel
    fireEvent.click(restoreRight);
    expect(screen.getByTestId('right-state')).toHaveTextContent('true');
    expect(screen.queryByTestId('restore-right-panel')).toBeNull();
  });
});
