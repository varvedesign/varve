import type { Color } from '../types';
import type { AdjustmentBase } from './types';

export interface BrightnessAdjustment extends AdjustmentBase {
  kind: 'brightness';
  value: number;
}
export interface ContrastAdjustment extends AdjustmentBase {
  kind: 'contrast';
  value: number;
}
export interface ExposureAdjustment extends AdjustmentBase {
  kind: 'exposure';
  value: number;
  offset: number;
  gammaCorrection: number;
}
export interface SaturationAdjustment extends AdjustmentBase {
  kind: 'saturation';
  value: number;
}
export interface HueSaturationAdjustment extends AdjustmentBase {
  kind: 'hueSaturation';
  ranges: import('../adjustment/hueSaturation').HueSaturationParams;
}
export interface HueRotateAdjustment extends AdjustmentBase {
  kind: 'hueRotate';
  value: number;
}
export interface SepiaAdjustment extends AdjustmentBase {
  kind: 'sepia';
  value: number;
}
export interface GrayscaleAdjustment extends AdjustmentBase {
  kind: 'grayscale';
  value: number;
}
export interface InvertAdjustment extends AdjustmentBase {
  kind: 'invert';
  value: number;
}
export interface OpacityAdjustment extends AdjustmentBase {
  kind: 'opacity';
  value: number;
}
export interface BlurAdjustment extends AdjustmentBase {
  kind: 'blur';
  radius: number;
}
export interface SharpenAdjustment extends AdjustmentBase {
  kind: 'sharpen';
  amount: number;
  /** Target-local units for objects; document units for adjustment layers. */
  radius: number;
  threshold: number;
  algorithmVersion?: 1 | 2;
  workingSpace?: 'srgb' | 'linear-srgb';
  luminanceOnly?: boolean;
  protectAlpha?: boolean;
}
export interface WhiteBalanceAdjustment extends AdjustmentBase {
  kind: 'whiteBalance';
  algorithmVersion: 1;
  temperature: number;
  tint: number;
  redGain: number;
  greenGain: number;
  blueGain: number;
}
export interface SplitToneAdjustment extends AdjustmentBase {
  kind: 'splitTone';
  algorithmVersion: 1;
  shadowHue: number;
  shadowSaturation: number;
  highlightHue: number;
  highlightSaturation: number;
  balance: number;
  blending: number;
  strength: number;
}
export interface TemperatureAdjustment extends AdjustmentBase {
  kind: 'temperature';
  value: number;
}
export interface TintAdjustment extends AdjustmentBase {
  kind: 'tint';
  value: number;
}
export interface VibranceAdjustment extends AdjustmentBase {
  kind: 'vibrance';
  value: number;
}
export interface LevelsAdjustment extends AdjustmentBase {
  kind: 'levels';
  inputShadows: number;
  inputMidtones: number;
  inputHighlights: number;
  outputShadows: number;
  outputHighlights: number;
  channel: 'rgb' | 'red' | 'green' | 'blue';
}
export interface CurvesPoint {
  id?: string;
  input: number;
  output: number;
}
export interface CurvesAdjustment extends AdjustmentBase {
  kind: 'curves';
  channel: 'rgb' | 'red' | 'green' | 'blue';
  points: CurvesPoint[];
  algorithmVersion?: 1 | 2;
  channelPoints?: Partial<Record<'rgb' | 'red' | 'green' | 'blue', CurvesPoint[]>>;
}
export interface SelectiveColorAdjustment extends AdjustmentBase {
  kind: 'selectiveColor';
  colorRange:
    | 'reds'
    | 'yellows'
    | 'greens'
    | 'cyans'
    | 'blues'
    | 'magentas'
    | 'whites'
    | 'neutrals'
    | 'blacks';
  cyan: number;
  magenta: number;
  yellow: number;
  black: number;
  relative: boolean;
}
export interface ColorBalanceTriplet {
  cyanRed: number;
  magentaGreen: number;
  yellowBlue: number;
}
export interface ColorBalanceAdjustment extends AdjustmentBase {
  kind: 'colorBalance';
  shadows: ColorBalanceTriplet;
  midtones: ColorBalanceTriplet;
  highlights: ColorBalanceTriplet;
  preserveLuminosity: boolean;
  /** Version of the documented scalar Color Balance algorithm. */
  algorithmVersion?: 1;
}
export interface ChannelMixerRow {
  redPercent: number;
  greenPercent: number;
  bluePercent: number;
  constant: number;
}
export interface ChannelMixerAdjustment extends AdjustmentBase {
  kind: 'channelMixer';
  outputChannel: 'red' | 'green' | 'blue';
  redPercent: number;
  greenPercent: number;
  bluePercent: number;
  constant: number;
  monochrome: boolean;
  rows?: Record<'red' | 'green' | 'blue', ChannelMixerRow>;
}
export interface PhotoFilterAdjustment extends AdjustmentBase {
  kind: 'photoFilter';
  color: Color;
  density: number;
  preserveLuminosity: boolean;
}
export interface HalftoneAdjustment extends AdjustmentBase {
  kind: 'halftone';
  pattern: 'dot' | 'line' | 'cross' | 'circle';
  frequency: number;
  angle: number;
  dotShape: 'round' | 'elliptical' | 'square' | 'diamond' | 'line' | 'cross' | 'circle';
  channel: 'k' | 'c' | 'm' | 'y' | 'cmyk';
  method: 'am' | 'fm';
  /** Screening semantics. 1 = legacy geometry, 2 = corrected (default). */
  algorithmVersion?: 1 | 2;
  /** FM algorithm. Default 'blue-noise' for version 2 effects. */
  fmAlgorithm?: 'blue-noise' | 'bayer' | 'error-diffusion';
  /** Mono alpha handling: 'preserve' (default) or intentional
   *  ink-on-transparency 'screen'. Version 2 only. */
  alphaMode?: 'preserve' | 'screen';
  threshold?: number;
  intensity?: number;
  softness?: number;
  /** Invert the halftone output (swap ink and paper). Default false. */
  invert?: boolean;
  /** Foreground (ink) color as [r, g, b] (default [0, 0, 0] = black). */
  foregroundColor?: [number, number, number];
  /** Background (paper) color as [r, g, b] (default [255, 255, 255] = white). */
  backgroundColor?: [number, number, number];
  /** Per-channel screen angle overrides (degrees). */
  channelAngles?: { c?: number; m?: number; y?: number; k?: number };
  /** Sub-pixel registration offset per channel. */
  registrationOffset?: {
    c?: [number, number];
    m?: [number, number];
    y?: [number, number];
    k?: [number, number];
  };
  /** Total area coverage limit (0-1). Default 1 (400%). */
  tacLimit?: number;
  /** Black generation method. Default 'none'. */
  blackGeneration?: 'none' | 'gcr' | 'ucr';
  /** GCR strength 0-1. Default 0.5. */
  gcrStrength?: number;
  /** Preview channel for CMYK mode. Default 'composite'. */
  previewChannel?: 'composite' | 'c' | 'm' | 'y' | 'k';
  /** Dot gain compensation 0-1. Default 0. */
  dotGain?: number;
}
