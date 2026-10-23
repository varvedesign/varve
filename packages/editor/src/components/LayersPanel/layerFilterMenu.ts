/**
 * The Layers filter, presented as one menu plus a row of removable tokens.
 *
 * The filter options used to open as four boxed chip groups (8 types, 6
 * attributes, 12 blend modes, 8 colour tags) that took 504px of the rail and
 * hid the tree they filter (shell audit 2026-10-22, F-48). Every dimension is
 * the same LayerFilterSpec; this module changes only how it is presented:
 * a Filter menu (checkable items, which keep the menu open while toggling)
 * and one token per active constraint, each removable on its own.
 */
import type { BlendMode, LayerColorName } from '@varve/scene';
import { LAYER_COLOR_LABELS, LAYER_COLORS } from '@varve/scene';
import type { MenuEntry } from '@varve/ui';
import type { AttributeFilter, LayerFilterSpec } from './layerFilterTypes';

type Kind = LayerFilterSpec['kinds'][number];
type FlagKey = Exclude<keyof AttributeFilter, 'layerColor'>;

export const KIND_OPTIONS: readonly { value: Kind; label: string }[] = [
  { value: 'shape', label: 'Shape' },
  { value: 'text', label: 'Text' },
  { value: 'frame', label: 'Frame' },
  { value: 'group', label: 'Group' },
  { value: 'path', label: 'Path' },
  { value: 'rasterLayer', label: 'Raster' },
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'table', label: 'Table' },
];

/** Each attribute filters for its presence or its absence, never both. */
const FLAG_LABELS: Readonly<Record<FlagKey, readonly [onLabel: string, offLabel: string]>> = {
  locked: ['Locked', 'Unlocked'],
  visible: ['Visible', 'Hidden'],
  hasChildren: ['Has children', 'No children'],
  hasEffects: ['Has effects', 'No effects'],
  isMasked: ['Masked', 'Not masked'],
  isComponent: ['Component', 'Not a component'],
  isInstance: ['Instance', 'Not an instance'],
  mobileHidden: ['Hidden on mobile', 'Shown on mobile'],
  mobileOnly: ['Mobile only', 'Not mobile only'],
  threadedText: ['Threaded text', 'Not threaded'],
  exportRegion: ['Export region', 'Not an export region'],
  animated: ['Animated', 'Not animated'],
};

/** The attributes offered in the menu; the rest arrive through workspace presets. */
const MENU_FLAGS: readonly FlagKey[] = [
  'locked',
  'visible',
  'hasChildren',
  'hasEffects',
  'isMasked',
  'isComponent',
];

export const BLEND_OPTIONS: readonly { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'colorDodge', label: 'Color Dodge' },
  { value: 'colorBurn', label: 'Color Burn' },
  { value: 'hardLight', label: 'Hard Light' },
  { value: 'softLight', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
];

function withFlag(filter: LayerFilterSpec, key: FlagKey, value: boolean | undefined) {
  const attributes: AttributeFilter = { ...filter.attributes };
  if (value === undefined) delete attributes[key];
  else attributes[key] = value;
  return { ...filter, attributes };
}

function withoutColorTag(filter: LayerFilterSpec): LayerFilterSpec {
  const { layerColor: _removed, ...attributes } = filter.attributes;
  return { ...filter, attributes };
}

function countBadge(count: number): string | undefined {
  return count > 0 ? String(count) : undefined;
}

