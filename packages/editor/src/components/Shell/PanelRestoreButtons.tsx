/**
 * Edge buttons that bring back a hidden Layers or Inspector panel.
 *
 * They used to live inside SelectionInfoBar, so they existed only while the
 * workspace showed its status bar: a user who turned the status bar off and
 * hid a panel had no pointer route back to it. They render as direct children
 * of the shell grid (placed over the canvas edge by CSS), independent of the
 * status bar (shell audit 2026-10-22, TC-05).
 */
import { useEditor } from '../../context';

export function PanelRestoreButtons() {
  const { state, toggleLeftPanel, toggleRightPanel } = useEditor();
  return (
    <>
      {!state.leftPanelVisible && (
        <button
          type="button"
          className="editor__panel-restore-btn editor__panel-restore-btn--left"
          onClick={() => toggleLeftPanel?.()}
          aria-label="Expand layers panel (Ctrl+B)"
          title="Expand layers panel (Ctrl+B)"
          data-testid="restore-left-panel"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2" y="2" width="12" height="12" rx="2" />
            <path d="M6 2v12" />
            <path d="M9 6l2 2-2 2" />
          </svg>
          <span className="editor__panel-restore-label">Layers</span>
        </button>
      )}
      {!state.rightPanelVisible && (
        <button
          type="button"
          className="editor__panel-restore-btn editor__panel-restore-btn--right"
          onClick={() => toggleRightPanel?.()}
          aria-label="Expand inspector panel (Ctrl+Shift+B)"
          title="Expand inspector panel (Ctrl+Shift+B)"
          data-testid="restore-right-panel"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2" y="2" width="12" height="12" rx="2" />
            <path d="M10 2v12" />
            <path d="M7 6l-2 2 2 2" />
          </svg>
          <span className="editor__panel-restore-label">Inspector</span>
        </button>
      )}
    </>
  );
}
