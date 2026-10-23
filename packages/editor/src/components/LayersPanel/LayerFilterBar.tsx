import { Menu, SearchField, SOLID_CHROME_ICONS, SolidIcon, Tooltip } from '@varve/ui';
import type React from 'react';
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { LayersQuickFilter } from '../../workspace/workspaceTypes';
import { activeFilterTokens, buildLayerFilterMenu, type FilterToken } from './layerFilterMenu';
import { DEFAULT_FILTER, isFiltering, type LayerFilterSpec } from './layerFilterTypes';

interface LayerFilterBarProps {
  filter: LayerFilterSpec;
  onChange: (filter: LayerFilterSpec) => void;
  matchCount: number;
  totalCount: number;
  /** One-click presets configured by the active workspace. */
  quickFilters?: readonly LayersQuickFilter[];
  /** Workspace-provided search placeholder copy. */
  searchPlaceholder?: string;
  /** Select every row in the current filtered projection. */
  onSelectMatches?: () => void;
  /** Select the next (1) or previous (-1) match; Enter / Shift+Enter in the field. */
  onStepMatch?: (direction: 1 | -1) => void;
  /** Move focus into the tree at the first match; ArrowDown in the field. */
  onFocusResults?: () => void;
}

/**
 * Attribute dimensions whose value is a boolean flag. Restricting the quick
 * filter target to these keys keeps `attributes[key] = true` type-safe (a
 * union key over the whole interface includes `layerColor`, whose type is not
 * boolean).
 */
type BooleanAttributeKey =
  | 'locked'
  | 'visible'
  | 'hasChildren'
  | 'isComponent'
  | 'isInstance'
  | 'hasEffects'
  | 'isMasked'
  | 'mobileHidden'
  | 'mobileOnly'
  | 'threadedText'
  | 'exportRegion'
  | 'animated';

/**
 * Quick-filter presets map onto the same attribute dimensions as the Filter
 * menu; a preset is therefore a shortcut, never a second filter model.
 */
const QUICK_FILTER_TARGET: Record<LayersQuickFilter, BooleanAttributeKey> = {
  animated: 'animated',
  'mobile-hidden': 'mobileHidden',
  'threaded-text': 'threadedText',
  'export-regions': 'exportRegion',
  masks: 'isMasked',
  components: 'isComponent',
};

const QUICK_FILTER_LABELS: Record<LayersQuickFilter, string> = {
  animated: 'Animated',
  'mobile-hidden': 'Mobile hidden',
  'threaded-text': 'Threaded text',
  'export-regions': 'Export regions',
  masks: 'Masked',
  components: 'Components',
};

const FILTER_MENU_ID = 'layers-filter-menu';

/**
 * Ctrl/Cmd+F while focus is anywhere in the Layers panel moves to the layer
 * search and selects its text. Called from the panel's React keydown, which
 * runs before the window-level shortcut listener, so stopping propagation
 * keeps the key from reaching editor shortcuts or the browser's find bar.
 */
export function focusLayerSearchOnFind(
  event: React.KeyboardEvent,
  field: HTMLInputElement | null,
): void {
  if (!field || event.altKey || event.shiftKey) return;
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return;
  event.preventDefault();
  event.stopPropagation();
  field.focus();
  field.select();
}

