import type { DialogRuntime } from '../useDialogRuntime';

export function DialogHeader({ controller }: { controller: DialogRuntime }) {
  const { isProcessing, onClose } = controller;
  return (
    <div className="varve-dialog__header">
      <h2 id="caf-dialog-title" className="varve-dialog__title">
        Content-Aware Fill
      </h2>
      <button
        type="button"
        className="varve-dialog__close"
        aria-label="Close dialog"
        onClick={onClose}
        disabled={isProcessing}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  );
}
