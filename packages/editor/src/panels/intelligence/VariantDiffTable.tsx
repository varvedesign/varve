import { Tooltip } from '@varve/ui';
import type { VariantCandidate } from '../../intelligence/componentVariantDetector';

export function candidateSignature(candidate: VariantCandidate): string {
  const sorted = [...candidate.nodeIds].sort().join(',');
  return [
    candidate.suggestedVariantName,
    candidate.differingProperties.map((dp) => dp.property).join(','),
    sorted,
  ].join('|');
}

export function scoreBadgeClass(score: number): string {
  if (score >= 85) return 'intelligence-badge--high';
  if (score >= 65) return 'intelligence-badge--medium';
  return 'intelligence-badge--low';
}

export function VariantDiffTable({ candidate }: { candidate: VariantCandidate }) {
  const nodeIds = candidate.nodeIds;
  const displayNodes = nodeIds.slice(0, 10);

  return (
    <div className="intelligence-issue" style={{ overflowX: 'auto' }}>
      <div
        style={{
          fontSize: 'var(--font-size-2xs)',
          color: 'var(--color-text-muted)',
          marginBottom: 'var(--space-1)',
        }}
      >
        Identical: {candidate.identicalProperties.join(', ') || 'none'}
      </div>
      <table
        style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-2xs)' }}
        aria-label="Node property comparison"
      >
        <thead>
          <tr>
            <th
              style={{
                textAlign: 'left',
                padding: 'var(--space-1) var(--space-1)',
                color: 'var(--color-text-muted)',
              }}
            >
              Property
            </th>
            {displayNodes.map((nid) => (
              <Tooltip key={nid} label={nid}>
                <th
                  style={{
                    textAlign: 'left',
                    padding: 'var(--space-1) var(--space-1)',
                    color: 'var(--color-text-muted)',
                    maxWidth: 80,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {nid.slice(0, 6)}
                </th>
              </Tooltip>
            ))}
          </tr>
        </thead>
        <tbody>
          {candidate.differingProperties.map((dp) => (
            <tr key={dp.property}>
              <td
                style={{
                  padding: 'var(--space-1) var(--space-1)',
                  fontWeight: 'var(--font-weight-semibold)',
                  whiteSpace: 'nowrap',
                }}
              >
                {dp.property}
                {dp.confidence !== undefined && (
                  <span style={{ marginLeft: 'var(--space-1)', opacity: 0.6 }}>
                    {Math.round(dp.confidence * 100)}%
                  </span>
                )}
              </td>
              {displayNodes.map((nid, idx) => (
                <td
                  key={nid}
                  style={{
                    padding: 'var(--space-1) var(--space-1)',
                    maxWidth: 80,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {dp.values[idx % dp.values.length] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {nodeIds.length > 10 && (
        <div
          style={{
            fontSize: 'var(--font-size-2xs)',
            color: 'var(--color-text-muted)',
            marginTop: 'var(--space-1)',
          }}
        >
          +{nodeIds.length - 10} more members
        </div>
      )}
    </div>
  );
}
