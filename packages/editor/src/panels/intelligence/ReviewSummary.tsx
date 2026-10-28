import type { AuditFinding, SuppressionEntry } from '@varve/scene';
import { Icon } from '@varve/ui';
import type { ScanProgress } from '../../audit/auditWorker';
import { humanizeToken, severityLabel } from './shared';

interface ReviewSummaryProps {
  filteredFindings: AuditFinding[];
  sevCounts: { error: number; warning: number; suggestion: number; advisory: number };
  isScanning: boolean;
  progress: ScanProgress | null;
  runReview: () => void;
  applicableCategories: string[];
  byCategory: Record<string, AuditFinding[]>;
  filterCategory: string | null;
  setFilterCategory: (value: string | null) => void;
  filterSeverity: string | null;
  setFilterSeverity: (value: string | null) => void;
  severityKinds: ReadonlyArray<'error' | 'warning' | 'suggestion' | 'advisory'>;
  severityCounts: (severity: string) => number;
  suppressions: SuppressionEntry[];
  setSuppressions: (value: SuppressionEntry[]) => void;
}

export function ReviewSummary({
  filteredFindings,
  sevCounts,
  isScanning,
  progress,
  runReview,
  applicableCategories,
  byCategory,
  filterCategory,
  setFilterCategory,
  filterSeverity,
  setFilterSeverity,
  severityKinds,
  severityCounts,
  suppressions,
  setSuppressions,
}: ReviewSummaryProps) {
  return (
    <>
      {/* Summary bar */}
      <div className="intelligence-analysis" style={{ marginBottom: 'var(--space-2)' }}>
        <div className="intelligence-analysis__row">
          <span>Total</span>
          <span className="intelligence-analysis__value">{filteredFindings.length}</span>
        </div>
        {sevCounts.error > 0 && (
          <div className="intelligence-analysis__row">
            <span>Errors</span>
            <span className="intelligence-analysis__value intelligence-analysis__value--error">
              {sevCounts.error}
            </span>
          </div>
        )}
        {sevCounts.warning > 0 && (
          <div className="intelligence-analysis__row">
            <span>Warnings</span>
            <span className="intelligence-analysis__value intelligence-analysis__value--warning">
              {sevCounts.warning}
            </span>
          </div>
        )}
        {sevCounts.suggestion > 0 && (
          <div className="intelligence-analysis__row">
            <span>Suggestions</span>
            <span className="intelligence-analysis__value">{sevCounts.suggestion}</span>
          </div>
        )}
        {sevCounts.advisory > 0 && (
          <div className="intelligence-analysis__row">
            <span>Advisories</span>
            <span className="intelligence-analysis__value">{sevCounts.advisory}</span>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-1)',
          marginBottom: 'var(--space-2)',
          alignItems: 'center',
        }}
      >
        <button
          type="button"
          className="intelligence-action-btn"
          onClick={runReview}
          disabled={isScanning}
        >
          <Icon name={isScanning ? 'Loader' : 'RotateCcw'} label={undefined} size="0.85em" />
          {isScanning ? 'Scanning…' : 'Re-scan'}
        </button>
        {isScanning && progress && (
          <span style={{ fontSize: 'var(--font-size-2xs)', opacity: 0.6 }}>
            {progress.completed}/{progress.total}
          </span>
        )}
      </div>

      {/* Filter chips: category first, then severity. Severity chips only
          appear when the report actually mixes severities — a single-severity
          report does not need a filter it can never narrow. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-1)',
          marginBottom: 'var(--space-2)',
        }}
      >
        {applicableCategories
          .filter((cat) => byCategory[cat] && byCategory[cat]!.length > 0)
          .map((cat) => (
            <button
              key={cat}
              type="button"
              className={`intelligence-filter-chip${filterCategory === cat ? ' intelligence-filter-chip--active' : ''}`}
              onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
            >
              {humanizeToken(cat)} ({byCategory[cat]!.length})
            </button>
          ))}
        {filterCategory && (
          <button
            type="button"
            className="intelligence-filter-chip intelligence-filter-chip--clear"
            onClick={() => setFilterCategory(null)}
          >
            Clear filter
          </button>
        )}
      </div>
      {severityKinds.length > 1 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-1)',
            marginBottom: 'var(--space-2)',
          }}
        >
          {severityKinds.map((severity) => (
            <button
              key={severity}
              type="button"
              className={`intelligence-filter-chip intelligence-filter-chip--severity-${severity}${filterSeverity === severity ? ' intelligence-filter-chip--active' : ''}`}
              onClick={() => setFilterSeverity(filterSeverity === severity ? null : severity)}
            >
              {severityLabel(severity)} ({severityCounts(severity)})
            </button>
          ))}
          {filterSeverity && (
            <button
              type="button"
              className="intelligence-filter-chip intelligence-filter-chip--clear"
              onClick={() => setFilterSeverity(null)}
            >
              Clear severity
            </button>
          )}
        </div>
      )}
      {suppressions.length > 0 && (
        <p className="intelligence-hint">
          {suppressions.length} finding{suppressions.length === 1 ? '' : 's'} suppressed this
          session.{' '}
          <button
            type="button"
            className="intelligence-inline-action"
            onClick={() => setSuppressions([])}
          >
            Restore
          </button>
        </p>
      )}
    </>
  );
}
