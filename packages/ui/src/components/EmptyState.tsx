import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** SVG markup for illustration (no emoji). Use an `<svg>` fragment. */
  illustration: ReactNode;
  headline: string;
  description?: string;
  actions?: ReactNode;
  /**
   * Heading level for the headline. Defaults to 3 so every existing caller
   * keeps its document outline. Pass 2 when the empty state sits directly
   * under the page's `<h1>` — otherwise the outline jumps h1 → h3 and screen
   * reader heading navigation loses a level (axe: heading-order).
   */
  headingLevel?: 2 | 3 | 4;
}

export function EmptyState({
  illustration,
  headline,
  description,
  actions,
  headingLevel = 3,
}: EmptyStateProps) {
  const Headline = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  return (
    <div className="varve-empty" role="status">
      <div className="varve-empty__illustration" aria-hidden>
        {illustration}
      </div>
      <Headline className="varve-empty__headline">{headline}</Headline>
      {description && <p className="varve-empty__desc">{description}</p>}
      {actions && <div className="varve-empty__actions">{actions}</div>}
    </div>
  );
}
