/**
 * PreflightWarnings — the Print Mode preflight panel, surfaced as a badge in
 * the StatusBar. When preflight detects issues, the badge is color-coded by
 * highest severity (red=error, yellow=warning, gray=info). Clicking opens a
 * panel listing all issues grouped by severity, plus which check categories
 * were actually evaluated versus skipped for lack of external data (e.g. no
 * installed-font registry, no live text-layout measurements).
 *
 * Research basis: Adobe InDesign preflight panel, Enfocus PitStop inspection.
 */

import { getFontRegistry } from '@varve/engine';
import type { CombinedPreflightIssue, CombinedPreflightSeverity } from '@varve/scene';
import { runCombinedPreflight } from '@varve/scene';
import { Icon, Popover } from '@varve/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEditor } from '../context';
import { measureTextOverset, resetTextOversetCache } from '../render/textOverset';
import './PreflightWarnings.css';

const SEVERITY_ORDER: CombinedPreflightSeverity[] = ['error', 'warning', 'info'];

interface GroupedIssues {
  severity: CombinedPreflightSeverity;
  label: string;
  issues: CombinedPreflightIssue[];
}

function severityColor(severity: CombinedPreflightSeverity): string {
  switch (severity) {
    case 'error':
      return 'var(--color-feedback-danger)';
    case 'warning':
      return 'var(--color-feedback-warning)';
    case 'info':
      return 'var(--color-text-muted)';
  }
}

function severityBg(severity: CombinedPreflightSeverity): string {
  switch (severity) {
    case 'error':
      return 'color-mix(in oklab, var(--color-feedback-danger) 12%, transparent)';
    case 'warning':
      return 'color-mix(in oklab, var(--color-feedback-warning) 16%, transparent)';
    case 'info':
      return 'var(--elevation-surface-sunken)';
  }
}

/** One shared 2D context for preflight text measurement. */
let sharedMeasureContext: CanvasRenderingContext2D | null | undefined;
function preflightMeasureContext(): CanvasRenderingContext2D | null {
  if (sharedMeasureContext !== undefined) return sharedMeasureContext;
  if (typeof document === 'undefined') {
    sharedMeasureContext = null;
    return null;
  }
  sharedMeasureContext = document.createElement('canvas').getContext('2d');
  return sharedMeasureContext;
}

