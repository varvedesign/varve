import type { Guide } from '@varve/scene';
import { type OverlayAnchor, pointAnchor, viewportPoint } from '@varve/ui';
import { useCallback, useRef, useState } from 'react';
import { editorScreenToWorld, getEditorViewport } from '../../canvas/cameraState';
import {
  distanceSqToGuideLine,
  guideLineScreenEndpoints,
  screenToGuidePosition,
} from '../../canvas/guideGeometry';
import { GuideContextMenu } from './GuideContextMenu';
import { PerspectiveGuideOverlay } from './PerspectiveGuideOverlay';
import './GuideOverlay.css';

interface GuideOverlayProps {
  guides: Guide[];
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation?: number;
  visible?: boolean;
  selectedGuideId?: string | null;
  onMoveGuide: (id: string, position: number) => void;
  onRemoveGuide: (id: string) => void;
  onToggleLock: (id: string) => void;
  onDuplicateGuide?: (id: string, position: number) => string;
  onSelectGuide?: (id: string | null) => void;
}

const GUIDE_HIT = 8;
type WorldPoint = readonly [number, number];
type PerspectiveVanishingPoints = { left: WorldPoint; right: WorldPoint };

function isGuideRulerDropTarget(
  guide: Guide,
  clientX: number,
  clientY: number,
  doc: Document,
): boolean {
  const selector = guide.axis === 'vertical' ? '.ruler-top-wrapper' : '.ruler-left-wrapper';
  const bounds = doc.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
  return (
    !!bounds &&
    clientX >= bounds.left &&
    clientX <= bounds.right &&
    clientY >= bounds.top &&
    clientY <= bounds.bottom
  );
}

