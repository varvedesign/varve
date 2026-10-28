import { Button, Dialog, Icon } from '@varve/ui';
import { useMemo, useState } from 'react';
import { useEditor } from '../../context';
import type { VariantCandidate } from '../../intelligence/componentVariantDetector';
import { buildPromotionPlan, type VariantPromotionPlan } from '../../intelligence/variantPromotion';

export function PromoteDialog({
  candidate,
  onClose,
  onPromote,
}: {
  candidate: VariantCandidate;
  onClose: () => void;
  onPromote: (plan: VariantPromotionPlan) => void;
}) {
  const { state } = useEditor();
  const [componentName, setComponentName] = useState(candidate.groupName);
  const [variantNames, setVariantNames] = useState<Record<string, string>>(() => {
    const names: Record<string, string> = {};
    candidate.memberDetails.forEach((m, i) => {
      names[m.nodeId] =
        i === 0 ? 'Default' : m.name.replace(/\s*\d*$/, '').trim() || `Variant ${i}`;
    });
    return names;
  });
  const [propertyNames, setPropertyNames] = useState<Record<string, string>>(() => {
    const names: Record<string, string> = {};
    candidate.differingProperties.forEach((dp) => {
      names[dp.property] = dp.property;
    });
    return names;
  });

  const plan = useMemo(
    () =>
      buildPromotionPlan(candidate, state.document, {
        componentName,
        properties: candidate.differingProperties.map((dp) => ({
          name: propertyNames[dp.property] ?? dp.property,
          type: dp.property === 'textContent' ? 'text' : 'variant',
        })),
        variantNames,
      }),
    [candidate, state.document, componentName, propertyNames, variantNames],
  );

  // Shared @varve/ui Dialog: native showModal() supplies initial focus,
  // containment, an inert background, Escape, and — because this dialog is
  // mounted conditionally — focus restoration on unmount. The div overlay
  // it replaces claimed aria-modal while moving focus nowhere and only
  // handled Escape when focus already happened to be inside it.
  return (
    <Dialog
      open
      onClose={onClose}
      title="Promote to component set"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" onClick={() => onPromote(plan)}>
            <Icon name="Wand" label={undefined} size="0.85em" />
            Apply
          </Button>
        </>
      }
    >
      <div className="intelligence-issue">
        <label
          style={{
            display: 'block',
            marginBottom: 'var(--space-2)',
            fontSize: 'var(--font-size-xs)',
          }}
        >
          Component name
          <input
            type="text"
            value={componentName}
            onChange={(e) => setComponentName(e.target.value)}
            style={{
              width: '100%',
              marginTop: 'var(--space-1)',
              padding: 'var(--space-1) var(--space-2)',
              background: 'var(--color-surface-raised)',
              border: 'var(--border-micro)',
              borderRadius: 'var(--radius-control-compact)',
              color: 'var(--color-text-primary)',
            }}
          />
        </label>

        <div style={{ marginBottom: 'var(--space-2)' }}>
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-semibold)',
              marginBottom: 'var(--space-1)',
            }}
          >
            Members
          </div>
          {candidate.memberDetails.map((m) => (
            <div
              key={m.nodeId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                marginBottom: 'var(--space-1)',
                fontSize: 'var(--font-size-xs)',
              }}
            >
              <span style={{ minWidth: 60, color: 'var(--color-text-muted)' }}>{m.name}</span>
              <input
                type="text"
                value={variantNames[m.nodeId] ?? ''}
                onChange={(e) =>
                  setVariantNames((prev) => ({ ...prev, [m.nodeId]: e.target.value }))
                }
                style={{
                  flex: 1,
                  padding: '2px var(--space-1)',
                  background: 'var(--color-surface-raised)',
                  border: 'var(--border-micro)',
                  borderRadius: 'var(--radius-control-compact)',
                  color: 'var(--color-text-primary)',
                  fontSize: 'var(--font-size-xs)',
                }}
                placeholder="Variant name"
              />
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 'var(--space-2)' }}>
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-semibold)',
              marginBottom: 'var(--space-1)',
            }}
          >
            Properties
          </div>
          {candidate.differingProperties.map((dp) => (
            <div
              key={dp.property}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                marginBottom: 'var(--space-1)',
                fontSize: 'var(--font-size-xs)',
              }}
            >
              <span style={{ minWidth: 60, color: 'var(--color-text-muted)' }}>{dp.property}</span>
              <input
                type="text"
                value={propertyNames[dp.property] ?? ''}
                onChange={(e) =>
                  setPropertyNames((prev) => ({ ...prev, [dp.property]: e.target.value }))
                }
                style={{
                  flex: 1,
                  padding: '2px var(--space-1)',
                  background: 'var(--color-surface-raised)',
                  border: 'var(--border-micro)',
                  borderRadius: 'var(--radius-control-compact)',
                  color: 'var(--color-text-primary)',
                  fontSize: 'var(--font-size-xs)',
                }}
                placeholder="Property name"
              />
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
