import { DialogFooter } from './dialog/sections/DialogFooter';
import { DialogHeader } from './dialog/sections/DialogHeader';
import { DiffusionModelSection } from './dialog/sections/DiffusionModelSection';
import { DiffusionRefinementSection } from './dialog/sections/DiffusionRefinementSection';
import { ExpandSection } from './dialog/sections/ExpandSection';
import { GenerateSection } from './dialog/sections/GenerateSection';
import { MaskControlsSection } from './dialog/sections/MaskControlsSection';
import { MaskSourceSection } from './dialog/sections/MaskSourceSection';
import { MaskStateSection } from './dialog/sections/MaskStateSection';
import { ModelDownloadSection } from './dialog/sections/ModelDownloadSection';
import { ModeSection } from './dialog/sections/ModeSection';
import { PreviewToolbar } from './dialog/sections/PreviewToolbar';
import { PreviewViewport } from './dialog/sections/PreviewViewport';
import { PromptSection } from './dialog/sections/PromptSection';
import { ProviderBadge } from './dialog/sections/ProviderBadge';
import { QualitySection } from './dialog/sections/QualitySection';
import { VariationSettingsSection } from './dialog/sections/VariationSettingsSection';
import { VariationsFieldset } from './dialog/sections/VariationsFieldset';
import { useDialogRuntime } from './dialog/useDialogRuntime';
import './ContentAwareFillDialog.css';

export interface ContentAwareFillDialogProps {
  nodeId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onApplied?: () => void;
}
export function ContentAwareFillDialog({
  nodeId,
  isOpen,
  onClose,
  onApplied,
}: ContentAwareFillDialogProps) {
  const controller = useDialogRuntime({ nodeId, isOpen, onClose, onApplied });
  const {
    dialogRef,
    backdropPressRef,
    isProcessing,
    adjustZoom,
    selectFitZoom,
    selectOneToOneZoom,
    status,
    errorMessage,
  } = controller;
  if (!isOpen && !dialogRef.current?.open) return null;
  return (
    <dialog
      ref={dialogRef}
      className="varve-dialog varve-dialog--caf"
      aria-labelledby="caf-dialog-title"
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault();
        if (!isProcessing) onClose();
      }}
      onPointerDown={(e) => {
        backdropPressRef.current = { down: e.target === e.currentTarget, up: false };
      }}
      onPointerUp={(e) => {
        backdropPressRef.current.up = e.target === e.currentTarget;
      }}
      onPointerCancel={() => {
        backdropPressRef.current = { down: false, up: false };
      }}
      onClick={(e) => {
        const press = backdropPressRef.current;
        backdropPressRef.current = { down: false, up: false };
        if (e.target === e.currentTarget && press.down && press.up && !isProcessing) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !isProcessing) onClose();
        if (e.target instanceof HTMLInputElement) return;
        if (e.key === '+' || e.key === '=') adjustZoom(25);
        if (e.key === '-') adjustZoom(-25);
        if (e.key === '0') selectFitZoom();
        if (e.key === '1') selectOneToOneZoom();
      }}
    >
      <DialogHeader controller={controller} />

      <div className="caf-dialog__body">
        <div className="caf-dialog__left">
          <ModeSection controller={controller} />
          <PromptSection controller={controller} />
          <ProviderBadge controller={controller} />
          <DiffusionModelSection controller={controller} />
          <DiffusionRefinementSection controller={controller} />
          <MaskSourceSection controller={controller} />
          <ExpandSection controller={controller} />
          <QualitySection controller={controller} />
          <ModelDownloadSection controller={controller} />
          <MaskControlsSection controller={controller} />
          <VariationSettingsSection controller={controller} />
          <MaskStateSection controller={controller} />
          <GenerateSection controller={controller} />
          {status === 'error' && errorMessage && (
            <p className="caf-dialog__error" role="alert">
              {errorMessage}
            </p>
          )}
          <VariationsFieldset controller={controller} />
        </div>
        <div className="caf-dialog__right">
          <PreviewToolbar controller={controller} />
          <PreviewViewport controller={controller} />
        </div>
      </div>

      <DialogFooter controller={controller} />
    </dialog>
  );
}
