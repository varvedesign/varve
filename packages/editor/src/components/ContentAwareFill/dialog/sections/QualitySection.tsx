import { QUALITY_DESCRIPTIONS, QUALITY_LABELS } from '@varve/engine';
import type { DialogRuntime } from '../useDialogRuntime';

export function QualitySection({ controller }: { controller: DialogRuntime }) {
  const { invalidatePreview, quality, setQuality } = controller;
  return (
    <div className="caf-dialog__section">
      <span className="caf-dialog__label">Quality</span>
      <div className="caf-dialog__quality-options">
        {(['fast', 'ai'] as const).map((q) => (
          <label
            key={q}
            className={`caf-dialog__quality-btn${quality === q ? ' caf-dialog__quality-btn--active' : ''}`}
          >
            <input
              type="radio"
              name="caf-quality"
              value={q}
              checked={quality === q}
              onChange={() => {
                setQuality(q);
                invalidatePreview();
              }}
              className="caf-dialog__quality-input"
            />
            <span className="caf-dialog__quality-label">{QUALITY_LABELS[q]}</span>
            <span className="caf-dialog__quality-desc">{QUALITY_DESCRIPTIONS[q]}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
