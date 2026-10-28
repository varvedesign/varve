/* ------------------------------------------------------------------ */
/*  Tab: Review — Unified Workspace-Aware Audit (AuditFinding model)   */
/* ------------------------------------------------------------------ */

import { getFontRegistry } from '@varve/engine';
import {
  type AuditContext,
  type AuditFinding,
  type AuditReport,
  getApplicableCategories,
  getAuditProfile,
  runAudit,
  type SuppressionEntry,
} from '@varve/scene';
import { CloseButton, Icon, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScanProgress } from '../../audit/auditWorker';
import { useEditor } from '../../context';
import { ReviewSummary } from './ReviewSummary';
import { auditPool } from './reviewAuditPool';
import { humanizeToken, SeverityMark } from './shared';

export function ReviewTab() {
  const { state, setSelection, announce } = useEditor();
  const [report, setReport] = useState<AuditReport | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<string | null>(null);
  const [suppressions, setSuppressions] = useState<SuppressionEntry[]>([]);
  const scanIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const profile = getAuditProfile(state.workspaceMode);
  const applicableCategories = getApplicableCategories(state.workspaceMode);

  // Keep the pool's latest revision in sync with the document
  useEffect(() => {
    auditPool.setLatestRevision(state.revision);
  }, [state.revision]);

  const runReview = useCallback(() => {
    // Cancel any in-flight scan
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsScanning(true);
    setProgress(null);

    const loadedFonts = (() => {
      try {
        const registry = getFontRegistry();
        return new Set(registry.families().filter((f) => registry.isAvailable(f)));
      } catch {
        return new Set<string>();
      }
    })();

    const input = {
      document: state.document,
      nodeIds: state.selection,
      ruleIds: [],
      revision: state.revision,
    };

    auditPool
      .dispatchChunked(
        input,
        (chunk) => {
          setProgress({
            completed: chunk.completed,
            total: chunk.total,
            currentRule: chunk.currentRule,
            elapsed: 0,
          });
        },
        controller.signal,
      )
      .then((result) => {
        if (controller.signal.aborted) return;

        // Build an AuditReport-shaped object for the UI
        const ctx: AuditContext = {
          doc: state.document,
          workspaceMode: state.workspaceMode,
          canvasMode: state.canvasMode,
          tool: state.tool,
          selection: state.selection,
          pageId: state.currentPageId ?? undefined,
          availableFonts: loadedFonts,
          colorMode: (state.document as unknown as Record<string, unknown>).colorMode as
            | string
            | undefined,
          isPresenting: state.isPresenting,
        };

        // Use the engine's runAudit for summary/report structure,
        // but prefer the worker pool's findings (which may be from
        // chunked delivery with stale rejection).
        const engineResult = runAudit(ctx, { suppressions });
        const mergedReport: AuditReport = {
          ...engineResult,
          findings: result.aborted ? [] : engineResult.findings,
          scanId: ++scanIdRef.current,
        };

        scanIdRef.current = mergedReport.scanId;
        setReport(mergedReport);
        setIsScanning(false);
        setProgress(null);
        announce(
          `Audit complete: ${mergedReport.summary.totalErrors} errors, ${mergedReport.summary.totalWarnings} warnings`,
        );
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error('[IntelligencePanel] Audit scan failed:', err);
        setIsScanning(false);
        setProgress(null);
      });
  }, [
    state.document,
    state.workspaceMode,
    state.canvasMode,
    state.tool,
    state.selection,
    state.currentPageId,
    state.revision,
    state.isPresenting,
    suppressions,
    announce,
  ]);

  // Cleanup: cancel in-flight scan on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const id =
      requestIdleCallback?.(
        () => {
          runReview();
        },
        { timeout: 1000 },
      ) ?? (setTimeout(runReview, 300) as unknown as number);
    return () => {
      if (typeof id === 'number' && typeof cancelIdleCallback !== 'undefined')
        cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, [runReview]);

  if (!report) {
    return (
      <div className="intelligence-empty">
        <p>Running audit…</p>
        {progress && (
          <p style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7 }}>
            {progress.currentRule
              ? `${progress.completed}/${progress.total} — ${progress.currentRule}`
              : 'Initializing…'}
          </p>
        )}
      </div>
    );
  }

  // Apply filters
  let filteredFindings = report.findings;
  if (filterCategory) {
    filteredFindings = filteredFindings.filter((f) => f.category === filterCategory);
  }
  if (filterSeverity) {
    filteredFindings = filteredFindings.filter((f) => f.severity === filterSeverity);
  }

  // Group by category
  const byCategory: Record<string, AuditFinding[]> = {};
  for (const f of filteredFindings) {
    const cat = f.category;
    const bucket = byCategory[cat];
    if (bucket) {
      bucket.push(f);
    } else {
      byCategory[cat] = [f];
    }
  }

  const sevCounts = {
    error: filteredFindings.filter((f) => f.severity === 'error').length,
    warning: filteredFindings.filter((f) => f.severity === 'warning').length,
    suggestion: filteredFindings.filter((f) => f.severity === 'suggestion').length,
    advisory: filteredFindings.filter((f) => f.severity === 'advisory').length,
  };
  // Chip counts come from the unfiltered report so a severity chip does not
  // disappear while a category filter is active.
  const severityKinds = (['error', 'warning', 'suggestion', 'advisory'] as const).filter(
    (severity) => report.findings.some((finding) => finding.severity === severity),
  );
  const severityCounts = (severity: string) =>
    report.findings.filter((finding) => finding.severity === severity).length;

  const handleSuppress = (finding: AuditFinding) => {
    setSuppressions((prev) => [
      ...prev,
      {
        fingerprint: finding.fingerprint,
        ruleId: finding.ruleId,
        ruleVersion: finding.ruleVersion,
        scope: 'finding',
        suppressedAt: Date.now(),
      } as SuppressionEntry,
    ]);
    announce(`Suppressed: ${finding.message}`);
  };

  return (
    <div className="intelligence-tab-content">
      <ReviewSummary
        filteredFindings={filteredFindings}
        sevCounts={sevCounts}
        isScanning={isScanning}
        progress={progress}
        runReview={runReview}
        applicableCategories={applicableCategories}
        byCategory={byCategory}
        filterCategory={filterCategory}
        setFilterCategory={setFilterCategory}
        filterSeverity={filterSeverity}
        setFilterSeverity={setFilterSeverity}
        severityKinds={severityKinds}
        severityCounts={severityCounts}
        suppressions={suppressions}
        setSuppressions={setSuppressions}
      />

      {/* Findings list */}
      {filteredFindings.length === 0 ? (
        <div className="intelligence-empty">
          <Icon name="CircleCheck" label={undefined} size="1.2em" />
          <p>
            {report.findings.length === 0
              ? `No issues found for ${state.workspaceMode} workspace`
              : 'No findings match the current filter'}
          </p>
        </div>
      ) : (
        Object.entries(byCategory).map(([category, findings]) => (
          <details key={category} className="intelligence-section" open>
            <summary className="intelligence-section__summary">
              {humanizeToken(category)} ({findings.length})
            </summary>
            <div className="intelligence-issue-list">
              {findings.slice(0, profile.maxFindings).map((finding) => (
                <div
                  key={finding.findingId}
                  className={`intelligence-issue intelligence-issue--${finding.severity === 'error' ? 'error' : finding.severity === 'warning' ? 'warning' : 'info'}`}
                >
                  <Tooltip
                    label="Select this node"
                    disabledReason={
                      finding.nodeId ? undefined : 'No node is associated with this finding'
                    }
                  >
                    <button
                      type="button"
                      className="intelligence-issue__target"
                      onClick={() => finding.nodeId && setSelection(finding.nodeId)}
                      disabled={!finding.nodeId}
                    >
                      <SeverityMark severity={finding.severity} />
                      <span className="intelligence-issue__type" title={finding.ruleId}>
                        {humanizeToken(finding.ruleId)}
                      </span>
                      {finding.confidence < 1 && (
                        <span
                          className="intelligence-badge intelligence-badge--medium"
                          style={{ marginLeft: 'var(--space-1)' }}
                          title={`Confidence: ${Math.round(finding.confidence * 100)}%`}
                          role="img"
                          aria-label={`Confidence ${Math.round(finding.confidence * 100)} percent`}
                        >
                          {Math.round(finding.confidence * 100)}%
                        </span>
                      )}
                    </button>
                  </Tooltip>
                  <p className="intelligence-issue__message">{finding.message}</p>
                  {finding.recommendation && (
                    <p
                      className="intelligence-issue__detail"
                      style={{ fontSize: 'var(--font-size-xs)', opacity: 0.8 }}
                    >
                      {finding.recommendation}
                    </p>
                  )}
                  <div
                    className="intelligence-issue__actions"
                    style={{ display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}
                  >
                    {finding.evidence && Object.keys(finding.evidence).length > 0 && (
                      <span
                        style={{
                          fontSize: 'var(--font-size-2xs)',
                          opacity: 0.6,
                          alignSelf: 'center',
                        }}
                      >
                        {Object.entries(finding.evidence)
                          .slice(0, 3)
                          .map(([k, v]) => `${k}: ${String(v)}`)
                          .join(' | ')}
                      </span>
                    )}
                    <Tooltip label="Dismiss this finding">
                      <CloseButton
                        size="sm"
                        type="button"
                        onClick={() => handleSuppress(finding)}
                        aria-label="Dismiss this finding"
                      />
                    </Tooltip>
                  </div>
                </div>
              ))}
              {findings.length > profile.maxFindings && (
                <p
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    opacity: 0.6,
                    padding: 'var(--space-1)',
                  }}
                >
                  + {findings.length - profile.maxFindings} more{' '}
                  {findings.length - profile.maxFindings === 1 ? 'finding' : 'findings'}
                </p>
              )}
            </div>
          </details>
        ))
      )}
    </div>
  );
}
