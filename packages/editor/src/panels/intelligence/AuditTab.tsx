/* ------------------------------------------------------------------ */
/*  Tab 1: Audit — Issues & Warnings (legacy WCAG contrast only)       */
/* ------------------------------------------------------------------ */

import { runIntelligenceAudit } from '@varve/scene';
import { Icon, Tooltip } from '@varve/ui';
import { useMemo } from 'react';
import { useEditor } from '../../context';
import { SeverityMark } from './shared';

export function AuditTab() {
  const { state, setSelection, updateDoc } = useEditor();
  const issues = useMemo(() => runIntelligenceAudit(state.document), [state.document]);

  if (issues.length === 0) {
    return (
      <div className="intelligence-empty">
        <Icon name="CircleCheck" label={undefined} size="1.2em" />
        <p>No issues detected</p>
      </div>
    );
  }

  return (
    <div className="intelligence-issue-list">
      {issues.map((issue) => (
        <div
          key={`${issue.type}-${issue.nodeId}`}
          className={`intelligence-issue intelligence-issue--${issue.severity}`}
        >
          <Tooltip label="Select this node">
            <button
              type="button"
              className="intelligence-issue__target"
              onClick={() => setSelection(issue.nodeId)}
            >
              <SeverityMark severity={issue.severity} />
              <span className="intelligence-issue__type">{issue.type}</span>
            </button>
          </Tooltip>
          <p className="intelligence-issue__message">{issue.message}</p>
          {issue.autoFix && (
            <button
              type="button"
              className="intelligence-action-btn"
              onClick={() => {
                const fixed = issue.autoFix?.();
                if (fixed) updateDoc(() => fixed);
              }}
            >
              <Icon name="Wand" label={undefined} size="0.85em" />
              Auto-fix
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
