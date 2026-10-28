/* ------------------------------------------------------------------ */
/*  Tab 5: Debt — Design Debt Scanner                                    */
/* ------------------------------------------------------------------ */

import { getFontRegistry } from '@varve/engine';
import { type DebtIssue, type DebtReport, runDebtScan } from '@varve/scene';
import { Icon, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useState } from 'react';
import { useEditor } from '../../context';
import { autoName } from '../../intelligence/autoNamer';
import { SeverityMark } from './shared';

export function DebtTab() {
  const { state, setSelection, updateDoc } = useEditor();

  const [report, setReport] = useState<DebtReport | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const handleScan = useCallback(() => {
    setIsScanning(true);
    setTimeout(() => {
      const loadedFonts = (() => {
        try {
          const registry = getFontRegistry();
          return new Set(registry.families().filter((f) => registry.isAvailable(f)));
        } catch {
          return new Set<string>();
        }
      })();
      const result = runDebtScan(state.document, { availableFonts: loadedFonts });
      setReport(result);
      setIsScanning(false);
    }, 50);
  }, [state.document]);

  // Auto-run on first mount and whenever the document changes, idle-scheduled
  // so it never competes with interactive edits for the main thread.
  useEffect(() => {
    const id =
      requestIdleCallback?.(handleScan, { timeout: 500 }) ??
      (setTimeout(handleScan, 300) as unknown as number);
    return () => {
      if (typeof id === 'number' && typeof cancelIdleCallback !== 'undefined')
        cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, [handleScan]);

  const handleFix = useCallback(
    (issue: DebtIssue) => {
      updateDoc((doc) => {
        if (issue.autoFix) return issue.autoFix(doc);
        if (issue.checkId === 'unnamed-layers' && issue.nodeId) {
          const target = doc.nodes[issue.nodeId];
          if (!target) return doc;
          return {
            ...doc,
            nodes: { ...doc.nodes, [target.id]: { ...target, name: autoName(doc, target) } },
          };
        }
        return doc;
      });
    },
    [updateDoc],
  );

  const isFixable = (issue: DebtIssue): boolean =>
    issue.autoFix != null || (issue.checkId === 'unnamed-layers' && issue.nodeId != null);

  return (
    <div className="intelligence-tab-content">
      <p className="intelligence-hint">
        Scan the document for design debt: untokenized colors, inline spacing, naming violations,
        orphaned styles, and more.
      </p>

      <button
        type="button"
        className="intelligence-action-btn"
        disabled={isScanning}
        onClick={handleScan}
      >
        <Icon name={isScanning ? 'Loader' : 'Search'} label={undefined} size="0.85em" />
        {isScanning ? 'Scanning…' : report ? 'Re-scan' : 'Scan for debt'}
      </button>

      {report && (
        <>
          <div className="intelligence-analysis">
            <div className="intelligence-analysis__row">
              <span>Errors</span>
              <span className="intelligence-analysis__value intelligence-analysis__value--error">
                {report.totalErrors}
              </span>
            </div>
            <div className="intelligence-analysis__row">
              <span>Warnings</span>
              <span className="intelligence-analysis__value intelligence-analysis__value--warning">
                {report.totalWarnings}
              </span>
            </div>
            <div className="intelligence-analysis__row">
              <span>Info</span>
              <span className="intelligence-analysis__value intelligence-analysis__value--info">
                {report.totalInfo}
              </span>
            </div>
          </div>

          {[...Object.entries(report.byCategory)].map(([category, issues]) => (
            <details key={category} className="intelligence-section" open>
              <summary className="intelligence-section__header">
                <span className="intelligence-section__title">{category}</span>
                <span className="intelligence-section__count">{issues.length}</span>
              </summary>
              <div className="intelligence-issue-list">
                {issues.map((issue) => (
                  <div
                    key={`${issue.checkId}-${issue.nodeId ?? 'doc'}`}
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
                        <span className="intelligence-issue__type">{issue.checkId}</span>
                      </button>
                    </Tooltip>
                    <p className="intelligence-issue__message">{issue.message}</p>
                    {isFixable(issue) && (
                      <button
                        type="button"
                        className="intelligence-action-btn"
                        onClick={() => handleFix(issue)}
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
        </>
      )}
    </div>
  );
}
