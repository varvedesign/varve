import { type CurvePoint, compileCurve, curveChannels } from '@varve/engine';
import type { Adjustment } from '@varve/scene';
import { Button, Select } from '@varve/ui';
import { CurveEditor } from '../../Inspector/controls/CurveEditor';
import { SourceChannels } from '../SourceChannels';
import type { AdjustmentEditorProps } from './types';

// CurvesAdjustment.points ({input, output}, 0-255, document/render space) and
// CurveEditor's CurvePoint ({x, y}, 0-1, plot space) are the same tonal curve
// in two different unit systems — a straight linear scale, not a lossy or
// structural conversion. Order is preserved (not re-sorted) so a drag that
// moves one point doesn't reshuffle the others; CurveEditor already sorts by
// x internally for rendering/hit-testing.
export function curvesPointsToCurvePoints(
  points: import('@varve/scene').CurvesPoint[],
): CurvePoint[] {
  return points.map((p) => ({
    ...(p.id ? { id: p.id } : {}),
    x: p.input / 255,
    y: p.output / 255,
  }));
}
export function curvePointsToCurvesPoints(
  points: CurvePoint[],
): import('@varve/scene').CurvesPoint[] {
  return points.map((p) => ({
    ...(p.id ? { id: p.id } : {}),
    input: Math.max(0, Math.min(1, p.x)) * 255,
    output: Math.max(0, Math.min(1, p.y)) * 255,
  }));
}
export function CurvesEditor({
  adjustment,
  onChange,
  onEditStart,
  onEditEnd,
  sourceHistogram,
  histogramSourceLabel,
  histogramLoading,
  sourceImageData,
}: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').CurvesAdjustment;
  const channels = curveChannels(adj);
  const changeChannel = (channel: 'rgb' | 'red' | 'green' | 'blue') =>
    onChange({
      channel,
      points: channels[channel] ?? [],
      channelPoints: channels,
    } as Partial<Adjustment>);
  const changePoints = (points: CurvePoint[]) => {
    const authored = curvePointsToCurvesPoints(points);
    onChange({
      points: authored,
      channelPoints: { ...channels, [adj.channel]: authored },
    } as Partial<Adjustment>);
  };

  return (
    <div>
      {(histogramSourceLabel || histogramLoading) && (
        <div className="histogram-widget__source" role="note">
          {histogramLoading ? 'Loading histogram…' : `Histogram: ${histogramSourceLabel}`}
        </div>
      )}
      <Select
        label="Curve interpolation"
        value={String(adj.algorithmVersion ?? 1)}
        options={[
          { value: '1', label: 'Legacy Catmull-Rom' },
          { value: '2', label: 'Shape preserving' },
        ]}
        onChange={(v) => onChange({ algorithmVersion: Number(v) as 1 | 2 } as Partial<Adjustment>)}
      />
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          onChange({
            points: [],
            channelPoints: { rgb: [], red: [], green: [], blue: [] },
          } as Partial<Adjustment>)
        }
      >
        Reset all channels
      </Button>
      <CurveEditor
        key={`${adj.id}-${adj.channel}`}
        value={curvesPointsToCurvePoints(channels[adj.channel] ?? [])}
        onChange={changePoints}
        algorithm={adj.algorithmVersion === 2 ? 'pchip' : 'legacy'}
        channel={adj.channel as 'rgb' | 'red' | 'green' | 'blue'}
        onChannelChange={changeChannel}
        histogram={sourceHistogram ?? undefined}
        onDragStart={onEditStart}
        onDragEnd={onEditEnd}
      />
      <p className="tonal-editor__hint">
        Sample upstream input to add a point on the current transfer. RGB uses the arithmetic mean
        of the three encoded components.
      </p>
      <SourceChannels
        source={sourceImageData}
        label={histogramSourceLabel}
        onSample={(x, y) => {
          if (!sourceImageData || (channels[adj.channel]?.length ?? 0) >= 256) return;
          const at = (y * sourceImageData.width + x) * 4;
          if (sourceImageData.data[at + 3] === 0) return;
          const c = { red: 0, green: 1, blue: 2 };
          let input =
            adj.channel === 'rgb'
              ? (sourceImageData.data[at]! +
                  sourceImageData.data[at + 1]! +
                  sourceImageData.data[at + 2]!) /
                3
              : sourceImageData.data[at + c[adj.channel]]!;
          if (adj.channel !== 'rgb') {
            input =
              compileCurve(
                curvesPointsToCurvePoints(channels.rgb ?? []),
                adj.algorithmVersion === 2 ? 'pchip' : 'legacy',
              )(input / 255) * 255;
          }
          const points = curvesPointsToCurvePoints(channels[adj.channel] ?? []);
          const output = compileCurve(
            points,
            adj.algorithmVersion === 2 ? 'pchip' : 'legacy',
          )(input / 255);
          changePoints([...points, { id: crypto.randomUUID(), x: input / 255, y: output }]);
        }}
      />
    </div>
  );
}
