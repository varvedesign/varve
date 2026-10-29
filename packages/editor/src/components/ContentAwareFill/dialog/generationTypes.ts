import type {
  ExpandPlan,
  ExpandWorkingFrame,
  GenerativeJobController,
  GenerativeJobSnapshot,
} from '@varve/engine';
import type { SourceImageRegion } from '../generationRaster';
import type { SelectionHealth } from '../selectionHealth';
import type { DialogDerived } from './useDialogDerived';
import type { DialogState } from './useDialogState';

export type GenerationRuntime = DialogState & DialogDerived;

export type GenerationToken = ReturnType<GenerativeJobController['start']>;

export type GenerationPrelude = {
  sourceWidth: number;
  sourceHeight: number;
  needsDiffusion: boolean;
  targetModelAspectRatio: number | undefined;
  maskCanvas: HTMLCanvasElement;
  previewMask: Uint8Array;
  previewWidth: number;
  previewHeight: number;
  currentMaskHealth: SelectionHealth;
  jobSnapshot: GenerativeJobSnapshot;
  token: GenerationToken;
  isCurrentJob: () => boolean;
};

export type GenerationPrepared = {
  generationImage: ImageData;
  mask: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  sourceRegion: SourceImageRegion | null;
  userMaskDataUrl: string;
  outputFrame: {
    x: number;
    y: number;
    width: number;
    height: number;
    sourceWidth: number;
    sourceHeight: number;
  };
  sourceMaskForPersistence: {
    width: number;
    height: number;
    coverage?: Uint8Array;
    dataUrl?: string;
    bounds?: SourceImageRegion;
  } | null;
  userMaskBounds: SourceImageRegion | undefined;
  expandContext: {
    fullPlan: ExpandPlan;
    working: ExpandWorkingFrame;
    sourceBase: string;
  } | null;
};

export type GenerationRunInput = GenerationPrepared & GenerationPrelude;
