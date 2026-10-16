/** On-canvas placement controls for live group repeats. */
import type { GroupNode, ObjectRepeat } from '@varve/scene';
import type { Point } from '@varve/shared';
import {
  applyAffine,
  computeFloatingOrigin,
  screenToWorld,
  tryInvertAffine,
  worldToScreen,
} from '@varve/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getEditorViewport, toCamera } from '../canvas/cameraState';
import { CANVAS_INTERACTIVE_OVERLAY_Z_INDEX } from '../canvas/overlayZIndex';
import { useEditor } from '../context';
import { sourceLocalBounds } from '../scene/objectRepeatGeometry';
import './object-repeat-handles.css';

type HandleKind = 'grid-x' | 'grid-y' | 'center' | 'sweep';

interface HandlePoint {
  kind: HandleKind;
  point: Point;
  label: string;
  value: number;
}

interface DragSession {
  pointerId: number;
  nodeId: string;
  kind: HandleKind;
  repeat: ObjectRepeat;
  inverse: import('@varve/shared').Affine;
  svg: SVGSVGElement;
  lastSweepAngle: number;
  sweepValue: number;
  anchor: Point;
}

function clampSweep(degrees: number): number {
  return Math.max(-360, Math.min(360, degrees));
}

function localToScreen(
  point: Point,
  transform: import('@varve/shared').Affine,
  camera: ReturnType<typeof toCamera>,
  viewport: ReturnType<typeof getEditorViewport>,
  origin: ReturnType<typeof computeFloatingOrigin>,
): Point {
  const world = applyAffine(transform, point);
  return worldToScreen(camera, world[0], world[1], viewport, origin);
}

function repeatHandles(
  repeat: ObjectRepeat,
  zoom: number,
  bounds: { x: number; y: number; w: number; h: number } | null,
): HandlePoint[] {
  if (repeat.type === 'grid') {
    const handles: HandlePoint[] = [];
    const anchorX = bounds?.x ?? 0;
    const anchorY = bounds ? bounds.y + bounds.h / 2 : 0;
    if (repeat.columns > 1) {
      handles.push({
        kind: 'grid-x',
        point: [anchorX + repeat.spacingX, anchorY],
        label: 'Horizontal repeat spacing',
        value: repeat.spacingX,
      });
    }
    if (repeat.rows > 1) {
      const anchorX = bounds ? bounds.x + bounds.w / 2 : 0;
      const anchorY = bounds?.y ?? 0;
      handles.push({
        kind: 'grid-y',
        point: [anchorX, anchorY + repeat.spacingY],
        label: 'Vertical repeat spacing',
        value: repeat.spacingY,
      });
    }
    return handles;
  }
  if (repeat.type === 'radial') {
    const radius = 56 / zoom;
    const angle = (repeat.sweep * Math.PI) / 180;
    return [
      { kind: 'center', point: repeat.center, label: 'Radial repeat center', value: 0 },
      {
        kind: 'sweep',
        point: [
          repeat.center[0] + Math.cos(angle) * radius,
          repeat.center[1] + Math.sin(angle) * radius,
        ],
        label: 'Radial repeat sweep',
        value: repeat.sweep,
      },
    ];
  }
  return [{ kind: 'center', point: repeat.center, label: 'Mirror axis center', value: 0 }];
}

