import { IMAGE_TREATMENT_KINDS } from '../imageTreatments';

/**
 * Canonical catalog for the shared nondestructive-effect parameter model.
 *
 * Object Filters and Adjustment Layers have different attachment semantics,
 * but never different filter-kind catalogs. Keeping the runtime validation
 * source and the type source together prevents a kind becoming serializable
 * while unreachable in one of the two interfaces.
 */
export const ADJUSTMENT_KINDS = [
  'brightness',
  'contrast',
  'exposure',
  'saturation',
  'hueSaturation',
  'hueRotate',
  'sepia',
  'grayscale',
  'invert',
  'opacity',
  'blur',
  'motionBlur',
  'mosaic',
  'surfaceSmooth',
  'edgeInk',
  'sharpen',
  'whiteBalance',
  'splitTone',
  'temperature',
  'tint',
  'vibrance',
  'levels',
  'curves',
  'selectiveColor',
  'colorBalance',
  'channelMixer',
  'photoFilter',
  'shadowHighlight',
  'halftone',
  'gradientMap',
  'tritone',
  'colorHalftone',
  'duotone',
  'blackAndWhite',
  'posterize',
  'threshold',
  'lut',
  'dither',
  'paletteSnap',
  'bloom',
  'rgbSplit',
  'crt',
  'vhs',
  'lightShafts',
  'lensFlare',
  'lightLeak',
  'caustics',
  ...IMAGE_TREATMENT_KINDS,
] as const;

export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export type AdjustmentBlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'softLight'
  | 'hardLight'
  | 'colorDodge'
  | 'colorBurn'
  | 'darken'
  | 'lighten'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'passThrough';

/**
 * Provenance for a member of a curated Effect Studio treatment.
 *
 * The renderer deliberately ignores this UI-level metadata: the executable
 * contract remains the ordinary ordered Adjustment stack. Keeping provenance
 * on each member lets the Studio present one named treatment after it has
 * been applied, while Object Filters can still expose the underlying entries
 * for advanced work. `customized` becomes true when an advanced edit no
 * longer matches the intent-level treatment controls.
 */
export interface StudioTreatmentInstanceMetadata {
  treatmentId: string;
  instanceId: string;
  effectIndex: number;
  controls: Record<string, number>;
  customized?: boolean;
}

export interface AdjustmentBase {
  id: string;
  kind: AdjustmentKind;
  visible: boolean;
  opacity: number;
  blendMode: AdjustmentBlendMode;
  /** Optional Effect Studio recipe membership; has no rendering semantics. */
  studioTreatment?: StudioTreatmentInstanceMetadata;
}

/** Runtime guard for forward-compatible document payloads. */
export function isKnownAdjustmentKind(kind: unknown): kind is AdjustmentKind {
  return typeof kind === 'string' && (ADJUSTMENT_KINDS as readonly string[]).includes(kind);
}
