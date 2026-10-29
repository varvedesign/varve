import type { LutInputSpace, LutInterpolation } from '../lut/types';
import type { Color } from '../types';
import type { AdjustmentBase } from './types';

export interface GradientMapStop {
  /** Stable identity for editor/persistence operations. */
  id?: string;
  position: number;
  color: Color;
  /** Per-stop opacity (0-1, default 1). */
  opacity?: number;
  /** Midpoint position (0-1, default 0.5) between this stop and the next. */
  midpoint?: number;
}

/** Opacity ramp stop (independent of color stops). */
export interface GradientMapOpacityStop {
  /** Stable identity for editor/persistence operations. */
  id?: string;
  position: number;
  /** Midpoint position (0-1, default 0.5). */
  midpoint?: number;
  /** Normalized opacity 0-1. */
  opacity: number;
}

/** Luminance/tonal source for the gradient-map ramp input. */
export type GradientMapLuminanceMode =
  | 'relative-luminance'
  | 'perceptual-lightness'
  | 'average-rgb'
  | 'max-channel'
  | 'alpha'
  | 'red'
  | 'green'
  | 'blue'
  | 'compatibility';

/**
 * Structural snapshot of a gradient preset embedded on the adjustment so the
 * document stays portable when the global preset is renamed or deleted.
 * Uses `Color` tuples (engine-side mirror of the scene `GradientPreset`).
 */
export interface EmbeddedGradientColorStop {
  /** Stable identity retained when an adjustment embeds a preset. */
  id?: string;
  position: number;
  midpoint?: number;
  color: Color;
}

export interface EmbeddedGradientOpacityStop {
  /** Stable identity retained when an adjustment embeds a preset. */
  id?: string;
  position: number;
  midpoint?: number;
  opacity: number;
}

/** Portable non-ramp settings captured with an embedded gradient preset. */
export interface EmbeddedGradientMapSettings {
  mode?: 'luminance' | 'channel';
  channelStops?: {
    r?: EmbeddedGradientColorStop[];
    g?: EmbeddedGradientColorStop[];
    b?: EmbeddedGradientColorStop[];
  };
  reverse?: boolean;
  intensity?: number;
  luminanceMode?: GradientMapLuminanceMode;
  preserveSourceAlpha?: boolean;
  preserveLuminosity?: boolean;
  dither?: boolean;
  ditherSize?: 4 | 8;
  lutSize?: number;
  algorithmVersion?: 1 | 2;
}

export interface EmbeddedGradientPreset {
  id: string;
  name: string;
  kind?: 'solid' | 'noise' | 'unsupported';
  colorStops: EmbeddedGradientColorStop[];
  opacityStops: EmbeddedGradientOpacityStop[];
  smoothness?: number;
  interpolation?: import('@varve/shared').GradientInterpolationSpace;
  settings?: EmbeddedGradientMapSettings;
  category?: string;
  tags?: string[];
  description?: string;
  limitations?: string[];
  source?: { origin: string; fileName?: string; originalName?: string };
  compatibility?: {
    status: 'ok' | 'approximated' | 'unsupported';
    message?: string;
    warnings?: string[];
  };
}

export interface GradientMapAdjustment extends AdjustmentBase {
  kind: 'gradientMap';
  stops: GradientMapStop[];
  dither: boolean;
  preserveLuminosity: boolean;
  /** Bayer matrix size: 4 or 8. 8×8 gives 64 dither levels, 4×4 gives 16. Default 8. */
  ditherSize?: 4 | 8;
  /** Mapping mode: 'luminance' (default) maps luma through one gradient;
   *  'channel' maps R, G, B independently through channelStops. */
  mode?: 'luminance' | 'channel';
  /** Per-channel gradient stops for channel-aware mode. */
  channelStops?: {
    r?: GradientMapStop[];
    g?: GradientMapStop[];
    b?: GradientMapStop[];
  };
  /** Independent opacity ramp (defaults to full opacity). */
  opacityStops?: GradientMapOpacityStop[];
  /** Reverse the ramp (shadows sample the last stop). Default false. */
  reverse?: boolean;
  /** Mix with the source: 0 = unchanged, 1 = fully mapped. Default 1. */
  intensity?: number;
  /** Tonal source. Default 'relative-luminance'. */
  luminanceMode?: GradientMapLuminanceMode;
  /** Keep source alpha untouched. Default true. */
  preserveSourceAlpha?: boolean;
  /** Interpolation space for stop blending. Legacy default: 'srgb'. */
  interpolation?: import('@varve/shared').GradientInterpolationSpace;
  /** LUT resolution. Default 256. */
  lutSize?: number;
  /** Version of the documented gradient-map algorithm. */
  algorithmVersion?: 1 | 2;
  /** Reference to a global preset (for diagnostics). Rendering uses
   *  `embeddedGradient`/`stops`, so a missing global preset never breaks it. */
  presetId?: string;
  /** Embedded fallback gradient for portability. */
  embeddedGradient?: EmbeddedGradientPreset;
}

export interface TritoneAdjustment extends AdjustmentBase {
  kind: 'tritone';
  shadowColor: Color;
  midtoneColor: Color;
  highlightColor: Color;
  shadowPoint: number;
  highlightPoint: number;
  intensity: number;
  preserveLuminosity: boolean;
  /** Interpolation shape: 'smoothstep' (default) for natural transitions,
   *  'linear' for sharp photographic splits. */
  interpolation?: 'smoothstep' | 'linear';
}

export interface ColorHalftoneAdjustment extends AdjustmentBase {
  kind: 'colorHalftone';
  screenSize: number;
  angle: number;
  dotShape: 'round' | 'square' | 'diamond' | 'line';
  mode: 'cmyk' | 'rgb' | 'mono';
  /** Screening semantics. 1 = legacy, 2 = corrected tone/geometry. */
  algorithmVersion?: 1 | 2;
  intensity: number;
  inkColor?: Color;
}

export interface DuotoneAdjustment extends AdjustmentBase {
  kind: 'duotone';
  shadowColor: Color;
  highlightColor: Color;
  shadowPoint: number;
  highlightPoint: number;
  intensity: number;
  preserveLuminosity: boolean;
  interpolation?: 'smoothstep' | 'linear';
}

export interface BlackAndWhiteAdjustment extends AdjustmentBase {
  kind: 'blackAndWhite';
  reds: number;
  yellows: number;
  greens: number;
  cyans: number;
  blues: number;
  magentas: number;
  brightness: number;
  tintColor?: Color;
  preserveLuminosity: boolean;
}

export interface PosterizeAdjustment extends AdjustmentBase {
  kind: 'posterize';
  levels: number;
}

export interface ThresholdAdjustment extends AdjustmentBase {
  kind: 'threshold';
  level: number;
  luminanceMode?: import('../threshold').ThresholdLuminanceMode;
  algorithmVersion?: 1;
}

export interface LutAdjustment extends AdjustmentBase {
  kind: 'lut';
  /** Serialized LUT transform (embedded in document) */
  lutJson: string;
  /** Original filename for display */
  originalFilename?: string;
  /** Assumed input colour space */
  inputSpace: LutInputSpace;
  /** Interpolation method */
  interpolation: LutInterpolation;
  /** Mix amount (0..1) */
  intensity: number;
  /** Whether to linearize sRGB before applying */
  linearize: boolean;
}
