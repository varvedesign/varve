/**
 * IntelligencePanel — surfaces audit issues, smart spacing, and auto-naming.
 *
 * Three tabs: Audit (issues & warnings), Spacing (gap analysis & harmonize),
 * Naming (suggested renames). Follows the same collapsible-section pattern
 * used by the rest of the inspector.
 *
 * Research basis: Figma's "Design review" + "Smart selection" panel concepts;
 * APG Disclosure pattern for collapsible groups.
 */

import { Icon, Menu, type MenuEntry } from '@varve/ui';
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import '../components/Inspector/inspector.css';
import { AuditTab } from './intelligence/AuditTab';
import { ComponentsTab } from './intelligence/ComponentsTab';
import { DebtTab } from './intelligence/DebtTab';
import { GovernanceTab } from './intelligence/GovernanceTab';
import { LayoutTab } from './intelligence/LayoutTab';
import { LinterTab } from './intelligence/LinterTab';
import { NamingTab } from './intelligence/NamingTab';
import { PrototypeTab } from './intelligence/PrototypeTab';
import { ReviewTab } from './intelligence/ReviewTab';
import { SpacingTab } from './intelligence/SpacingTab';
import { SimilarTab } from './intelligence/similar/SimilarTab';
import { type ExtendedTab, tabLabel } from './intelligence/tabModel';
import { useWorkspaceTabs } from './intelligence/useWorkspaceTabs';

export function IntelligencePanel({ initialTab }: { initialTab?: ExtendedTab } = {}) {
  const { primaryTabs, moreGroups } = useWorkspaceTabs();
  const [tab, setTab] = useState<ExtendedTab>(initialTab ?? primaryTabs[0] ?? 'review');
  const [showMore, setShowMore] = useState(false);
  const tabIdPrefix = useId();
  const primaryTabRefs = useRef(new Map<ExtendedTab, HTMLButtonElement>());
  const moreTriggerRef = useRef<HTMLButtonElement>(null);

  const allMoreTabs = moreGroups.flatMap((g) => g.tabs);
  const moreLabel = allMoreTabs.find((t) => t === tab) ?? null;
  // A tab can become inapplicable under the current selection (e.g. Spacing
  // with one layer selected). Fall back to the first applicable tab instead
  // of leaving the tab bar without a selection.
  useEffect(() => {
    const available = [...primaryTabs, ...allMoreTabs];
    if (!available.includes(tab)) {
      const fallback = primaryTabs[0] ?? allMoreTabs[0] ?? 'review';
      setTab(fallback);
    }
  }, [primaryTabs, allMoreTabs, tab]);
  const moreMenuItems = useMemo<MenuEntry[]>(
    () =>
      moreGroups.flatMap((group, groupIndex) => [
        ...(groupIndex > 0 ? [{ id: `separator-${group.label}`, separator: true as const }] : []),
        ...group.tabs.map((t) => ({
          id: t,
          label: `${tabLabel(t)} · ${group.label}`,
          onAction: () => {
            setTab(t);
            setShowMore(false);
          },
        })),
      ]),
    [moreGroups],
  );

  const handlePrimaryTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (primaryTabs.length === 0) return;
      let nextIndex: number | undefined;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % primaryTabs.length;
      else if (event.key === 'ArrowLeft')
        nextIndex = (index - 1 + primaryTabs.length) % primaryTabs.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = primaryTabs.length - 1;
      else return;

      event.preventDefault();
      const nextTab = primaryTabs[nextIndex];
      if (!nextTab) return;
      setTab(nextTab);
      primaryTabRefs.current.get(nextTab)?.focus({ preventScroll: true });
    },
    [primaryTabs],
  );

  const activePanelId = `${tabIdPrefix}-panel-${tab}`;
  const activeTabId = primaryTabs.includes(tab)
    ? `${tabIdPrefix}-tab-${tab}`
    : `${tabIdPrefix}-more`;

  return (
    <div className="intelligence-panel">
      <div className="intelligence-tabs-row">
        <div className="intelligence-tabs" role="tablist" aria-label="Intelligence tabs">
          {primaryTabs.map((t, index) => (
            <button
              type="button"
              key={t}
              id={`${tabIdPrefix}-tab-${t}`}
              role="tab"
              className="intelligence-tab"
              aria-selected={tab === t}
              aria-controls={`${tabIdPrefix}-panel-${t}`}
              tabIndex={tab === t || (!primaryTabs.includes(tab) && index === 0) ? 0 : -1}
              onKeyDown={(event) => handlePrimaryTabKeyDown(event, index)}
              onClick={() => setTab(t)}
              ref={(element) => {
                if (element) primaryTabRefs.current.set(t, element);
                else primaryTabRefs.current.delete(t);
              }}
            >
              {t === 'review' && <Icon name="ShieldCheck" label={undefined} size="0.9em" />}
              {t === 'audit' && <Icon name="Lightbulb" label={undefined} size="0.9em" />}
              {tabLabel(t)}
            </button>
          ))}
        </div>
        <button
          type="button"
          id={`${tabIdPrefix}-more`}
          ref={moreTriggerRef}
          className={`intelligence-tab intelligence-more-trigger${moreLabel ? ' intelligence-tab--active' : ''}`}
          aria-label={
            moreLabel ? `${tabLabel(moreLabel)} (More intelligence tabs)` : 'More intelligence tabs'
          }
          aria-controls={moreLabel ? activePanelId : undefined}
          aria-haspopup="menu"
          aria-expanded={showMore}
          onClick={() => setShowMore((s) => !s)}
        >
          {moreLabel ? tabLabel(moreLabel) : 'More'}
        </button>
      </div>
      <Menu
        triggerRef={moreTriggerRef}
        open={showMore}
        onClose={() => setShowMore(false)}
        label="More intelligence tabs"
        items={moreMenuItems}
        size="default"
      />

      <div
        id={activePanelId}
        role="tabpanel"
        aria-labelledby={activeTabId}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: APG pattern — tabpanel is a focus target
        tabIndex={0}
        className="intelligence-tabpanel"
      >
        {tab === 'review' && <ReviewTab />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'spacing' && <SpacingTab />}
        {tab === 'naming' && <NamingTab />}
        {tab === 'governance' && <GovernanceTab />}
        {tab === 'debt' && <DebtTab />}
        {tab === 'prototype' && <PrototypeTab />}
        {tab === 'layout' && <LayoutTab />}
        {tab === 'components' && <ComponentsTab />}
        {tab === 'similar' && <SimilarTab />}
        {tab === 'linter' && <LinterTab />}
      </div>
    </div>
  );
}
