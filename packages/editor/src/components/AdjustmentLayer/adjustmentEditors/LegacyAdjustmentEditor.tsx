import type { Adjustment } from '@varve/scene';
import { renderChannelCases } from './legacy/renderChannelCases';
import { renderEffectCases } from './legacy/renderEffectCases';
import { renderLuminanceCases } from './legacy/renderLuminanceCases';
import { renderTonalCases } from './legacy/renderTonalCases';
import { useLegacyEditorContext } from './legacy/useLegacyEditorContext';
import type { AdjustmentEditorProps } from './types';

export function LegacyAdjustmentEditor(props: AdjustmentEditorProps) {
  const context = useLegacyEditorContext(props);

  const luminance = renderLuminanceCases(context);
  if (luminance !== undefined) return luminance;

  const tonal = renderTonalCases(context);
  if (tonal !== undefined) return tonal;

  const channel = renderChannelCases(context);
  if (channel !== undefined) return channel;

  const effects = renderEffectCases(context);
  if (effects !== undefined) return effects;

  const { adjustment } = props;
  return (
    <div className="adj-editor__slider-row">
      <span className="adj-editor__label" style={{ color: 'var(--color-text-muted)' }}>
        No editor for {(adjustment as Adjustment).kind}
      </span>
    </div>
  );
}
