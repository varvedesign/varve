import { useState } from 'react';
import { useEditor } from '../../context';
import type { VariantCandidate } from '../../intelligence/componentVariantDetector';
import type { VariantPromotionPlan } from '../../intelligence/variantPromotion';
import { VariantCandidateCard } from './VariantCandidateCard';
import { candidateSignature } from './VariantDiffTable';
import { PromoteDialog } from './VariantPromote';

export function VariantCandidatesSection({
  candidates,
  suppressedSignatures,
  onDismiss,
}: {
  candidates: VariantCandidate[];
  suppressedSignatures: Set<string>;
  onDismiss: (signature: string) => void;
}) {
  const [promotingCandidate, setPromotingCandidate] = useState<VariantCandidate | null>(null);
  const { promoteVariantCandidates } = useEditor();

  const visible = candidates.filter((c) => !suppressedSignatures.has(candidateSignature(c)));

  if (visible.length === 0) return null;

  const handlePromote = (plan: VariantPromotionPlan) => {
    promoteVariantCandidates(
      plan.componentName,
      plan.masterNodeId,
      plan.properties,
      plan.variantAssignments.map((va) => ({ nodeId: va.nodeId, variantName: va.variantName })),
    );
    setPromotingCandidate(null);
  };

  return (
    <div style={{ marginTop: 'var(--space-3)' }}>
      <div
        className="intelligence-section__header"
        style={{ padding: 'var(--space-1) 0', marginBottom: 'var(--space-2)' }}
      >
        <span
          className="intelligence-section__title"
          style={{
            fontSize: 'var(--font-size-xs)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Variant Candidates
        </span>
        <span
          className="intelligence-badge intelligence-badge--high"
          style={{ fontSize: 'var(--font-size-2xs)' }}
        >
          {visible.length}
        </span>
      </div>
      <div className="intelligence-issue-list">
        {visible.map((candidate) => (
          <VariantCandidateCard
            key={candidateSignature(candidate)}
            candidate={candidate}
            onPromote={() => setPromotingCandidate(candidate)}
            onDismiss={() => onDismiss(candidateSignature(candidate))}
          />
        ))}
      </div>
      {promotingCandidate && (
        <PromoteDialog
          candidate={promotingCandidate}
          onClose={() => setPromotingCandidate(null)}
          onPromote={handlePromote}
        />
      )}
    </div>
  );
}
