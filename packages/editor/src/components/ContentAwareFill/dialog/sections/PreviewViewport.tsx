import type { DialogRuntime } from '../useDialogRuntime';

export function PreviewViewport({ controller }: { controller: DialogRuntime }) {
  const {
    displayHeight,
    displayWidth,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    hasResult,
    maskCanvasRef,
    maskVisible,
    previewAreaRef,
    previewCanvasRef,
    previewDataUrl,
    previewZoom,
    showOriginal,
  } = controller;
  return (
    <div
      ref={previewAreaRef}
      className={`caf-dialog__preview-area${previewZoom === 'custom' ? ' caf-dialog__preview-area--zoom' : ''}`}
    >
      <div
        className="caf-dialog__preview-stage"
        style={
          displayWidth > 0 && displayHeight > 0
            ? { width: `${displayWidth}px`, height: `${displayHeight}px` }
            : undefined
        }
      >
        <canvas
          ref={previewCanvasRef}
          className={`caf-dialog__preview-canvas${showOriginal || !hasResult ? ' caf-dialog__preview-canvas--visible' : ''}`}
        />

        {hasResult && previewDataUrl && (
          <img
            src={previewDataUrl}
            alt="Fill result"
            className={`caf-dialog__preview-canvas${!showOriginal ? ' caf-dialog__preview-canvas--visible' : ''}`}
          />
        )}

        {!hasResult && (
          <canvas
            ref={maskCanvasRef}
            className="caf-dialog__mask-canvas"
            style={{ opacity: maskVisible ? 0.45 : 0 }}
            aria-label="Paint removal mask"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        )}
      </div>
    </div>
  );
}