export function buildLayerFilterMenu(
  filter: LayerFilterSpec,
  onChange: (next: LayerFilterSpec) => void,
): MenuEntry[] {
  const toggleKind = (kind: Kind) =>
    onChange({
      ...filter,
      kinds: filter.kinds.includes(kind)
        ? filter.kinds.filter((k) => k !== kind)
        : [...filter.kinds, kind],
    });
  const toggleBlend = (blend: BlendMode) =>
    onChange({
      ...filter,
      blendModes: filter.blendModes.includes(blend)
        ? filter.blendModes.filter((b) => b !== blend)
        : [...filter.blendModes, blend],
    });
  const activeFlags = MENU_FLAGS.filter((key) => filter.attributes[key] !== undefined).length;
  const tag = filter.attributes.layerColor;

  return [
    {
      id: 'filter-type',
      label: 'Type',
      type: 'submenu',
      badge: countBadge(filter.kinds.length),
      submenu: KIND_OPTIONS.map((option) => ({
        id: `filter-type-${option.value}`,
        label: option.label,
        type: 'checkbox' as const,
        checked: filter.kinds.includes(option.value),
        onToggle: () => toggleKind(option.value),
      })),
    },
    {
      id: 'filter-attribute',
      label: 'Attribute',
      type: 'submenu',
      badge: countBadge(activeFlags),
      submenu: MENU_FLAGS.flatMap((key, index): MenuEntry[] => {
        const [onLabel, offLabel] = FLAG_LABELS[key];
        const value = filter.attributes[key];
        const pair: MenuEntry[] = [
          {
            id: `filter-attr-${key}-on`,
            label: onLabel,
            type: 'checkbox',
            checked: value === true,
            onToggle: () => onChange(withFlag(filter, key, value === true ? undefined : true)),
          },
          {
            id: `filter-attr-${key}-off`,
            label: offLabel,
            type: 'checkbox',
            checked: value === false,
            onToggle: () => onChange(withFlag(filter, key, value === false ? undefined : false)),
          },
        ];
        return index === 0 ? pair : [{ id: `filter-attr-sep-${key}`, separator: true }, ...pair];
      }),
    },
    {
      id: 'filter-blend',
      label: 'Blend mode',
      type: 'submenu',
      badge: countBadge(filter.blendModes.length),
      submenu: BLEND_OPTIONS.map((option) => ({
        id: `filter-blend-${option.value}`,
        label: option.label,
        type: 'checkbox' as const,
        checked: filter.blendModes.includes(option.value),
        onToggle: () => toggleBlend(option.value),
      })),
    },
    {
      id: 'filter-tag',
      label: 'Color tag',
      type: 'submenu',
      badge: tag !== undefined ? '1' : undefined,
      submenu: [
        {
          id: 'filter-tag-any',
          label: 'Any',
          type: 'radio',
          group: 'filter-tag',
          checked: tag === undefined,
          onToggle: () => onChange(withoutColorTag(filter)),
        },
        ...LAYER_COLORS.map(
          (color: LayerColorName): MenuEntry => ({
            id: `filter-tag-${color}`,
            label: LAYER_COLOR_LABELS[color],
            type: 'radio',
            group: 'filter-tag',
            checked: tag === color,
            onToggle: () =>
              onChange({ ...filter, attributes: { ...filter.attributes, layerColor: color } }),
          }),
        ),
        {
          id: 'filter-tag-none',
          label: 'No color tag',
          type: 'radio',
          group: 'filter-tag',
          checked: tag === null,
          onToggle: () =>
            onChange({ ...filter, attributes: { ...filter.attributes, layerColor: null } }),
        },
      ],
    },
  ];
}

export interface FilterToken {
  id: string;
  label: string;
  /** The filter with only this constraint removed. */
  remove: (filter: LayerFilterSpec) => LayerFilterSpec;
}

/** One token per active non-text constraint, in menu order. */
export function activeFilterTokens(filter: LayerFilterSpec): FilterToken[] {
  const tokens: FilterToken[] = [];
  for (const kind of filter.kinds) {
    const label = KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
    tokens.push({
      id: `kind-${kind}`,
      label,
      remove: (current) => ({ ...current, kinds: current.kinds.filter((k) => k !== kind) }),
    });
  }
  for (const key of Object.keys(FLAG_LABELS) as FlagKey[]) {
    const value = filter.attributes[key];
    if (value === undefined) continue;
    tokens.push({
      id: `attr-${key}`,
      label: FLAG_LABELS[key][value ? 0 : 1],
      remove: (current) => withFlag(current, key, undefined),
    });
  }
  for (const blend of filter.blendModes) {
    const label = BLEND_OPTIONS.find((option) => option.value === blend)?.label ?? blend;
    tokens.push({
      id: `blend-${blend}`,
      label,
      remove: (current) => ({
        ...current,
        blendModes: current.blendModes.filter((b) => b !== blend),
      }),
    });
  }
  const tag = filter.attributes.layerColor;
  if (tag !== undefined) {
    tokens.push({
      id: 'tag',
      label: tag === null ? 'No color tag' : `${LAYER_COLOR_LABELS[tag]} tag`,
      remove: withoutColorTag,
    });
  }
  return tokens;
}
