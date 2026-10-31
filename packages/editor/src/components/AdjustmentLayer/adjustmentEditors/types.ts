import type { CoordSpace } from '@varve/engine/liveEffects';
import type { Adjustment, AdjustmentNode, Document } from '@varve/scene';

export interface AdjustmentEditorProps {
  adjustment: Adjustment;
  onChange: (patch: Partial<Adjustment>) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  /** Document for palette import sources (document swatches). */
  doc?: Document;
  /**
   * Source histogram for the adjustment's scope targets.
   * Computed asynchronously by useAdjustmentHistogram.
   * Used by Levels (HistogramWidget) and Curves (background display).
   */
  sourceHistogram?: import('@varve/engine').Histogram | null;
  /** Human-readable stage represented by the histogram diagnostic. */
  histogramSourceLabel?: string;
  histogramLoading?: boolean;
  sourceImageData?: ImageData | null;
  sourceCoordSpace?: CoordSpace | null;
  detailScope?: AdjustmentNode;
}
