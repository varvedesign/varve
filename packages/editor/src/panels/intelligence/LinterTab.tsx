/* ------------------------------------------------------------------ */
/*  Tab 10: Linter — Design Linter Rules                              */
/* ------------------------------------------------------------------ */

import type { Document } from '@varve/scene';
import { type LinterIssue, type LinterReport, runLinterScan } from '@varve/scene';
import { CloseButton, Icon, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { LinterConfigEditor } from './LinterConfigEditor';
import { humanizeToken, SeverityMark } from './shared';

export function LinterTab() {
  const { state, setSelection, updateDoc } = useEditor();
  const [report, setReport] = useState<LinterReport | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [showConfig, setShowConfig] = useState(false);
  const scanIdRef = useRef(0);

  const runScan = useCallback(() => {
    const cfg = (state.document as unknown as Record<string, unknown>).linterConfig as
      | {
          touchTargetMinWidth?: number;
          touchTargetMinHeight?: number;
          touchTargetMinSpacing?: number;
          nonTextContrastThreshold?: number;
          origin?: Record<string, string>;
        }
      | undefined;
    const minW = cfg?.touchTargetMinWidth ?? 44;
    const minH = cfg?.touchTargetMinHeight ?? 44;
    const nonTextThreshold = cfg?.nonTextContrastThreshold ?? 3;
    const result = runLinterScan(state.document, {
      touchTargetMinSize: Math.min(minW, minH),
      nonTextContrastThreshold: nonTextThreshold,
    });
    scanIdRef.current = result.scanId;
    setReport(result);
  }, [state.document]);

  useEffect(() => {
    runScan();
  }, [runScan]);

  if (!report) {
    return (
      <div className="intelligence-empty">
        <p>Scanning…</p>
      </div>
    );
  }

  const total = report.issues.length;
  const visible = report.issues.filter((i) => !dismissed.has(`${i.ruleId}:${i.nodeIds.join(',')}`));

  if (visible.length === 0) {
    return (
      <div className="intelligence-tab-content">
        <div className="intelligence-analysis" style={{ marginBottom: 'var(--space-2)' }}>
          <div className="intelligence-analysis__row">
            <span>Issues found</span>
            <span className="intelligence-analysis__value">{total}</span>
          </div>
          <div className="intelligence-analysis__row">
            <span>Errors</span>
            <span className="intelligence-analysis__value">{report.totalErrors}</span>
          </div>
          <div className="intelligence-analysis__row">
            <span>Warnings</span>
            <span className="intelligence-analysis__value">{report.totalWarnings}</span>
          </div>
          <div className="intelligence-analysis__row">
            <span>Info / Suggestions</span>
            <span className="intelligence-analysis__value">
              {report.totalInfo + report.totalSuggestions}
            </span>
          </div>
        </div>
        <p className="intelligence-empty">
          <Icon name="CircleCheck" label={undefined} size="1.2em" /> All issues dismissed
        </p>
        <button
          type="button"
          className="intelligence-action-btn"
          onClick={() => setDismissed(new Set())}
        >
          Reset dismissals
        </button>
      </div>
    );
  }

  const byCategory: Record<string, LinterIssue[]> = {};
  for (const issue of visible) {
    const cat = byCategory[issue.category] ?? [];
    cat.push(issue);
    byCategory[issue.category] = cat;
  }

  return (
    <div className="intelligence-tab-content">
      <div className="intelligence-analysis" style={{ marginBottom: 'var(--space-2)' }}>
        <div className="intelligence-analysis__row">
          <span>Issues</span>
          <span className="intelligence-analysis__value">{total}</span>
        </div>
        <div className="intelligence-analysis__row">
          <span>Errors</span>
          <span className="intelligence-analysis__value">{report.totalErrors}</span>
        </div>
        <div className="intelligence-analysis__row">
          <span>Warnings</span>
          <span className="intelligence-analysis__value">{report.totalWarnings}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}>
        <button type="button" className="intelligence-action-btn" onClick={runScan}>
          <Icon name="RotateCcw" label={undefined} size="0.85em" /> Re-scan
        </button>
        <button
          type="button"
          className="intelligence-action-btn"
          onClick={() => setShowConfig((s) => !s)}
        >
          <Icon name="Settings" label={undefined} size="0.85em" /> Config
        </button>
      </div>

      {showConfig && <LinterConfigEditor />}

      {Object.entries(byCategory).map(([category, issues]) => (
        <details key={category} className="intelligence-section" open>
          <summary className="intelligence-section__summary">
            {category === 'color' && <Icon name="Palette" label={undefined} size="0.85em" />}
            {category === 'layer-hygiene' && <Icon name="Layers" label={undefined} size="0.85em" />}
            {category === 'touch-target' && <Icon name="Pointer" label={undefined} size="0.85em" />}
            {category === 'focus-order' && <Icon name="List" label={undefined} size="0.85em" />}{' '}
            {humanizeToken(category)} ({issues.length})
          </summary>

          <div className="intelligence-issue-list">
            {issues.map((issue) => {
              const key = `${issue.ruleId}:${issue.nodeIds.join(',')}`;
              const sev =
                issue.severity === 'error'
                  ? 'error'
                  : issue.severity === 'warning'
                    ? 'warning'
                    : 'info';
              return (
                <div key={key} className={`intelligence-issue intelligence-issue--${sev}`}>
                  <Tooltip
                    label="Select this node"
                    disabledReason={
                      issue.nodeIds.length > 0 ? undefined : 'No node is associated with this issue'
                    }
                  >
                    <button
                      type="button"
                      className="intelligence-issue__target"
                      onClick={() => {
                        if (issue.nodeIds.length > 0) {
                          setSelection(issue.nodeIds[0] ?? null);
                        }
                      }}
                      disabled={issue.nodeIds.length === 0}
                    >
                      <SeverityMark severity={sev} />
                      <span className="intelligence-issue__type">{issue.ruleId}</span>
                    </button>
                  </Tooltip>
                  <p className="intelligence-issue__message">{issue.message}</p>
                  {issue.detail && (
                    <p
                      className="intelligence-issue__detail"
                      style={{ fontSize: 'var(--font-size-xs)', opacity: 0.8 }}
                    >
                      {issue.detail}
                    </p>
                  )}

                  <div
                    className="intelligence-issue__actions"
                    style={{ display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}
                  >
                    {issue.fixes.map((fix) => (
                      <button
                        key={fix.id}
                        type="button"
                        className="intelligence-action-btn"
                        onClick={() => {
                          const result = fix.apply(state.document);
                          if (result) updateDoc(() => result as Document);
                        }}
                      >
                        <Icon name="Wand" label={undefined} size="0.85em" /> {fix.label}
                      </button>
                    ))}
                    {issue.dismissable && (
                      <Tooltip label="Dismiss this issue">
                        <CloseButton
                          size="sm"
                          type="button"
                          onClick={() => setDismissed((prev) => new Set(prev).add(key))}
                          aria-label="Dismiss this issue"
                        />
                      </Tooltip>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}
