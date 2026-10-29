import { DOC_PIXELS_PER_INCH, HALFTONE_PRESETS } from '@varve/engine';
import type { Adjustment } from '@varve/scene';
import { useMemo } from 'react';
import type { AdjustmentEditorProps } from '../types';
import { patternForShape } from './options';

export function useHalftoneModel({ adjustment, onChange }: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').HalftoneAdjustment;
  const handleSelect = (key: string) => (value: string) => {
    onChange({ [key]: value } as unknown as Partial<Adjustment>);
  };
  const handleValue = (key: string) => (value: number) => {
    onChange({ [key]: value } as unknown as Partial<Adjustment>);
  };

  const method = adj.method ?? 'am';
  const channel = adj.channel;
  const isCmyk = channel === 'cmyk';
  const isLegacy = adj.algorithmVersion === 1;
  const periodPx = DOC_PIXELS_PER_INCH / Math.max(1, adj.frequency);
  const channelAngles = adj.channelAngles ?? {};
  const registrationOffset = adj.registrationOffset ?? {};

  const currentPresetId = useMemo(() => {
    const match = HALFTONE_PRESETS.find((p) => {
      const preset = p.params;
      return (
        preset.pattern === adj.pattern &&
        preset.frequency === adj.frequency &&
        preset.angle === adj.angle &&
        preset.dotShape === adj.dotShape &&
        preset.channel === adj.channel &&
        preset.method === adj.method &&
        (preset.fmAlgorithm ?? 'blue-noise') === (adj.fmAlgorithm ?? 'blue-noise') &&
        (preset.blackGeneration ?? 'none') === (adj.blackGeneration ?? 'none')
      );
    });
    return match?.id ?? '';
  }, [adj]);

  const handlePresetSelect = (value: string) => {
    const preset = HALFTONE_PRESETS.find((p) => p.id === value);
    if (preset) {
      // Presets are authored against the corrected screen contract.
      const { pattern, ...rest } = preset.params;
      onChange({ pattern, algorithmVersion: 2, ...rest } as unknown as Partial<Adjustment>);
    }
  };

  const handleShapeChange = (shape: string) => {
    onChange({
      dotShape: shape,
      pattern: patternForShape(shape),
    } as unknown as Partial<Adjustment>);
  };

  const setChannelAngle = (key: 'c' | 'm' | 'y' | 'k') => (value: number) => {
    const next = { ...channelAngles };
    if (Number.isFinite(value)) next[key] = value;
    else delete next[key];
    onChange({ channelAngles: next } as unknown as Partial<Adjustment>);
  };
  const setRegistrationOffset = (key: 'c' | 'm' | 'y' | 'k', axis: 0 | 1) => (value: number) => {
    const current = registrationOffset[key] ?? [0, 0];
    const next = {
      ...registrationOffset,
      [key]: axis === 0 ? [value, current[1]] : [current[0], value],
    };
    onChange({ registrationOffset: next } as unknown as Partial<Adjustment>);
  };

  const fgColor = adj.foregroundColor ?? [0, 0, 0];
  const bgColor = adj.backgroundColor ?? [255, 255, 255];
  const isMonoChannel = !isCmyk;

  return {
    adjustment,
    onChange,
    adj,
    handleSelect,
    handleValue,
    method,
    channel,
    isCmyk,
    isLegacy,
    periodPx,
    channelAngles,
    registrationOffset,
    currentPresetId,
    handlePresetSelect,
    handleShapeChange,
    setChannelAngle,
    setRegistrationOffset,
    fgColor,
    bgColor,
    isMonoChannel,
  };
}

export type HalftoneEditorModel = ReturnType<typeof useHalftoneModel>;
