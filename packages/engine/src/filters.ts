/**
 * Filter IR and Canvas2D/CSS fallback for nondestructive image adjustments.
 *
 * This module defines both the user-facing adjustment types and the portable
 * filter IR. It lives in @varve/engine so the IR contract and the Canvas2D
 * fallback stay together; @varve/scene re-exports/adapts these as needed.
 *
 * Research basis: CSS filter functions, SVG filters, Photoshop adjustment layers.
 */

export type { Adjustment } from './filters/adjustment';
export type {
  BlackAndWhiteAdjustment,
  ColorHalftoneAdjustment,
  DuotoneAdjustment,
  EmbeddedGradientColorStop,
  EmbeddedGradientMapSettings,
  EmbeddedGradientOpacityStop,
  EmbeddedGradientPreset,
  GradientMapAdjustment,
  GradientMapLuminanceMode,
  GradientMapOpacityStop,
  GradientMapStop,
  LutAdjustment,
  PosterizeAdjustment,
  ThresholdAdjustment,
  TritoneAdjustment,
} from './filters/adjustmentTypesCreative';
export type {
  AtmosphereAdjustment,
  BloomAdjustment,
  CausticsAdjustment,
  CrtAdjustment,
  DefinitionAdjustment,
  DehazeAdjustment,
  DitherAdjustment,
  EdgeFalloffAdjustment,
  EdgeInkAdjustment,
  GrainAdjustment,
  LensFlareAdjustment,
  LightLeakAdjustment,
  LightShaftsAdjustment,
  MicroDetailAdjustment,
  MosaicAdjustment,
  MotionBlurAdjustment,
  PaletteSnapAdjustment,
  RgbSplitAdjustment,
  ShadowHighlightAdjustment,
  SoftBloomAdjustment,
  SurfaceSmoothAdjustment,
  VhsAdjustment,
} from './filters/adjustmentTypesEffects';
export type {
  BlurAdjustment,
  BrightnessAdjustment,
  ChannelMixerAdjustment,
  ChannelMixerRow,
  ColorBalanceAdjustment,
  ColorBalanceTriplet,
  ContrastAdjustment,
  CurvesAdjustment,
  CurvesPoint,
  ExposureAdjustment,
  GrayscaleAdjustment,
  HalftoneAdjustment,
  HueRotateAdjustment,
  HueSaturationAdjustment,
  InvertAdjustment,
  LevelsAdjustment,
  OpacityAdjustment,
  PhotoFilterAdjustment,
  SaturationAdjustment,
  SelectiveColorAdjustment,
  SepiaAdjustment,
  SharpenAdjustment,
  SplitToneAdjustment,
  TemperatureAdjustment,
  TintAdjustment,
  VibranceAdjustment,
  WhiteBalanceAdjustment,
} from './filters/adjustmentTypesTone';
export { adjustmentsToFilters, adjustmentToFilter } from './filters/conversion';
export {
  applyFilterChain,
  filterChainToCss,
  filterToCss,
  supportsCanvasFilter,
} from './filters/cssFallback';
export { adjustmentDefaults, makeAdjustment } from './filters/defaults';
export { filterKindDisplayName } from './filters/displayNames';
export type {
  AdjustmentBase,
  AdjustmentBlendMode,
  AdjustmentKind,
  StudioTreatmentInstanceMetadata,
} from './filters/types';
export { ADJUSTMENT_KINDS, isKnownAdjustmentKind } from './filters/types';
