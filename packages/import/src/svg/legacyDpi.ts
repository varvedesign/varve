/** Import warning for pre-0.92 Inkscape files whose physical scale is ambiguous. */
export const LEGACY_INKSCAPE_DPI_WARNING =
  'Legacy Inkscape SVG without a viewBox may use 90-dpi dimensions; verify physical size after import.';

export function hasLegacyInkscapeDpiRisk(
  version: string | undefined,
  viewBox: string | undefined,
  hasExplicitSize: boolean,
): boolean {
  if (!version || hasUsableViewBox(viewBox) || !hasExplicitSize) return false;
  const match = version.trim().match(/^(\d+)\.(\d+)(?:\D|$)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major === 0 && minor <= 91;
}

function hasUsableViewBox(value: string | undefined): boolean {
  if (!value) return false;
  const parts = value.split(/[\s,]+/u).map(Number);
  return (
    parts.length === 4 && parts.every(Number.isFinite) && (parts[2] ?? 0) > 0 && (parts[3] ?? 0) > 0
  );
}
