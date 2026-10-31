import {
  isLutInputSpaceImplemented,
  LUT_INPUT_SPACE_LABELS,
  parseLutFile,
  serializeLutForDocument,
} from '@varve/engine';
import type { Adjustment } from '@varve/scene';
import { FilePickerButton, Select } from '@varve/ui';
import { useCallback, useState } from 'react';
import { GradientMapAdjustmentSection } from '../../../Inspector/controls/GradientMapAdjustmentSection';
import { RangeValueControl } from '../../../Inspector/controls/RangeValueControl';
import { DitherEditor } from '../../LiveEffectEditors';
import { SourceChannels } from '../../SourceChannels';
import { ThresholdAdjustmentEditor } from '../../ThresholdAdjustmentEditor';
import { BlackAndWhiteEditor } from '../blackAndWhite';
import { ChannelMixerEditor } from '../channelMixer';
import { BooleanRow } from '../controls';
import { DuotoneEditor } from '../duotone';
import { ColorHalftoneEditor } from '../halftone/ColorHalftoneEditor';
import { HalftoneEditor } from '../halftone/HalftoneEditor';
import { PhotoFilterEditor } from '../photoFilter';
import { PosterizeEditor } from '../posterize';
import { ShadowHighlightEditor } from '../shadowHighlight';
import { TritoneEditor } from '../tritone';
import type { AdjustmentEditorProps } from '../types';
import type { LegacyEditorContext } from './useLegacyEditorContext';

