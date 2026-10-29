import type {
  BlackAndWhiteAdjustment,
  ColorHalftoneAdjustment,
  DuotoneAdjustment,
  GradientMapAdjustment,
  LutAdjustment,
  PosterizeAdjustment,
  ThresholdAdjustment,
  TritoneAdjustment,
} from './adjustmentTypesCreative';
import type {
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
} from './adjustmentTypesEffects';
import type {
  BlurAdjustment,
  BrightnessAdjustment,
  ChannelMixerAdjustment,
  ColorBalanceAdjustment,
  ContrastAdjustment,
  CurvesAdjustment,
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
} from './adjustmentTypesTone';

export type Adjustment =
  | BrightnessAdjustment
  | ContrastAdjustment
  | ExposureAdjustment
  | SaturationAdjustment
  | HueSaturationAdjustment
  | HueRotateAdjustment
  | SepiaAdjustment
  | GrayscaleAdjustment
  | InvertAdjustment
  | HalftoneAdjustment
  | OpacityAdjustment
  | BlurAdjustment
  | SharpenAdjustment
  | WhiteBalanceAdjustment
  | SplitToneAdjustment
  | TemperatureAdjustment
  | TintAdjustment
  | VibranceAdjustment
  | LevelsAdjustment
  | CurvesAdjustment
  | SelectiveColorAdjustment
  | ColorBalanceAdjustment
  | ChannelMixerAdjustment
  | PhotoFilterAdjustment
  | GradientMapAdjustment
  | TritoneAdjustment
  | ColorHalftoneAdjustment
  | DuotoneAdjustment
  | BlackAndWhiteAdjustment
  | PosterizeAdjustment
  | ThresholdAdjustment
  | LutAdjustment
  | DitherAdjustment
  | PaletteSnapAdjustment
  | BloomAdjustment
  | RgbSplitAdjustment
  | CrtAdjustment
  | VhsAdjustment
  | LightShaftsAdjustment
  | LensFlareAdjustment
  | LightLeakAdjustment
  | CausticsAdjustment
  | ShadowHighlightAdjustment
  | MicroDetailAdjustment
  | DefinitionAdjustment
  | AtmosphereAdjustment
  | DehazeAdjustment
  | EdgeFalloffAdjustment
  | GrainAdjustment
  | SoftBloomAdjustment
  | MotionBlurAdjustment
  | MosaicAdjustment
  | SurfaceSmoothAdjustment
  | EdgeInkAdjustment;
