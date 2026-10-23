import { SearchField } from '@varve/ui';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import { matchesInspectorSectionQuery } from './inspectorSectionSearch';
import type { SectionId } from './sectionRegistry';

interface SearchableSection {
  id: SectionId;
  title: string;
  content: ReactNode;
}

interface InspectorSectionSearchState {
  active: boolean;
  visibleIds: ReadonlySet<SectionId>;
}

const InspectorSectionSearchContext = createContext<InspectorSectionSearchState>({
  active: false,
  visibleIds: new Set(),
});

export function useInspectorSectionSearch(sectionId: SectionId): {
  visible: boolean;
  forceExpanded: boolean;
} {
  const search = useContext(InspectorSectionSearchContext);
  const matched = search.visibleIds.has(sectionId);
  return {
    visible: !search.active || matched,
    // Filter results must expose the matching properties immediately. The
    // stored collapse state is untouched and returns as soon as the query clears.
    forceExpanded: search.active && matched,
  };
}

export function InspectorSectionSearch({ sections }: { sections: readonly SearchableSection[] }) {
  const [query, setQuery] = useState('');
  const visibleIds = useMemo(() => {
    const matching = new Set<SectionId>();
    for (const section of sections) {
      if (matchesInspectorSectionQuery(section.id, section.title, query)) matching.add(section.id);
    }
    return matching;
  }, [query, sections]);
  const active = query.trim().length > 0;
  const visibleSections = active
    ? sections.filter((section) => visibleIds.has(section.id))
    : sections;

  return (
    <InspectorSectionSearchContext.Provider value={{ active, visibleIds }}>
      <div className="insp-section-search">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Find a property…"
          aria-label="Find a property in the Inspector"
          resultCount={active ? visibleIds.size : undefined}
        />
        {active && visibleIds.size === 0 && (
          <p className="insp-section-search__empty" role="status">
            No properties match “{query}”. Try a section name or property such as opacity, fill, or
            font.
          </p>
        )}
      </div>
      {active && visibleIds.size === 0 ? null : visibleSections.map((section) => section.content)}
    </InspectorSectionSearchContext.Provider>
  );
}
