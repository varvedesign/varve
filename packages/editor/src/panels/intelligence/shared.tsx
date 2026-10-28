import { Icon } from '@varve/ui';

/**
 * Turn an internal token ("layer-hygiene", "debt/unnamed-layers") into display
 * text ("Layer hygiene", "Unnamed layers"). Internal ids stay in `title`
 * attributes so they remain traceable to the rule source.
 */
export function humanizeToken(value: string): string {
  const tail = value.includes('/') ? value.slice(value.lastIndexOf('/') + 1) : value;
  const spaced = tail.replace(/[-_]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Severity as shape and text, not hue alone (WCAG 1.4.1, F-30): the issue
 * lists are grouped by category, so a coloured dot was the only severity
 * cue. Icons follow the Preflight panel's mapping.
 */
const SEVERITY_MARKS = {
  error: { icon: 'TriangleAlert', label: 'Error' },
  warning: { icon: 'CircleAlert', label: 'Warning' },
  info: { icon: 'Info', label: 'Info' },
} as const;

export function SeverityMark({ severity }: { severity: string }) {
  const mark =
    severity === 'error' || severity === 'warning' ? SEVERITY_MARKS[severity] : SEVERITY_MARKS.info;
  return (
    <span className="intelligence-severity-mark">
      <Icon name={mark.icon} size={12} label={undefined} />
      <span className="varve-visually-hidden">{mark.label}: </span>
    </span>
  );
}

/** Plural, human labels for the severity filter chips (never raw ids). */
const SEVERITY_LABELS: Record<string, string> = {
  error: 'Errors',
  warning: 'Warnings',
  suggestion: 'Suggestions',
  advisory: 'Advisories',
};

export function severityLabel(severity: string): string {
  return SEVERITY_LABELS[severity] ?? humanizeToken(severity);
}
