import type { Adjustment } from '@varve/scene';
import { Select } from '@varve/ui';
import { RangeValueControl } from '../../../Inspector/controls/RangeValueControl';
import { SharpenEditor } from '../../SharpenEditor';
import type { LegacyEditorContext } from './useLegacyEditorContext';

export function renderTonalCases(context: LegacyEditorContext) {
  const {
    adjustment,
    onChange,
    doc,
    detailScope,
    handleValue,
    hueSaturationRange,
    setHueSaturationRange,
  } = context;

  switch (adjustment.kind) {
    case 'hueSaturation': {
      const ranges = adjustment.ranges as Record<
        string,
        { hue: number; saturation: number; lightness: number }
      >;
      const activeRange = hueSaturationRange;
      const active = ranges[activeRange] ??
        ranges.master ?? { hue: 0, saturation: 0, lightness: 0 };
      const updateRange = (key: 'hue' | 'saturation' | 'lightness', value: number) =>
        onChange({
          ranges: {
            ...ranges,
            [activeRange]: { ...active, [key]: value },
          },
        } as Partial<Adjustment>);
      return (
        <div className="adj-editor__group">
          <Select
            label="Hue/Saturation range"
            value={activeRange}
            options={[
              { value: 'master', label: 'Master' },
              { value: 'reds', label: 'Reds' },
              { value: 'yellows', label: 'Yellows' },
              { value: 'greens', label: 'Greens' },
              { value: 'cyans', label: 'Cyans' },
              { value: 'blues', label: 'Blues' },
              { value: 'magentas', label: 'Magentas' },
            ]}
            onChange={setHueSaturationRange}
          />
          {(
            [
              ['hue', 'Hue', -180, 180, '°'],
              ['saturation', 'Saturation', -100, 100, '%'],
              ['lightness', 'Lightness', -100, 100, '%'],
            ] as const
          ).map(([key, label, min, max, unit]) => (
            <div className="adj-editor__slider-row" key={key}>
              <div className="adj-editor__slider-label">
                <span>{label}</span>
                <span>
                  {active[key]}
                  {unit}
                </span>
              </div>
              <RangeValueControl
                label={`${label} ${activeRange}`}
                min={min}
                max={max}
                value={active[key]}
                unit={unit}
                onChange={(value) => updateRange(key, value)}
              />
            </div>
          ))}
        </div>
      );
    }

    case 'hueRotate':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Hue</span>
            <span>{adjustment.value}°</span>
          </div>
          <RangeValueControl
            label="Hue rotate"
            min={-180}
            max={180}
            value={adjustment.value}
            unit="°"
            onChange={handleValue('value')}
          />
        </div>
      );

    case 'sepia':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Sepia</span>
            <span>{adjustment.value}%</span>
          </div>
          <RangeValueControl
            label="Sepia"
            min={0}
            max={100}
            value={adjustment.value}
            unit="%"
            onChange={handleValue('value')}
          />
        </div>
      );

    case 'grayscale':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Grayscale</span>
            <span>{adjustment.value}%</span>
          </div>
          <RangeValueControl
            label="Grayscale"
            min={0}
            max={100}
            value={adjustment.value}
            unit="%"
            onChange={handleValue('value')}
          />
        </div>
      );

    case 'invert':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Invert</span>
            <span>{adjustment.value}%</span>
          </div>
          <RangeValueControl
            label="Invert"
            min={0}
            max={100}
            value={adjustment.value}
            unit="%"
            onChange={handleValue('value')}
          />
        </div>
      );

    case 'opacity':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Opacity</span>
            <span>{adjustment.value}%</span>
          </div>
          <RangeValueControl
            label="Opacity"
            min={0}
            max={100}
            value={adjustment.value}
            unit="%"
            onChange={handleValue('value')}
          />
        </div>
      );

    case 'blur':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Radius</span>
            <span>{adjustment.radius}px</span>
          </div>
          <RangeValueControl
            label="Blur radius"
            min={0}
            max={50}
            step={0.5}
            value={adjustment.radius}
            unit="px"
            onChange={handleValue('radius')}
          />
        </div>
      );

    case 'sharpen':
      return (
        <SharpenEditor
          adjustment={adjustment}
          onChange={onChange}
          doc={doc}
          detailScope={detailScope}
        />
      );

    case 'tint':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Tint</span>
            <span>{adjustment.value}</span>
          </div>
          <RangeValueControl
            label="Tint"
            min={-100}
            max={100}
            value={adjustment.value}
            onChange={handleValue('value')}
          />
        </div>
      );

    case 'vibrance':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Vibrance</span>
            <span>{adjustment.value}</span>
          </div>
          <RangeValueControl
            label="Vibrance"
            min={-100}
            max={100}
            value={adjustment.value}
            onChange={handleValue('value')}
          />
        </div>
      );
  }
  return undefined;
}
