import { getUpscaleMode, type RestorationOperation } from '@varve/engine';
import {
  ENHANCEMENT_PRESETS,
  type EnhancementPreset,
  type EnhancementPresetId,
} from './enhancementPresets';

const MODEL_BACKED_OPERATIONS = new Set<RestorationOperation>([
  'denoise',
  'restore-upscale',
  'deblur',
  'deblur-upscale',
  'compression-restoration',
]);

export function isModelBackedOperation(operation: RestorationOperation | 'auto' | 'none'): boolean {
  return operation !== 'auto' && operation !== 'none' && MODEL_BACKED_OPERATIONS.has(operation);
}

export function isModelBackedPreset(preset: EnhancementPreset | undefined): boolean {
  if (!preset) return false;
  return isModelBackedOperation(preset.operation) || getUpscaleMode(preset.mode)?.isAi === true;
}

export function getAdmittedEnhancementPresets(aiEnabled: boolean): readonly EnhancementPreset[] {
  if (aiEnabled) return ENHANCEMENT_PRESETS;
  return ENHANCEMENT_PRESETS.filter((preset) => !isModelBackedPreset(preset));
}

export function isAdmittedEnhancementPreset(
  presetId: EnhancementPresetId,
  aiEnabled: boolean,
): boolean {
  if (presetId === 'custom') return true;
  const preset = ENHANCEMENT_PRESETS.find((entry) => entry.id === presetId);
  return Boolean(preset && (aiEnabled || !isModelBackedPreset(preset)));
}

export interface EnhancementOperationOption {
  value: RestorationOperation | 'auto';
  label: string;
}

export function getEnhancementOperationOptions(
  aiEnabled: boolean,
  isAvailable: (operation: RestorationOperation) => boolean,
): EnhancementOperationOption[] {
  const options: EnhancementOperationOption[] = [
    { value: 'auto', label: 'Auto / Recommended' },
    { value: 'upscale', label: 'Upscale' },
  ];
  if (!aiEnabled) return options;
  return [
    ...options,
    { value: 'denoise', label: 'Denoise' },
    { value: 'restore-upscale', label: 'Restore + Upscale' },
    {
      value: 'deblur',
      label: isAvailable('deblur') ? 'Deblur' : 'Deblur (not available)',
    },
    {
      value: 'deblur-upscale',
      label: isAvailable('deblur-upscale')
        ? 'Deblur + Upscale'
        : 'Deblur + Upscale (not available)',
    },
    {
      value: 'compression-restoration',
      label: isAvailable('compression-restoration')
        ? 'Remove compression artifacts'
        : 'Remove compression artifacts (not available)',
    },
  ];
}

/** Auto may stay listed when AI is off, but it may only resolve to a CPU method. */
export function resolveAutoOperationForAiGate(
  operation: RestorationOperation | null,
  recommendation: readonly string[],
  aiEnabled: boolean,
): RestorationOperation | null {
  if (aiEnabled || operation === null || !isModelBackedOperation(operation)) return operation;
  return recommendation.includes('upscale') ? 'upscale' : null;
}