export function GuideOverlay({
  guides,
  zoom,
  pan,
  cameraRotation = 0,
  visible = true,
  selectedGuideId = null,
  onMoveGuide,
  onRemoveGuide,
  onToggleLock,
  onDuplicateGuide,
  onSelectGuide,
}: GuideOverlayProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [perspectivePoints, setPerspectivePoints] = useState<PerspectiveVanishingPoints | null>(
    null,
  );
  const [contextMenu, setContextMenu] = useState<{
    anchor: OverlayAnchor;
    guideId: string;
  } | null>(null);
  const draggingRef = useRef<{ guideId: string; pointerId: number } | null>(null);
  const altDuplicateRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const camState = { zoom, pan, cameraRotation };

  const lineForGuide = useCallback(
    (guide: Guide) => {
      const viewport = getEditorViewport();
      return guideLineScreenEndpoints(
        { axis: guide.axis, position: guide.position },
        camState,
        viewport,
      );
    },
    [zoom, pan.x, pan.y, cameraRotation],
  );

  const handlePointerDown = useCallback(
    (guide: Guide, e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if (guide.locked) {
        onSelectGuide?.(guide.id);
        return;
      }
      altDuplicateRef.current = e.altKey;
      draggingRef.current = { guideId: guide.id, pointerId: e.pointerId };
      onSelectGuide?.(guide.id);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [onSelectGuide],
  );

  const handleContextMenu = useCallback(
    (guide: Guide, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const contextElement = containerRef.current;
      if (!contextElement) return;
      setContextMenu({
        anchor: pointAnchor(
          viewportPoint(e.clientX, e.clientY),
          contextElement.ownerDocument,
          contextElement,
        ),
        guideId: guide.id,
      });
      onSelectGuide?.(guide.id);
    },
    [onSelectGuide],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const togglePerspectiveGuide = useCallback(() => {
    setPerspectivePoints((current) => {
      if (current) return null;
      const viewport = getEditorViewport();
      const left = editorScreenToWorld(
        camState,
        viewport.width * 0.18,
        viewport.height * 0.42,
        viewport,
      );
      const right = editorScreenToWorld(
        camState,
        viewport.width * 0.82,
        viewport.height * 0.42,
        viewport,
      );
      return { left, right };
    });
    closeContextMenu();
  }, [zoom, pan.x, pan.y, cameraRotation, closeContextMenu]);

  const movePerspectivePoint = useCallback((side: 'left' | 'right', point: WorldPoint) => {
    setPerspectivePoints((current) => (current ? { ...current, [side]: point } : current));
  }, []);

  const handlePointerMove = useCallback(
    (_guide: Guide, e: React.PointerEvent) => {
      const dragging = draggingRef.current;
      if (dragging?.pointerId !== e.pointerId) return;
      // Pointer capture stays on the original hit area after Alt-duplication,
      // but the active drag belongs to the newly-created guide.
      const activeGuide = guides.find((candidate) => candidate.id === dragging.guideId);
      if (!activeGuide) return;
      if (
        containerRef.current &&
        isGuideRulerDropTarget(
          activeGuide,
          e.clientX,
          e.clientY,
          containerRef.current.ownerDocument,
        )
      ) {
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const viewport = getEditorViewport();
      const world = Math.round(
        screenToGuidePosition(
          { axis: activeGuide.axis, position: activeGuide.position },
          screenX,
          screenY,
          camState,
          viewport,
        ),
      );
      if (altDuplicateRef.current && onDuplicateGuide) {
        const newId = onDuplicateGuide(activeGuide.id, world);
        altDuplicateRef.current = false;
        draggingRef.current = { guideId: newId, pointerId: e.pointerId };
        onSelectGuide?.(newId);
      } else {
        onMoveGuide(activeGuide.id, world);
      }
    },
    [guides, camState, onMoveGuide, onDuplicateGuide, onSelectGuide],
  );

  const handlePointerUp = useCallback(
    (_guide: Guide, e: React.PointerEvent) => {
      const dragging = draggingRef.current;
      if (dragging?.pointerId !== e.pointerId) return;
      // Alt-drag duplicates keep pointer capture on the original guide's hit
      // area, while draggingRef tracks the newly-created guide. Resolve the
      // active ID so release still completes the gesture and can drop that
      // duplicate on a ruler.
      const activeGuide = guides.find((candidate) => candidate.id === dragging.guideId);
      if (!activeGuide) {
        draggingRef.current = null;
        altDuplicateRef.current = false;
        return;
      }
      if (
        !activeGuide.locked &&
        containerRef.current &&
        isGuideRulerDropTarget(
          activeGuide,
          e.clientX,
          e.clientY,
          containerRef.current.ownerDocument,
        )
      ) {
        onRemoveGuide(activeGuide.id);
      }
      draggingRef.current = null;
      altDuplicateRef.current = false;
    },
    [guides, onRemoveGuide],
  );

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    if (draggingRef.current?.pointerId !== e.pointerId) return;
    draggingRef.current = null;
    altDuplicateRef.current = false;
  }, []);

  const handleOverlayPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (draggingRef.current) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const viewport = getEditorViewport();
      const hitRadiusSq = (GUIDE_HIT / 2) ** 2;
      let nearest: string | null = null;
      let nearestDist = hitRadiusSq;
      for (const guide of guides) {
        const dist = distanceSqToGuideLine(
          { axis: guide.axis, position: guide.position },
          camState,
          viewport,
          screenX,
          screenY,
        );
        if (dist <= nearestDist) {
          nearestDist = dist;
          nearest = guide.id;
        }
      }
      setHoveredId(nearest);
    },
    [guides, camState],
  );

  const ctxGuide = contextMenu ? guides.find((g) => g.id === contextMenu.guideId) : null;

  if (!visible || (guides.length === 0 && !perspectivePoints)) return null;

  return (
    <div
      className="guide-overlay"
      ref={containerRef}
      onPointerMove={handleOverlayPointerMove}
      onPointerLeave={() => setHoveredId(null)}
    >
      {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative guide overlay */}
      <svg
        className="guide-overlay__svg"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        aria-hidden
      >
        {guides.map((guide) => {
          const line = lineForGuide(guide);
          const isHover = hoveredId === guide.id || draggingRef.current?.guideId === guide.id;
          const isSelected = selectedGuideId === guide.id;
          const color = guide.color ?? 'var(--color-canvas-guide)';
          const midX = (line.x1 + line.x2) / 2;
          const midY = (line.y1 + line.y2) / 2;

          return (
            <g key={guide.id}>
              <line
                className="guide-overlay__line"
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                stroke={color}
                strokeWidth={isSelected ? 2.5 : isHover ? 2 : 1}
                strokeDasharray={guide.locked ? '4 2' : '2 2'}
                style={{ pointerEvents: 'none' }}
              />
              {/* Invisible hit stroke for drag + context menu */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: SVG line hit target for guide drag */}
              <line
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                stroke="transparent"
                strokeWidth={GUIDE_HIT}
                className="guide-overlay__hit-area"
                style={{
                  pointerEvents: 'auto',
                  cursor: guide.locked ? 'default' : 'grab',
                }}
                onPointerDown={(e) => handlePointerDown(guide, e)}
                onPointerMove={(e) => handlePointerMove(guide, e)}
                onPointerUp={(e) => handlePointerUp(guide, e)}
                onPointerCancel={handlePointerCancel}
                onContextMenu={(e) => handleContextMenu(guide, e)}
              />
              {isHover && (
                <>
                  <circle cx={midX} cy={midY} r={4} fill={color} opacity={0.7} />
                  <text x={midX + 6} y={midY + 4} fontSize={10} fill="var(--color-text-primary)">
                    {guide.position}
                    {guide.locked ? ' (locked)' : ''}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {perspectivePoints && (
        <PerspectiveGuideOverlay
          camera={{ zoom, pan, cameraRotation }}
          left={perspectivePoints.left}
          right={perspectivePoints.right}
          onMovePoint={movePerspectivePoint}
        />
      )}
      {ctxGuide && contextMenu && (
        <GuideContextMenu
          anchor={contextMenu.anchor}
          guideId={contextMenu.guideId}
          isLocked={ctxGuide.locked ?? false}
          perspectiveGuideVisible={perspectivePoints !== null}
          onToggleLock={onToggleLock}
          onTogglePerspectiveGuide={togglePerspectiveGuide}
          onRemove={onRemoveGuide}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