export function PreflightWarnings() {
  const { state, revealSelection } = useEditor();
  const [open, setOpen] = useState(false);

  // Re-measure once the document's fonts finish loading: a preflight that ran
  // against fallback metrics would report overset that is not there.
  const [fontEpoch, setFontEpoch] = useState(0);
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      resetTextOversetCache();
      setFontEpoch((epoch) => epoch + 1);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const result = useMemo(() => {
    if (!state.document) return null;
    const measure = preflightMeasureContext();
    const overset = measure ? measureTextOverset(state.document, measure) : null;
    return runCombinedPreflight(state.document, {
      availableFonts: getFontRegistry().availableFamilies(),
      oversetMap: overset?.map,
      oversetUnmeasured: overset?.unmeasured.length ?? 0,
    });
  }, [state.document, fontEpoch]);

  const hasIssues = result && result.errorCount + result.warningCount + result.infoCount > 0;

  const highestSeverity: CombinedPreflightSeverity | null = useMemo(() => {
    if (!result || !hasIssues) return null;
    for (const s of SEVERITY_ORDER) {
      if (result.issues.some((i) => i.severity === s)) return s;
    }
    return null;
  }, [result, hasIssues]);

  const grouped: GroupedIssues[] = useMemo(() => {
    if (!result || !hasIssues) return [];
    return SEVERITY_ORDER.map((severity) => ({
      severity,
      label: severity.charAt(0).toUpperCase() + severity.slice(1),
      issues: result.issues.filter((i) => i.severity === severity),
    })).filter((g) => g.issues.length > 0);
  }, [result, hasIssues]);

  const unavailableChecks = useMemo(
    () => result?.checks.filter((c) => c.status === 'unavailable') ?? [],
    [result],
  );

  const handleSelectNode = useCallback(
    (nodeId: string) => {
      revealSelection({ nodeId });
      setOpen(false);
    },
    [revealSelection],
  );

  if (!result) return null;
  // Still surface the badge when checks are unavailable, even with zero
  // detected issues, so "0 issues" is never confused with "verified clean".
  if (!hasIssues && unavailableChecks.length === 0) return null;

  const ec = result.errorCount;
  const wc = result.warningCount;
  const ic = result.infoCount;
  const totalBadge = (ec + wc + ic).toString();
  const clean = !hasIssues;

  const panel = (
    <div className="preflight-warnings__panel">
      {clean && (
        <div
          className="preflight-warnings__clean"
          style={{
            padding: 'var(--space-1) var(--space-2)',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-secondary)',
          }}
        >
          No issues found in the checks below.
        </div>
      )}
      {grouped.map((group) => (
        <div key={group.severity} className="preflight-warnings__group">
          <div
            className="preflight-warnings__group-header"
            style={{
              // Severity conveyed by the dot + icon, not by the text
              // color: warning text was 3.42:1 on light surfaces
              // (WCAG 1.4.3 requires 4.5:1).
              color: 'var(--color-text-primary)',
              fontWeight: 600,
              fontSize: 'var(--font-size-sm)',
              padding: 'var(--space-1) var(--space-2)',
              borderBottom: 'var(--border-micro)',
              marginBottom: 'var(--space-1)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: severityColor(group.severity),
              }}
            />
            {group.label} ({group.issues.length})
          </div>
          {group.issues.map((issue) => (
            <div
              key={`${issue.source}-${issue.nodeId ?? 'doc'}-${issue.category}-${issue.message}`}
              className="preflight-warnings__issue"
              style={{
                padding: 'var(--space-1) var(--space-2)',
                fontSize: 'var(--font-size-xs)',
                borderRadius: 'var(--radius-control-compact)',
                marginBottom: 'var(--space-05)',
                background: severityBg(group.severity),
                display: 'flex',
                alignItems: 'flex-start',
                gap: 'var(--space-1)',
              }}
            >
              <span style={{ flex: 1, lineHeight: 1.4 }}>{issue.message}</span>
              {issue.nodeId && (
                <button
                  type="button"
                  className="preflight-warnings__select-btn"
                  onClick={() => handleSelectNode(issue.nodeId!)}
                  style={{
                    flexShrink: 0,
                    fontSize: 'var(--font-size-xs)',
                    padding: '1px 4px',
                    border: 'var(--border-micro)',
                    borderRadius: 'var(--radius-control-compact)',
                    background: 'var(--elevation-surface-default)',
                    cursor: 'pointer',
                    color: 'var(--color-text-secondary)',
                    whiteSpace: 'nowrap',
                  }}
                  aria-label={`Select node ${issue.nodeId}`}
                >
                  Select
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
      {unavailableChecks.length > 0 && (
        <div
          className="preflight-warnings__unavailable"
          style={{
            marginTop: 'var(--space-2)',
            paddingTop: 'var(--space-2)',
            borderTop: 'var(--border-micro)',
          }}
        >
          <div
            className="preflight-warnings__group-header"
            style={{
              color: 'var(--color-text-muted)',
              fontWeight: 600,
              fontSize: 'var(--font-size-sm)',
              padding: 'var(--space-1) var(--space-2)',
            }}
          >
            Not verified ({unavailableChecks.length})
          </div>
          {unavailableChecks.map((check) => (
            <div
              key={check.id}
              className="preflight-warnings__check"
              style={{
                padding: 'var(--space-1) var(--space-2)',
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-muted)',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 'var(--space-2)',
              }}
            >
              <span>{check.label}</span>
              <span style={{ flexShrink: 0 }}>{check.reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="preflight-warnings" style={{ position: 'relative', display: 'inline-flex' }}>
      {/* The panel is a portal-backed popover: an absolutely positioned panel
          inside the status bar is clipped by its overflow, so the findings were
          unreachable. */}
      <Popover
        placement="top"
        open={open}
        onOpenChange={setOpen}
        label="Preflight issues"
        popover={panel}
      >
        <button
          type="button"
          className="preflight-warnings__badge"
          aria-label={
            clean
              ? `Preflight: no issues found; ${unavailableChecks.length} check${unavailableChecks.length === 1 ? '' : 's'} unavailable`
              : `Preflight: ${ec} errors, ${wc} warnings, ${ic} info`
          }
          style={{
            color: 'var(--color-text-secondary)',
          }}
        >
          <span
            style={{
              color: highestSeverity ? severityColor(highestSeverity) : 'var(--color-text-muted)',
              display: 'inline-flex',
            }}
          >
            <Icon name={clean ? 'FileCheck' : 'TriangleAlert'} size={12} />
          </span>
          {!clean && <span className="preflight-warnings__count">{totalBadge}</span>}
        </button>
      </Popover>
    </div>
  );
}
