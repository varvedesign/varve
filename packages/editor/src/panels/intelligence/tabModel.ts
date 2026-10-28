import type { IntelligenceTab } from '../../context/types';

/**
 * Workspace-aware tab structure:
 * - 'review' tab is the new unified audit finding view using the AuditFinding model
 * - Other tabs remain as specialized tools
 * - Tabs are filtered by applicability so a tab never opens onto a dead end
 *   ("select a frame…") — the 2026-09-16 review found dead tabs were the
 *   single biggest source of "wrong panel for the current target" noise.
 */
export type ExtendedTab = IntelligenceTab | 'review';

export interface IntelligenceTabGroup {
  label: string;
  tabs: ExtendedTab[];
}

/** Human labels. The raw ids ("review", "debt") leaked implementation jargon. */
const TAB_LABELS: Record<ExtendedTab, string> = {
  review: 'Review',
  audit: 'Contrast',
  spacing: 'Spacing',
  naming: 'Names',
  governance: 'Governance',
  debt: 'Design debt',
  prototype: 'Prototype',
  layout: 'Auto layout',
  components: 'Components',
  similar: 'Similar layers',
  linter: 'Linter',
};

export function tabLabel(tab: ExtendedTab): string {
  return TAB_LABELS[tab] ?? tab;
}

/**
 * Whether a tab has anything to act on for the current document/selection.
 * Document-level scans are always available; selection-scoped tools need a
 * target that can produce a result.
 */
export function isTabApplicable(
  tab: ExtendedTab,
  ctx: { selectionCount: number; frameSelected: boolean; hasPrototype: boolean },
): boolean {
  switch (tab) {
    case 'spacing':
      return ctx.selectionCount >= 2;
    case 'naming':
      return ctx.selectionCount >= 1;
    case 'layout':
      return ctx.frameSelected;
    case 'prototype':
      return ctx.hasPrototype;
    // Similar layers keeps a no-selection text query, so it stays available
    // even with nothing selected — its own empty state is the search field.
    default:
      return true;
  }
}