export function ObjectRepeatHandleOverlay() {
  const editor = useEditor();
  const selection = editor.state.selection;
  const nodeId = selection.length === 1 ? selection[0] : undefined;
  const node = nodeId ? editor.state.document.nodes[nodeId] : undefined;
  const group = node?.kind === 'group' ? (node as GroupNode) : null;
  const repeat = group?.objectRepeat;
  const [active, setActive] = useState<HandleKind | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const finishDragRef = useRef<(outcome: 'commit' | 'cancel') => void>(() => undefined);

  const finishDrag = useCallback(
    (outcome: 'commit' | 'cancel') => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      dragRef.current = null;
      setActive(null);
      if (outcome === 'commit') editor.commitTransaction();
      else editor.abortTransaction();
    },
    [editor],
  );

  useEffect(() => {
    finishDragRef.current = finishDrag;
  }, [finishDrag]);

  useEffect(
    () => () => {
      if (dragRef.current) finishDragRef.current('cancel');
    },
    [],
  );

  const update = useCallback(
    (id: string, nextRepeat: ObjectRepeat) => {
      editor.updateNode(id, (current) =>
        current.kind === 'group' ? { ...current, objectRepeat: nextRepeat } : current,
      );
    },
    [editor],
  );

  const applyLocalPoint = useCallback(
    (session: DragSession, point: Point) => {
      const repeat = session.repeat;
      if (repeat.type === 'grid') {
        if (session.kind === 'grid-x')
          update(session.nodeId, { ...repeat, spacingX: point[0] - session.anchor[0] });
        if (session.kind === 'grid-y')
          update(session.nodeId, { ...repeat, spacingY: point[1] - session.anchor[1] });
        return;
      }
      if (session.kind === 'center') {
        update(session.nodeId, { ...repeat, center: point });
        return;
      }
    },
    [update],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, handle: HandlePoint) => {
      if (!group || !repeat) return;
      const step = event.shiftKey ? 10 : 1;
      let next: ObjectRepeat = repeat;
      if (repeat.type === 'grid') {
        if (handle.kind === 'grid-x' && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
          next = {
            ...repeat,
            spacingX: repeat.spacingX + (event.key === 'ArrowRight' ? step : -step),
          };
        } else if (
          handle.kind === 'grid-y' &&
          (event.key === 'ArrowDown' || event.key === 'ArrowUp')
        ) {
          next = {
            ...repeat,
            spacingY: repeat.spacingY + (event.key === 'ArrowDown' ? step : -step),
          };
        }
      } else if (handle.kind === 'center') {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
        const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
        const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
        next = { ...repeat, center: [repeat.center[0] + dx, repeat.center[1] + dy] };
      } else if (repeat.type === 'radial' && handle.kind === 'sweep') {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step : -step;
        next = { ...repeat, sweep: clampSweep(repeat.sweep + delta) };
      } else {
        return;
      }
      if (next === repeat) return;
      event.preventDefault();
      event.stopPropagation();
      editor.groupCompoundOperation('Adjust live repeat', () => update(group.id, next));
    },
    [editor, group, repeat, update],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, handle: HandlePoint) => {
      if (event.button !== 0 || !group || !repeat || dragRef.current) return;
      const transform = editor.getWorldTransform(group.id);
      const inverse = tryInvertAffine(transform);
      const svg = event.currentTarget.closest('svg') as SVGSVGElement | null;
      if (!inverse || !svg) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const [centerX, centerY] = repeat.type === 'radial' ? repeat.center : [0, 0];
      const bounds = sourceLocalBounds(editor.state.document, group, editor.getWorldTransform);
      const anchor: Point =
        handle.kind === 'grid-x'
          ? [bounds?.x ?? 0, bounds ? bounds.y + bounds.h / 2 : 0]
          : handle.kind === 'grid-y'
            ? [bounds ? bounds.x + bounds.w / 2 : 0, bounds?.y ?? 0]
            : [0, 0];
      const initialSweepAngle =
        handle.kind === 'sweep'
          ? (Math.atan2(handle.point[1] - centerY, handle.point[0] - centerX) * 180) / Math.PI
          : 0;
      dragRef.current = {
        pointerId: event.pointerId,
        nodeId: group.id,
        kind: handle.kind,
        repeat,
        inverse,
        svg,
        lastSweepAngle: initialSweepAngle,
        sweepValue: repeat.type === 'radial' ? repeat.sweep : 0,
        anchor,
      };
      setActive(handle.kind);
      editor.beginTransaction('preview');

      const onMove = (moveEvent: PointerEvent) => {
        const session = dragRef.current;
        if (!session || moveEvent.pointerId !== session.pointerId) return;
        const rect = session.svg.getBoundingClientRect();
        const viewport = getEditorViewport();
        const camera = toCamera({
          zoom: editor.state.zoom,
          pan: editor.state.pan,
          cameraRotation: editor.state.cameraRotation,
        });
        const origin = computeFloatingOrigin(
          { zoom: editor.state.zoom, pan: editor.state.pan, rotation: editor.state.cameraRotation },
          viewport,
        );
        const world = screenToWorld(
          camera,
          moveEvent.clientX - rect.left,
          moveEvent.clientY - rect.top,
          viewport,
          origin,
        );
        const local = applyAffine(session.inverse, world);
        if (session.kind === 'sweep' && session.repeat.type === 'radial') {
          const [centerX, centerY] = session.repeat.center;
          const angle = (Math.atan2(local[1] - centerY, local[0] - centerX) * 180) / Math.PI;
          const delta = ((((angle - session.lastSweepAngle + 540) % 360) + 360) % 360) - 180;
          session.sweepValue = clampSweep(session.sweepValue + delta);
          session.lastSweepAngle = angle;
          update(session.nodeId, { ...session.repeat, sweep: session.sweepValue });
          return;
        }
        applyLocalPoint(session, local);
      };
      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId === event.pointerId) finishDrag('commit');
      };
      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId === event.pointerId) finishDrag('cancel');
      };
      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key !== 'Escape') return;
        keyEvent.preventDefault();
        finishDrag('cancel');
      };
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKeyDown);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKeyDown);
    },
    [applyLocalPoint, editor, finishDrag, group, repeat, update],
  );

  if (!group || !repeat || editor.state.tool !== 'select') return null;
  const transform = editor.getWorldTransform(group.id);
  const viewport = getEditorViewport();
  const camera = toCamera({
    zoom: editor.state.zoom,
    pan: editor.state.pan,
    cameraRotation: editor.state.cameraRotation,
  });
  const origin = computeFloatingOrigin(
    { zoom: editor.state.zoom, pan: editor.state.pan, rotation: editor.state.cameraRotation },
    viewport,
  );
  const bounds = sourceLocalBounds(editor.state.document, group, editor.getWorldTransform);
  const handles = repeatHandles(repeat, editor.state.zoom, bounds);
  const axisLength = 48 / editor.state.zoom;

  return (
    <svg
      data-object-repeat-handles
      data-repeat-type={repeat.type}
      data-repeat-dragging={active ?? undefined}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: CANVAS_INTERACTIVE_OVERLAY_Z_INDEX,
      }}
      aria-label={`${repeat.type} repeat controls`}
    >
      {repeat.type === 'mirror' && (
        <g data-repeat-axes>
          {repeat.horizontal && (
            <line
              {...axisLine(
                transform,
                [repeat.center[0], repeat.center[1] - axisLength],
                [repeat.center[0], repeat.center[1] + axisLength],
                camera,
                viewport,
                origin,
              )}
              stroke="var(--color-canvas-selection)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
          )}
          {repeat.vertical && (
            <line
              {...axisLine(
                transform,
                [repeat.center[0] - axisLength, repeat.center[1]],
                [repeat.center[0] + axisLength, repeat.center[1]],
                camera,
                viewport,
                origin,
              )}
              stroke="var(--color-canvas-selection)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
          )}
        </g>
      )}
      {repeat.type === 'radial' && (
        <line
          {...axisLine(
            transform,
            repeat.center,
            handles.find((handle) => handle.kind === 'sweep')?.point ?? repeat.center,
            camera,
            viewport,
            origin,
          )}
          stroke="var(--color-canvas-selection)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
      )}
      {repeat.type === 'grid' && (
        <g data-repeat-axes>
          {handles.map((handle) => (
            <line
              key={`${handle.kind}-guide`}
              {...axisLine(
                transform,
                handle.kind === 'grid-x'
                  ? [bounds?.x ?? 0, bounds ? bounds.y + bounds.h / 2 : 0]
                  : [bounds ? bounds.x + bounds.w / 2 : 0, bounds?.y ?? 0],
                handle.point,
                camera,
                viewport,
                origin,
              )}
              stroke="var(--color-canvas-selection)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              opacity={0.7}
            />
          ))}
        </g>
      )}
      {handles.map((handle) => {
        const [cx, cy] = localToScreen(handle.point, transform, camera, viewport, origin);
        return (
          <foreignObject
            key={handle.kind}
            x={cx - 12}
            y={cy - 12}
            width={24}
            height={24}
            style={{ overflow: 'visible', pointerEvents: 'auto' }}
          >
            <button
              type="button"
              data-repeat-handle={handle.kind}
              data-repeat-active={active === handle.kind ? 'true' : undefined}
              aria-label={`${handle.label}${handle.kind.startsWith('grid-') ? `: ${handle.value} pixels` : handle.kind === 'sweep' ? `: ${handle.value} degrees` : ''}`}
              className="object-repeat-handle"
              style={{
                cursor: active === handle.kind ? 'grabbing' : 'grab',
              }}
              onPointerDown={(event) => handlePointerDown(event, handle)}
              onKeyDown={(event) => handleKeyDown(event, handle)}
            >
              <span
                className="object-repeat-handle__dot"
                aria-hidden="true"
                style={{
                  background:
                    handle.kind === 'center'
                      ? 'var(--elevation-surface-default)'
                      : 'var(--color-canvas-selection)',
                }}
              />
            </button>
          </foreignObject>
        );
      })}
    </svg>
  );
}

function axisLine(
  transform: import('@varve/shared').Affine,
  start: Point,
  end: Point,
  camera: ReturnType<typeof toCamera>,
  viewport: ReturnType<typeof getEditorViewport>,
  origin: ReturnType<typeof computeFloatingOrigin>,
) {
  const [x1, y1] = localToScreen(start, transform, camera, viewport, origin);
  const [x2, y2] = localToScreen(end, transform, camera, viewport, origin);
  return { x1, y1, x2, y2 };
}