export function renderChannelCases(context: LegacyEditorContext) {
  const {
    adjustment,
    onChange,
    onEditStart,
    onEditEnd,
    doc,
    sourceHistogram,
    histogramSourceLabel,
    sourceImageData,
    sourceCoordSpace,
  } = context;

  function LutEditor({ adjustment, onChange }: AdjustmentEditorProps) {
    const adj = adjustment as import('@varve/engine').LutAdjustment;
    const declaredInputSpace = adj.inputSpace ?? 'sRGB';
    const [status, setStatus] = useState<string | null>(null);
    const [lutMeta, setLutMeta] = useState<{ name: string; format: string; size: number } | null>(
      null,
    );

    const handleFile = useCallback(
      (file: File | undefined) => {
        if (!file) return;
        void file
          .text()
          .then((text) => {
            try {
              const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
              if (ext === 'cube' || ext === '3dl') {
                const result = parseLutFile(file.name, text);
                const json = serializeLutForDocument(result.transform);
                onChange({
                  lutJson: json,
                  originalFilename: file.name,
                  inputSpace: 'sRGB',
                  interpolation: 'tetrahedral',
                  intensity: 1,
                  linearize: false,
                } as unknown as Partial<Adjustment>);
                const kind = result.transform.kind;
                const size =
                  kind === 'shaper3d' ? result.transform.lut3d.size : result.transform.size;
                setLutMeta({
                  name: result.title ?? file.name,
                  format: result.format,
                  size,
                });
                const warning = result.warnings?.[0] ? `; ${result.warnings[0]}` : '';
                setStatus(
                  `Imported ${result.format.toUpperCase()} (${kind === '1d' ? '1D' : '3D'} ${size}^${kind === '3d' ? '3' : '1'}${warning})`,
                );
              } else {
                setStatus(`Unsupported format: .${ext}`);
              }
            } catch (err) {
              setStatus(`Parse error: ${err instanceof Error ? err.message : String(err)}`);
            }
          })
          .catch(() => setStatus('Failed to read file'));
      },
      [onChange],
    );

    return (
      <div className="adj-lut-editor">
        <FilePickerButton
          className="adj-editor__row adj-lut-editor__import-btn"
          variant="ghost"
          accept=".cube,.3dl"
          actionLabel={lutMeta ? 'Replace LUT File' : 'Import LUT File'}
          inputLabel="Import LUT file"
          onFiles={([file]) => handleFile(file)}
          onReject={(rejections) => setStatus(rejections[0]?.reason ?? 'LUT file rejected.')}
        />

        {status && (
          <div className="adj-lut-editor__status">
            <span>{status}</span>
          </div>
        )}

        {lutMeta && (
          <div className="adj-lut-editor__meta">
            <span className="adj-editor__label">{lutMeta.name}</span>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              {lutMeta.format.toUpperCase()} | {lutMeta.size}^
              {lutMeta.format === '3dl' ||
              (adj.lutJson &&
                (() => {
                  try {
                    return JSON.parse(adj.lutJson)?.kind === '3d';
                  } catch {
                    return false;
                  }
                })())
                ? '3'
                : '1'}
            </span>
          </div>
        )}

        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Intensity</span>
            <span>{Math.round((adj.intensity ?? 1) * 100)}%</span>
          </div>
          <RangeValueControl
            label="LUT intensity"
            min={0}
            max={100}
            step={1}
            value={Math.round((adj.intensity ?? 1) * 100)}
            unit="%"
            onChange={(value) =>
              onChange({
                intensity: value / 100,
              } as unknown as Partial<Adjustment>)
            }
          />
        </div>

        <div className="adj-editor__row">
          <span className="adj-editor__label">Interpolation</span>
          <Select
            label="Interpolation method"
            value={adj.interpolation ?? 'tetrahedral'}
            options={[
              { value: 'nearest', label: 'Nearest' },
              { value: 'trilinear', label: 'Trilinear' },
              { value: 'tetrahedral', label: 'Tetrahedral' },
            ]}
            onChange={(v) =>
              onChange({
                interpolation: v as 'nearest' | 'trilinear' | 'tetrahedral',
              } as unknown as Partial<Adjustment>)
            }
          />
        </div>

        <div className="adj-editor__row">
          <span className="adj-editor__label">Input Space</span>
          <Select
            label="Input colour space"
            value={declaredInputSpace}
            options={Object.entries(LUT_INPUT_SPACE_LABELS).map(([k, v]) => {
              const implemented = isLutInputSpaceImplemented(
                k as import('@varve/engine').LutInputSpace,
              );
              return {
                value: k,
                label: implemented ? v : `${v} (metadata only)`,
                disabled: !implemented,
                disabledReason: implemented
                  ? undefined
                  : 'No verified colour-space conversion is implemented for this label.',
              };
            })}
            onChange={(v) => onChange({ inputSpace: v } as unknown as Partial<Adjustment>)}
          />
        </div>

        {!isLutInputSpaceImplemented(declaredInputSpace) && (
          <div className="adj-lut-editor__warning" role="status">
            This saved LUT declares {LUT_INPUT_SPACE_LABELS[declaredInputSpace]}, but Varve does not
            currently convert that colour space. The LUT is evaluated against sRGB values; choose
            sRGB to make that assumption explicit.
          </div>
        )}

        <BooleanRow
          label="Linearize"
          checked={adj.linearize ?? false}
          onChange={(value) => onChange({ linearize: value } as unknown as Partial<Adjustment>)}
          ariaLabel="Linearize before applying"
        />
      </div>
    );
  }

  switch (adjustment.kind) {
    case 'channelMixer':
      return (
        <>
          <ChannelMixerEditor adjustment={adjustment} onChange={onChange} />
          <SourceChannels source={sourceImageData} label={histogramSourceLabel} />
        </>
      );

    case 'photoFilter':
      return (
        <PhotoFilterEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />
      );

    case 'shadowHighlight':
      return <ShadowHighlightEditor adjustment={adjustment} onChange={onChange} />;

    case 'halftone':
      return <HalftoneEditor adjustment={adjustment} onChange={onChange} />;

    case 'gradientMap': {
      const adj = adjustment as import('@varve/scene').GradientMapAdjustment;
      return (
        <GradientMapAdjustmentSection
          adjustment={adj}
          onChange={(patch) => onChange(patch as unknown as Partial<Adjustment>)}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
          sourceHistogram={sourceHistogram}
        />
      );
    }

    case 'tritone':
      return (
        <TritoneEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />
      );

    case 'colorHalftone':
      return (
        <ColorHalftoneEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />
      );

    case 'duotone':
      return (
        <DuotoneEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />
      );

    case 'blackAndWhite':
      return (
        <BlackAndWhiteEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />
      );

    case 'posterize':
      return <PosterizeEditor adjustment={adjustment} onChange={onChange} />;

    case 'threshold':
      return (
        <ThresholdAdjustmentEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
          sourceHistogram={sourceHistogram}
        />
      );

    case 'lut':
      return (
        <LutEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />
      );

    case 'dither':
      return (
        <DitherEditor
          adjustment={adjustment}
          onChange={onChange}
          doc={doc}
          sourceImageData={sourceImageData}
          sourceCoordSpace={sourceCoordSpace ?? undefined}
        />
      );
  }
  return undefined;
}
