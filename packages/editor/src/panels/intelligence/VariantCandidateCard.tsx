import { Icon, Tooltip } from '@varve/ui';
import { useState } from 'react';
import { useEditor } from '../../context';
import type { VariantCandidate } from '../../intelligence/componentVariantDetector';
import { scoreBadgeClass, VariantDiffTable } from './VariantDiffTable';

export function VariantCandidateCard({
  candidate,
  onPromote,
  onDismiss,
}: {
  candidate: VariantCandidate;
  onPromote: () => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { setSelection } = useEditor();
  const badgeClass = scoreBadgeClass(candidate.score);

  return (
    <div className="intelligence-issue intelligence-issue--info">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          marginBottom: 'var(--space-1)',
        }}
      >
        <span
          style={{
            fontWeight: 'var(--font-weight-semibold)',
            fontSize: 'var(--font-size-xs)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {candidate.groupName}
        </span>
        <span className={`intelligence-badge ${badgeClass}`}>{candidate.score}%</span>
        <span className="intelligence-section__count">{candidate.nodeIds.length}</span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 'var(--space-1)',
          flexWrap: 'wrap',
          marginBottom: 'var(--space-1)',
        }}
      >
        {candidate.memberDetails.slice(0, 6).map((m) => (
          <Tooltip key={m.nodeId} label={m.name}>
            <button
              type="button"
              className="intelligence-issue__target"
              onClick={() => setSelection(m.nodeId)}
              style={{
                fontSize: 'var(--font-size-2xs)',
                padding: '2px var(--space-1)',
                background: 'var(--color-surface-raised)',
                border: 'var(--border-micro)',
                borderRadius: 'var(--radius-control-compact)',
              }}
            >
              {m.name || m.nodeId.slice(0, 6)}
            </button>
          </Tooltip>
        ))}
        {candidate.memberDetails.length > 6 && (
          <span
            style={{
              fontSize: 'var(--font-size-2xs)',
              color: 'var(--color-text-muted)',
              alignSelf: 'center',
            }}
          >
            +{candidate.memberDetails.length - 6}
          </span>
        )}
      </div>

      <div
        style={{
          fontSize: 'var(--font-size-2xs)',
          color: 'var(--color-text-muted)',
          marginBottom: 'var(--space-1)',
        }}
      >
        Varies: {candidate.differingProperties.map((dp) => dp.property).join(', ')}
      </div>

      {expanded && <VariantDiffTable candidate={candidate} />}

      <div style={{ display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
        <button
          type="button"
          className="intelligence-action-btn"
          style={{
            background: 'none',
            color: 'var(--color-text-secondary)',
            padding: '0 var(--space-1)',
            height: 'var(--space-4)',
          }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Hide diff' : 'Show diff'}
        </button>
        <button
          type="button"
          className="intelligence-action-btn"
          style={{ height: 'var(--space-4)', padding: '0 var(--space-2)' }}
          onClick={onPromote}
        >
          <Icon name="Wand" label={undefined} size="0.75em" />
          Promote
        </button>
        <button
          type="button"
          className="intelligence-action-btn"
          style={{
            background: 'none',
            color: 'var(--color-text-muted)',
            height: 'var(--space-4)',
            padding: '0 var(--space-1)',
            marginLeft: 'auto',
          }}
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
