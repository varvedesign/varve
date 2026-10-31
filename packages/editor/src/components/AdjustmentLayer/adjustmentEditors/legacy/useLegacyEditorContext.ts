import type { Adjustment } from '@varve/scene';
import { useCallback, useState } from 'react';
import type { AdjustmentEditorProps } from '../types';

export function useLegacyEditorContext({
  adjustment,
  onChange,
  onEditStart,
  onEditEnd,
  doc,
  sourceHistogram,
  histogramSourceLabel,
  histogramLoading,
  sourceImageData,
  sourceCoordSpace,
  detailScope,
}: AdjustmentEditorProps) {
  const handleValue = useCallback(
    (key: string) => (value: number) => {
      onChange({ [key]: value } as Partial<Adjustment>);
    },
    [onChange],
  );

  const handleNumber = useCallback(
    (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number.parseFloat(e.target.value);
      if (!Number.isNaN(v)) {
        onChange({ [key]: v } as Partial<Adjustment>);
      }
    },
    [onChange],
  );
  const [hueSaturationRange, setHueSaturationRange] = useState('master');

  return {
    adjustment,
    onChange,
    onEditStart,
    onEditEnd,
    doc,
    sourceHistogram,
    histogramSourceLabel,
    histogramLoading,
    sourceImageData,
    sourceCoordSpace,
    detailScope,
    handleValue,
    handleNumber,
    hueSaturationRange,
    setHueSaturationRange,
  };
}

export type LegacyEditorContext = ReturnType<typeof useLegacyEditorContext>;
