/**
 * Scene document types (Strata plan §3.1, §9 — slots-ready model).
 *
 * Node types: ShapeNode (rect/ellipse/circle/line/polygon/star), TextNode,
 * GroupNode (container), FrameNode (layout-capable container, doubles as
 * component instance via componentId).
 *
 * Layering note: the primitive geometry types (Affine, Color, Point, Shape) are
 * imported from @varve/engine for now. A later refactor moves them to
 * @varve/shared so scene does not depend on the renderer package.
 *
 * F6 (Inspector): extended with Stroke, Effect, BlendMode, opacity, rotation,
 * per-corner radius, and stacked-fill type enums. All new fields have safe
 * defaults so existing documents deserialize correctly.
 */

import type { GradientInterpolationSpace, ManagedColor } from './colorManagement';

export type { AnimatedAssetMetadata, MediaFillSettings, TextWrapShape } from '@varve/shared';

export type {
  BaselineGrid,
  DocumentGrid,
  DocumentGridSettings,
  GridDefinition,
  GridScope,
  IsometricAxis,
  IsometricGrid,
  IsometricPreset,
  IsometricPresetDef,
  LayoutGrid,
  PixelGrid,
} from './gridTypes';

export {
  createDefaultIsometricGrid,
  createStandardIsometricAxes,
  normaliseAngle,
  validateIsometricAxes,
  validateIsometricGrid,
} from './gridTypes';

export type { LayerColor, LayerColorName } from './layerColor';
export type {
  ArrowheadStyle,
  BlendMode,
  ChannelColors,
  ChannelOffset,
  ChromaticChannelSource,
  ChromaticContribution,
  Effect,
  EffectGradient,
  GradientFill,
  GradientStop,
  GradientTilingMode,
  GradientType,
  HueInterpolation,
  Stroke,
  StrokeAlign,
  StrokeCap,
  StrokeJoin,
} from './types/appearance';
export { defaultStroke } from './types/appearance';
export type {
  AssetStorageKind,
  DepthMapAsset,
  DocumentAsset,
  GenerativeEditOverlay,
  IccProfileEntry,
  ImageFillUpscale,
  ImageSourceMetadata,
  SourceExifOrientation,
} from './types/assets';

export type {
  AppearanceSnapshot,
  DesignCanvas,
  Guide,
  LayerState,
  LayerStateCapture,
  LayerStateCategory,
} from './types/canvas';
export type {
  ComicProductionStatus,
  ComicPublishingTarget,
  ComicReadingDirection,
  ComicWorkflowProfile,
  StoryOutline,
  StoryOutlineEntry,
} from './types/comic';
export type {
  ColorStyle,
  ComponentDefinition,
  ComponentProperty,
  ComponentPropertyType,
  EffectStyle,
  LayoutStyleDef,
  PropertyBinding,
  PropertySet,
  Slot,
  SlotKind,
  Style,
  StyleType,
  TextStyle,
  Variant,
} from './types/components';
export type {
  ArrangeOp,
  DocumentBase,
  FacingPagesConfig,
  MasterAppliesTo,
  MasterOverride,
  MasterOverrideType,
  MasterPage,
  Page,
  PageLayoutSettings,
  PageNumberStyle,
  PageOrder,
  PagePlacement,
  PagePrintSettings,
  PageSection,
  PageSide,
  Spread,
  SpreadKind,
  SpreadModel,
} from './types/document';
export type {
  Fill,
  FillType,
  ImageCropRect,
  ImageFillData,
  ImageFit,
  Paint,
  PatternCellBounds,
  PatternDefinition,
  PatternDefinitionSource,
  PatternFillData,
  PatternGeneratorRecipe,
  PatternRepeatDefinition,
} from './types/fills';
export { makePaint } from './types/fills';
export {
  clampImageCropRect,
  isFullImageCrop,
  normalizeImageCropRect,
  normalizeImageFillData,
  normalizeImageRotation,
  shapeHeight,
  shapeWidth,
} from './types/helpers';
export type { NodeId } from './types/ids';
export type {
  LogoBrief,
  LogoConcept,
  LogoConceptStatus,
  LogoPalette,
  LogoPaletteColor,
  LogoProject,
  LogoProvenance,
  LogoVariant,
  LogoVariantKind,
} from './types/logo';
export type {
  BackgroundRemovalMethod,
  BackgroundRemovalProvenance,
  BackgroundRemovalState,
  DepthMaskRecipe,
  EffectMaskBinding,
  LiveMatteSource,
  Mask,
  MaskFillRule,
  MaskType,
  RasterMaskAsset,
  RasterMaskData,
  RasterMaskSourceIdentity,
  VectorMaskData,
} from './types/masks';
export type {
  AdaptiveContrastPolicy,
  AdaptiveContrastState,
  AdjustmentCurves,
  AdjustmentCurvesPoint,
  AdjustmentLevels,
  AdjustmentNode,
  AdjustmentParams,
  AdjustmentScope,
  AdjustmentSelectiveColor,
  AdjustmentType,
  RasterLayerNode,
  RasterTile,
  SelectiveColorTarget,
} from './types/nodes/adjustment';
export type { NodeBase } from './types/nodes/base';
export type {
  ConstraintAxis,
  Constraints,
  FlexDirection,
  FrameNode,
  GridItemPlacement,
  GridTrack,
  LayoutAlign,
  LayoutMode,
  LayoutPosition,
  LayoutSizing,
  LayoutStyle,
  PanelMetadata,
  TableNode,
} from './types/nodes/containers';

export type {
  FrequencySeparationState,
  GroupNode,
  LiveBooleanState,
  LiveTraceParams,
  LiveTraceState,
  OutlinedTextMetadata,
  TraceMetadata,
  TracePrepSnapshot,
} from './types/nodes/groups';
export { defaultLiveTraceParams, migrateLiveTraceParams } from './types/nodes/groups';
export type { ConceptArtReferenceMetadata, ShapeNode } from './types/nodes/shapes';
export { normalizeConceptArtReferenceMetadata } from './types/nodes/shapes';
export type {
  CalloutFitPolicy,
  CalloutRecipe,
  CalloutTail,
  CalloutTailStyle,
  TextNode,
} from './types/nodes/text';
export type {
  ContainerNode,
  ExportRegionNode,
  ImageNode,
  PathNode,
  SceneNode,
} from './types/nodes/union';
export { isContainer, isExportRegion, isLiveBooleanNode, isTableNode } from './types/nodes/union';
export type {
  CharacterFormat,
  GlyphAdjustment,
  KerningMode,
  OpenTypeFeatureMap,
  OpenTypeFeatureTag,
  Paragraph,
  ParagraphFormat,
  PathTextSettings,
  RegisteredAxisTag,
  RichText,
  RubyAnnotation,
  TabStop,
  TabStopAlignment,
  TextFrameBinding,
  TextMode,
  TextOrientation,
  TextRun,
  TextStory,
  VariableFontAxis,
  VariableFontInstance,
  VariableFontSettings,
  WritingMode,
} from './types/typography';
export type { GradientInterpolationSpace, ManagedColor };