export const LayerFilterBar = forwardRef<HTMLInputElement, LayerFilterBarProps>(
  function LayerFilterBar(
    {
      filter,
      onChange,
      matchCount,
      totalCount,
      quickFilters = [],
      searchPlaceholder = 'Filter layers…',
      onSelectMatches,
      onStepMatch,
      onFocusResults,
    },
    ref,
  ) {
    const [menuOpen, setMenuOpen] = useState(false);
    const filterRef = useRef<HTMLInputElement>(null);
    const menuTriggerRef = useRef<HTMLButtonElement>(null);
    const tokenListRef = useRef<HTMLUListElement>(null);
    // The search input is always mounted, so the handle is never null.
    useImperativeHandle(ref, () => filterRef.current as HTMLInputElement, []);

    const hasActiveFilter = isFiltering(filter);
    const menuItems = useMemo(() => buildLayerFilterMenu(filter, onChange), [filter, onChange]);
    const allTokens = useMemo(() => activeFilterTokens(filter), [filter]);
    // A pressed workspace preset already shows its constraint; a token for it
    // would say the same thing twice.
    const tokens = allTokens.filter(
      (token) =>
        !quickFilters.some((preset) => {
          const key = QUICK_FILTER_TARGET[preset];
          return token.id === `attr-${key}` && filter.attributes[key] === true;
        }),
    );

    const clearAll = useCallback(() => {
      onChange(DEFAULT_FILTER);
      filterRef.current?.focus();
    }, [onChange]);

    const removeToken = useCallback(
      (token: FilterToken, index: number) => {
        onChange(token.remove(filter));
        // The removed token unmounts with focus on it; land on its neighbour,
        // or back in the field once the row is empty.
        requestAnimationFrame(() => {
          const remaining = tokenListRef.current?.querySelectorAll<HTMLButtonElement>(
            '.layers-filter-bar__token',
          );
          const next = remaining?.[Math.min(index, remaining.length - 1)];
          (next ?? filterRef.current)?.focus();
        });
      },
      [filter, onChange],
    );

    const toggleQuickFilter = useCallback(
      (preset: LayersQuickFilter) => {
        const key = QUICK_FILTER_TARGET[preset];
        const wasActive = filter.attributes[key] === true;
        const merged: LayerFilterSpec['attributes'] = { ...filter.attributes };
        merged[key] = true;
        if (wasActive) delete merged[key];
        onChange({ ...filter, attributes: merged });
      },
      [filter, onChange],
    );

    const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return;
      let handled = true;
      if (event.key === 'Escape' && filter.search !== '') {
        // First Escape clears the text (and nothing else); the next one leaves.
        onChange({ ...filter, search: '' });
      } else if ((event.key === 'Escape' || event.key === 'ArrowDown') && onFocusResults) {
        onFocusResults();
      } else if (event.key === 'Enter' && onStepMatch && hasActiveFilter) {
        onStepMatch(event.shiftKey ? -1 : 1);
      } else {
        handled = false;
      }
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const activeCount = allTokens.length;

    return (
      <search className="layers-filter-bar" aria-label="Filter layers">
        <div className="layers-filter-bar__search-row">
          <SearchField
            ref={filterRef}
            value={filter.search}
            onChange={(v) => onChange({ ...filter, search: v })}
            onKeyDown={handleSearchKeyDown}
            placeholder={searchPlaceholder}
            aria-label="Filter layers by name"
            aria-keyshortcuts="Control+F Meta+F"
            resultCount={matchCount}
          />
          <button
            ref={menuTriggerRef}
            type="button"
            className={`layers-filter-bar__toggle-advanced${menuOpen || activeCount > 0 ? ' layers-filter-bar__toggle-advanced--active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? FILTER_MENU_ID : undefined}
            aria-label={
              activeCount > 0 ? `Filter options, ${activeCount} active` : 'Filter options'
            }
            onClick={() => setMenuOpen((open) => !open)}
          >
            <SolidIcon name={SOLID_CHROME_ICONS.filter} size="0.85em" />
            {activeCount > 0 && (
              <span className="layers-filter-bar__badge" aria-hidden="true">
                {activeCount}
              </span>
            )}
          </button>
          {menuOpen && (
            <Menu
              items={menuItems}
              triggerRef={menuTriggerRef}
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              label="Filter layers"
              id={FILTER_MENU_ID}
            />
          )}
          {hasActiveFilter && (
            <button
              type="button"
              className="layers-filter-bar__clear-all"
              onClick={clearAll}
              aria-label="Clear all filters"
            >
              Clear
            </button>
          )}
        </div>

        {tokens.length > 0 && (
          <ul ref={tokenListRef} className="layers-filter-bar__tokens" aria-label="Active filters">
            {tokens.map((token, index) => (
              <li key={token.id}>
                <button
                  type="button"
                  className="layers-filter-bar__token"
                  aria-label={`Remove filter: ${token.label}`}
                  onClick={() => removeToken(token, index)}
                >
                  <span>{token.label}</span>
                  <SolidIcon name={SOLID_CHROME_ICONS.close} size="0.75em" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {quickFilters.length > 0 && (
          // biome-ignore lint/a11y/useSemanticElements: named workspace filter toggles are buttons, not form fields.
          <div className="layers-filter-bar__quick" role="group" aria-label="Workspace filters">
            {quickFilters.map((preset) => {
              const key = QUICK_FILTER_TARGET[preset];
              const active = filter.attributes[key] === true;
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={active}
                  className={`layers-filter-bar__chip layers-filter-bar__chip--quick${active ? ' layers-filter-bar__chip--active' : ''}`}
                  onClick={() => toggleQuickFilter(preset)}
                >
                  {QUICK_FILTER_LABELS[preset]}
                </button>
              );
            })}
          </div>
        )}

        {hasActiveFilter && (
          <div className="layers-filter-bar__count">
            <span aria-live="polite">
              {matchCount} of {totalCount} layer{totalCount !== 1 ? 's' : ''}
            </span>
            {onStepMatch && matchCount > 0 && (
              // biome-ignore lint/a11y/useSemanticElements: a pair of commands, not a form field set.
              <span
                className="layers-filter-bar__step"
                role="group"
                aria-label="Step through matches"
              >
                <Tooltip label="Previous match (Shift+Enter)">
                  <button
                    type="button"
                    className="layers-filter-bar__step-btn"
                    aria-label="Previous match"
                    aria-keyshortcuts="Shift+Enter"
                    onClick={() => onStepMatch(-1)}
                  >
                    <SolidIcon name={SOLID_CHROME_ICONS.chevronUp} size="0.85em" />
                  </button>
                </Tooltip>
                <Tooltip label="Next match (Enter)">
                  <button
                    type="button"
                    className="layers-filter-bar__step-btn"
                    aria-label="Next match"
                    aria-keyshortcuts="Enter"
                    onClick={() => onStepMatch(1)}
                  >
                    <SolidIcon name={SOLID_CHROME_ICONS.chevronDown} size="0.85em" />
                  </button>
                </Tooltip>
              </span>
            )}
            {onSelectMatches && matchCount > 0 && (
              <button
                type="button"
                className="layers-filter-bar__select-matches"
                onClick={onSelectMatches}
              >
                Select matches
              </button>
            )}
          </div>
        )}
      </search>
    );
  },
);
