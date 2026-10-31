import { isImageTreatmentKind } from '@varve/engine';
import { LegacyAdjustmentEditor } from './adjustmentEditors/LegacyAdjustmentEditor';
import type { AdjustmentEditorProps } from './adjustmentEditors/types';
import { ImageTreatmentEditor } from './ImageTreatmentEditor';
import './adjustment.css';

export { curvePointsToCurvesPoints, curvesPointsToCurvePoints } from './adjustmentEditors/curves';
export type { AdjustmentEditorProps } from './adjustmentEditors/types';

export function AdjustmentEditor(props: AdjustmentEditorProps) {
  if (isImageTreatmentKind(props.adjustment.kind)) {
    return <ImageTreatmentEditor adjustment={props.adjustment} onChange={props.onChange} />;
  }
  return <LegacyAdjustmentEditor {...props} />;
}
