import type { FontReference } from '@varve/engine';
import type { VariableModifier } from '../modifiers';
import type { Effect } from './appearance';
import type { Fill } from './fills';
import type { NodeId } from './ids';
import type { LayoutStyle } from './nodes/containers';

// ── Property Binding (task 1.2+) ────────────────────────────────────────────

export interface PropertyBinding {
  variableId: string;
  expression?: string;
  /**
   * V2.15+: typed, non-destructive modifier stack applied after the variable
   * resolves (alpha first). Never encoded into `expression` — modifiers are
   * validated, serialized, and migrated as typed records.
   */
  modifiers?: VariableModifier[];
}

export type SlotKind = 'single' | 'multiple' | 'text';

export interface Slot {
  id: string;
  name: string;
  kind: SlotKind;
  /** Optional default content (NodeId of a node used as the default fill). */
  defaultContentId?: NodeId;
}

// ── Component Properties & Variants (Phase 3) ──────────────────────────────

export type ComponentPropertyType = 'text' | 'boolean' | 'instanceSwap' | 'variant';

export interface ComponentProperty {
  id: string;
  name: string;
  type: ComponentPropertyType;
  defaultValue: string | boolean | NodeId;
}

export interface Variant {
  id: string;
  name: string;
  /** Overrides for component properties. Only properties with values different
   *  from defaults need to be specified. */
  propertyValues: Record<string, string | boolean | NodeId>;
}

export interface PropertySet {
  id: string;
  name: string;
  propertyNames: string[];
}

export interface ComponentDefinition {
  id: NodeId;
  name: string;
  /** Typed slots this component accepts. */
  slots: Slot[];
  /** Root of the master tree (the synchronized template). */
  masterRootId: NodeId;
  /** Component properties for this component. */
  properties?: ComponentProperty[];
  /** Named variants that set multiple properties at once. */
  variants?: Variant[];
  /** Groups of properties that define variant axes. */
  propertySets?: PropertySet[];
}

// ── Reusable Style Types ─────────────────────────────────────────────────────

export type StyleType = 'color' | 'text' | 'effect' | 'layout';

export interface ColorStyle {
  id: NodeId;
  type: 'color';
  name: string;
  fill: Fill;
  description?: string;
}

export interface TextStyle {
  id: NodeId;
  type: 'text';
  name: string;
  fontFamily?: string;
  /** Exact artifact/member identity; absent on legacy family-only documents. */
  fontReference?: FontReference;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  fontSize: number;
  lineHeight?: number;
  letterSpacing?: number;
  paragraphSpacing?: number;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textAlignVertical?: 'top' | 'middle' | 'bottom';
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textDecoration?: 'none' | 'underline' | 'line-through';
  listStyle?: 'none' | 'disc' | 'decimal' | 'circle' | 'square';
  description?: string;
}

export interface EffectStyle {
  id: NodeId;
  type: 'effect';
  name: string;
  effects: Effect[];
  description?: string;
}

export interface LayoutStyleDef {
  id: NodeId;
  type: 'layout';
  name: string;
  layout: LayoutStyle;
  description?: string;
}

export type Style = ColorStyle | TextStyle | EffectStyle | LayoutStyleDef;
