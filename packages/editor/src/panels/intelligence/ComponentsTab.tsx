/* ------------------------------------------------------------------ */
/*  Tab 8: Components — Duplicate Detection + Variant Candidates       */
/* ------------------------------------------------------------------ */

import { Icon, Tooltip } from '@varve/ui';
import { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../../context';
import { findDuplicateStructures } from '../../intelligence/componentDetector';
import { detectVariantCandidates } from '../../intelligence/componentVariantDetector';
import { SeverityMark } from './shared';
import { VariantCandidatesSection } from './VariantCandidatesSection';

export function ComponentsTab() {
  const { state, setSelection, createComponentFromGroup } = useEditor();
  const [suppressedSignatures, setSuppressedSignatures] = useState<Set<string>>(new Set());

  const groups = useMemo(() => findDuplicateStructures(state.document), [state.document]);
  const variantCandidates = useMemo(
    () => detectVariantCandidates(state.document),
    [state.document],
  );

  const handleDismiss = useCallback((signature: string) => {
    setSuppressedSignatures((prev) => {
      const next = new Set(prev);
      next.add(signature);
      return next;
    });
  }, []);

  if (groups.length === 0 && variantCandidates.length === 0) {
    return (
      <div className="intelligence-empty">
        <Icon name="Component" label={undefined} size="1.2em" />
        <p>No duplicate structures or variant candidates found</p>
      </div>
    );
  }

  return (
    <div className="intelligence-tab-content">
      {groups.length > 0 && (
        <div>
          <div className="intelligence-section__header" style={{ marginBottom: 'var(--space-2)' }}>
            <span className="intelligence-section__title">Duplicates</span>
            <span className="intelligence-section__count">{groups.length}</span>
          </div>
          {groups.map((group) => (
            <details key={group.nodeIds.join(',')} className="intelligence-section" open>
              <summary className="intelligence-section__header">
                <span className="intelligence-section__title">{group.reason}</span>
                <span className="intelligence-section__count">{group.nodeIds.length}</span>
                <span
                  className="intelligence-badge intelligence-badge--high"
                  style={{ marginLeft: 'auto' }}
                >
                  {Math.round(group.score * 100)}%
                </span>
              </summary>
              <div className="intelligence-issue-list">
                {group.nodeIds.map((nid) => (
                  <div key={nid} className="intelligence-issue intelligence-issue--info">
                    <Tooltip label="Select this node">
                      <button
                        type="button"
                        className="intelligence-issue__target"
                        onClick={() => setSelection(nid)}
                      >
                        <SeverityMark severity="info" />
                        <span className="intelligence-issue__type">{nid}</span>
                      </button>
                    </Tooltip>
                  </div>
                ))}
                {group.suggestComponent && (
                  <button
                    type="button"
                    className="intelligence-action-btn"
                    style={{ marginTop: 'var(--space-1)' }}
                    onClick={() => createComponentFromGroup(group.nodeIds)}
                  >
                    <Icon name="Wand" label={undefined} size="0.85em" />
                    Create component
                  </button>
                )}
              </div>
            </details>
          ))}
        </div>
      )}

      <VariantCandidatesSection
        candidates={variantCandidates}
        suppressedSignatures={suppressedSignatures}
        onDismiss={handleDismiss}
      />
    </div>
  );
}
