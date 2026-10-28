import { getAuditProfile } from '@varve/scene';
import { useMemo } from 'react';
import { useEditor } from '../../context';
import { type ExtendedTab, type IntelligenceTabGroup, isTabApplicable } from './tabModel';

export function useWorkspaceTabs(): {
  primaryTabs: ExtendedTab[];
  moreGroups: IntelligenceTabGroup[];
} {
  const { state } = useEditor();
  const profile = getAuditProfile(state.workspaceMode);
  const applicability = useMemo(() => {
    const selectionCount = state.selection.length;
    const first = selectionCount === 1 ? state.document.nodes[state.selection[0]!] : undefined;
    return {
      selectionCount,
      frameSelected: first?.kind === 'frame',
      hasPrototype: Boolean(state.prototypeData),
    };
  }, [state.selection, state.document.nodes, state.prototypeData]);
  // Tabs are rebuilt only when the applicability inputs or workspace change:
  // the returned arrays are effect dependencies in IntelligencePanel, and
  // fresh identities on every render would re-run that effect pointlessly.
  return useMemo(() => {
    const applicable = (tabs: ExtendedTab[]) =>
      tabs.filter((tab) => isTabApplicable(tab, applicability));

    // Primary tabs: always review + workspace-applicable specialized tabs
    const primaryTabs: ExtendedTab[] = ['review', 'audit'];
    // Add workspace-specific specialized tabs based on primary categories
    if (
      profile.primaryCategories.includes('spacing') ||
      profile.primaryCategories.includes('layout')
    ) {
      primaryTabs.push('spacing');
    }
    if (
      profile.primaryCategories.includes('governance') ||
      profile.primaryCategories.includes('layer-hygiene')
    ) {
      primaryTabs.push('naming');
    }

    // More groups based on workspace
    const moreGroups: IntelligenceTabGroup[] = [];

    const qualityTabs: ExtendedTab[] = [];
    // Naming is a layer-hygiene tool. It rides in the More menu when the
    // workspace treats governance as secondary (Design), and is promoted to a
    // primary tab when governance drives the workspace.
    if (
      !primaryTabs.includes('naming') &&
      (profile.secondaryCategories.includes('layer-hygiene') ||
        profile.secondaryCategories.includes('governance'))
    ) {
      qualityTabs.push('naming');
    }
    if (
      profile.secondaryCategories.includes('accessibility') ||
      profile.hiddenCategories.length === 0
    ) {
      qualityTabs.push('debt');
    }
    qualityTabs.push('linter');
    if (qualityTabs.length > 0) moreGroups.push({ label: 'Quality', tabs: qualityTabs });

    const dsTabs: ExtendedTab[] = [];
    if (
      profile.primaryCategories.includes('governance') ||
      profile.secondaryCategories.includes('governance')
    ) {
      dsTabs.push('governance');
    }
    dsTabs.push('components');
    if (dsTabs.length > 0) moreGroups.push({ label: 'Design Systems', tabs: dsTabs });

    const analysisTabs: ExtendedTab[] = [];
    // Spacing rides with the other target-driven analysis tools when the
    // workspace treats it as secondary (Design). Without this it had no entry
    // point at all outside workspace modes that promote it.
    if (
      !primaryTabs.includes('spacing') &&
      (profile.secondaryCategories.includes('spacing') ||
        profile.secondaryCategories.includes('layout'))
    ) {
      analysisTabs.push('spacing');
    }
    if (profile.primaryCategories.includes('prototype')) {
      analysisTabs.push('prototype');
    }
    analysisTabs.push('layout', 'similar');
    moreGroups.push({ label: 'Analysis', tabs: analysisTabs });

    return {
      primaryTabs: applicable(primaryTabs),
      moreGroups: moreGroups
        .map((group) => ({ ...group, tabs: applicable(group.tabs) }))
        .filter((group) => group.tabs.length > 0),
    };
  }, [applicability, profile]);
}
