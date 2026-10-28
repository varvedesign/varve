import type { ManagedColor } from '../colorManagement';
import type { NodeId } from './ids';

// ── Document base type ──────────────────────────────────────────────────────
/**
 * Minimal document shape shared across scene modules without importing the
 * full `Document` type from `./document` (which would create import cycles).
 * `Document` extends this interface.
 */

// ---------------------------------------------------------------------------
// Logo project (v2.12+)
// ---------------------------------------------------------------------------

export type LogoConceptStatus = 'active' | 'pinned' | 'rejected' | 'archived';

export type LogoVariantKind =
  | 'primary'
  | 'horizontal'
  | 'vertical'
  | 'stacked'
  | 'compact'
  | 'icon'
  | 'wordmark'
  | 'monochrome'
  | 'reversed'
  | 'small'
  | 'favicon'
  | 'app-icon'
  | 'avatar'
  | 'watermark'
  | 'custom';

export type LogoProvenance =
  | 'user-created'
  | 'imported'
  | 'template-derived'
  | 'generated-locally'
  | 'generated-remotely'
  | 'vectorized'
  | 'reconstructed'
  | 'derived';

export interface LogoBrief {
  brandName?: string;
  tagline?: string;
  industry?: string;
  audience?: string;
  keywords: string[];
  preferredColors: string[];
  prohibitedColors: string[];
  notes?: string;
  updatedAt: number;
}

export interface LogoConcept {
  id: string;
  name: string;
  artboardId: NodeId | null;
  status: LogoConceptStatus;
  rationale?: string;
  provenance: LogoProvenance;
  createdAt: number;
  updatedAt: number;
  sourcePrompt?: string;
}

export interface LogoVariant {
  id: string;
  name: string;
  kind: LogoVariantKind;
  artboardId: NodeId | null;
  sourceConceptId: string | null;
  derivedFromVariantId: string | null;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface LogoPaletteColor {
  id: string;
  name?: string;
  color: ManagedColor;
  role?: string;
}

export interface LogoPalette {
  colors: LogoPaletteColor[];
  updatedAt: number;
}

export interface LogoProject {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  brief: LogoBrief;
  concepts: LogoConcept[];
  variants: LogoVariant[];
  palette?: LogoPalette;
}
