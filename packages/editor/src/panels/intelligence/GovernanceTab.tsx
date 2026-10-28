/* ------------------------------------------------------------------ */
/*  Tab 4: Governance — Design System Rule Checks                      */
/* ------------------------------------------------------------------ */

import { getFontRegistry } from '@varve/engine';
import { type GovernanceIssue, runGovernanceRules } from '@varve/scene';
import { Icon, Tooltip } from '@varve/ui';
import { useCallback, useMemo } from 'react';
import { useEditor } from '../../context';
import { SeverityMark } from './shared';

export function GovernanceTab() {
  const { state, setSelection, updateDoc } = useEditor();

  const loadedFonts = useMemo(() => {
    try {
      const registry = getFontRegistry();
      return new Set(registry.families().filter((f) => registry.isAvailable(f)));
    } catch {
      return new Set<string>();
    }
  }, []);

  const issues = useMemo(
    () => runGovernanceRules(state.document, { availableFonts: loadedFonts }),
    [state.document, loadedFonts],
  );

  const fixableCount = useMemo(() => issues.filter((i) => i.autoFix != null).length, [issues]);

  const issuesByRule = useMemo(() => {
    const map = new Map<string, GovernanceIssue[]>();
    for (const issue of issues) {
      const group = map.get(issue.ruleId) ?? [];
      group.push(issue);
      map.set(issue.ruleId, group);
    }
    return map;
  }, [issues]);

  const runAllFixes = useCallback(() => {
    updateDoc((doc) => {
      let current = doc;
      for (const issue of issues) {
        if (issue.autoFix) {
          current = issue.autoFix(current);
        }
      }
      return current;
    });
  }, [issues, updateDoc]);

  if (issues.length === 0) {
    return (
      <div className="intelligence-empty">
        <Icon name="CircleCheck" label={undefined} size="1.2em" />
        <p>No governance issues</p>
      </div>
    );
  }

  return (
    <div className="intelligence-tab-content">
      {fixableCount > 0 && (
        <button type="button" className="intelligence-action-btn" onClick={runAllFixes}>
          <Icon name="Wand" label={undefined} size="0.85em" />
          Run all auto-fixes ({fixableCount})
        </button>
      )}

      {[...issuesByRule.entries()].map(([ruleId, ruleIssues]) => (
        <details key={ruleId} className="intelligence-section" open>
          <summary className="intelligence-section__header">
            <span className="intelligence-section__title">{ruleId}</span>
            <span className="intelligence-section__count">{ruleIssues.length}</span>
          </summary>
          <div className="intelligence-issue-list">
            {ruleIssues.map((issue) => (
              <div
                key={`${issue.ruleId}-${issue.nodeId ?? 'doc'}`}
                className={`intelligence-issue intelligence-issue--${issue.severity}`}
              >
                <Tooltip
                  label="Select this node"
                  disabledReason={
                    issue.nodeId ? undefined : 'No node is associated with this issue'
                  }
                >
                  <button
                    type="button"
                    className="intelligence-issue__target"
                    onClick={() => issue.nodeId && setSelection(issue.nodeId)}
                    disabled={!issue.nodeId}
                  >
                    <SeverityMark severity={issue.severity} />
                    <span className="intelligence-issue__type">{issue.ruleId}</span>
                  </button>
                </Tooltip>
                <p className="intelligence-issue__message">{issue.message}</p>
                {issue.targetName && (
                  <span className="intelligence-issue__target-name">{issue.targetName}</span>
                )}
                {issue.autoFix && (
                  <button
                    type="button"
                    className="intelligence-action-btn"
                    onClick={() => {
                      updateDoc((doc) => issue.autoFix!(doc));
                    }}
                  >
                    <Icon name="Wand" label={undefined} size="0.85em" />
                    Auto-fix
                  </button>
                )}
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
