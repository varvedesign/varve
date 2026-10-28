/* ------------------------------------------------------------------ */
/*  Tab 7: Layout — Auto-layout Suggestion                                */
/* ------------------------------------------------------------------ */

import { Icon } from '@varve/ui';
import { useMemo } from 'react';
import { useEditor } from '../../context';
import { suggestAutoLayout } from '../../intelligence/autoLayoutSuggestor';

export function LayoutTab() {
  const { state, selectedNodes, setNodeLayout } = useEditor();
  const sel = selectedNodes();
  const frame =
    sel.length === 1 && sel[0]?.kind === 'frame'
      ? (sel[0] as import('@varve/scene').FrameNode)
      : null;

  const children = useMemo(() => {
    if (!frame) return [];
    return (frame.children ?? [])
      .map((id) => state.document.nodes[id])
      .filter((n): n is import('@varve/scene').SceneNode => n != null);
  }, [frame, state.document.nodes]);

  const autoSuggestion = useMemo(() => {
    if (!frame || children.length < 2) return null;
    return suggestAutoLayout(frame, children, state.document);
  }, [frame, children, state.document, suggestAutoLayout]);

  if (!frame) {
    return (
      <div className="intelligence-empty">
        <Icon name="Move" label={undefined} size="1.2em" />
        <p>Select a frame to see auto-layout suggestions</p>
      </div>
    );
  }

  if (!autoSuggestion) {
    return (
      <div className="intelligence-empty">
        <Icon name="Move" label={undefined} size="1.2em" />
        <p>No auto-layout suggestion available for this frame</p>
      </div>
    );
  }

  return (
    <div className="intelligence-tab-content">
      <div className="intelligence-analysis">
        <div className="intelligence-analysis__row">
          <span>Direction</span>
          <span className="intelligence-analysis__value">{autoSuggestion.direction}</span>
        </div>
        <div className="intelligence-analysis__row">
          <span>Gap</span>
          <span className="intelligence-analysis__value">{autoSuggestion.gap}px</span>
        </div>
        <div className="intelligence-analysis__row">
          <span>Alignment</span>
          <span className="intelligence-analysis__value">{autoSuggestion.alignItems}</span>
        </div>
        <div className="intelligence-analysis__row">
          <span>Confidence</span>
          <span className="intelligence-analysis__value">
            {Math.round(autoSuggestion.confidence * 100)}%
          </span>
        </div>
      </div>
      <p className="intelligence-hint">{autoSuggestion.reason}</p>
      <button
        type="button"
        className="intelligence-action-btn"
        onClick={() => setNodeLayout(frame.id, autoSuggestion.suggestedStyle)}
      >
        <Icon name="Wand" label={undefined} size="0.85em" />
        Apply layout
      </button>
    </div>
  );
}
