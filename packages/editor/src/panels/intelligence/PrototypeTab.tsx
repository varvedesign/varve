/* ------------------------------------------------------------------ */
/*  Tab 6: Prototype — validatePrototype                                */
/* ------------------------------------------------------------------ */

import { validatePrototype } from '@varve/prototype';
import { Icon, Tooltip } from '@varve/ui';
import { useMemo } from 'react';
import { useEditor } from '../../context';
import { SeverityMark } from './shared';

export function PrototypeTab() {
  const { state, setSelection } = useEditor();
  const issues = useMemo(() => {
    if (!state.prototypeData) return [];
    const allNodeIds = Object.keys(state.document.nodes);
    return validatePrototype(state.prototypeData, allNodeIds);
  }, [state.prototypeData, state.document.nodes]);

  if (issues.length === 0) {
    return (
      <div className="intelligence-empty">
        <Icon name="CircleCheck" label={undefined} size="1.2em" />
        <p>No prototype issues</p>
      </div>
    );
  }

  return (
    <div className="intelligence-issue-list">
      {issues.map((issue) => (
        <div
          key={`${issue.code}-${issue.nodeId ?? ''}-${issue.interactionId ?? ''}`}
          className={`intelligence-issue intelligence-issue--${issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'}`}
        >
          <Tooltip
            label="Select this node"
            disabledReason={issue.nodeId ? undefined : 'No node is associated with this issue'}
          >
            <button
              type="button"
              className="intelligence-issue__target"
              onClick={() => issue.nodeId && setSelection(issue.nodeId)}
              disabled={!issue.nodeId}
            >
              <SeverityMark severity={issue.severity} />
              <span className="intelligence-issue__type">{issue.code}</span>
            </button>
          </Tooltip>
          <p className="intelligence-issue__message">{issue.message}</p>
        </div>
      ))}
    </div>
  );
}
