/**
 * Prototype screen renderer — the frame's real content (rendered through the
 * canonical scene→engine→IR pipeline) with active regions derived from the
 * *same* evaluated geometry as that render.
 *
 * Two contracts this file exists to hold:
 *
 * 1. **Pixels and active regions agree.** Both come from
 *    `resolvePrototypeHotspots`, which maps scene geometry through the raster
 *    the engine reported (`sourceBounds`, `scaleFactor`, `outputWidth`,
 *    `outputHeight`). Nothing here re-derives a position from a node's raw
 *    `transform[4..5]`.
 *
 * 2. **Activation is a completed gesture, not a `pointerdown`.** Pointer input
 *    is resolved at the container; a movement beyond the drag threshold, a
 *    `pointercancel` (which is what a scroll or system gesture produces), or a
 *    lost capture suppresses the activation. Keyboard activation travels the
 *    native button path so Enter/Space fire exactly once.
 */

import type { PrototypeHotspot, ScreenFrameMapping, ScreenRasterInfo } from '@varve/prototype';
import { hitTestPrototypeHotspots, resolvePrototypeHotspots } from '@varve/prototype';
import type { NodeId } from '@varve/scene';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HotspotTransitionOverride } from '../../motion/smartAnimateBridge';
import { renderScreenRaster } from './screenRender';

/**
 * Movement in CSS pixels that turns a press into a drag. CSS pixels, not world
 * units and not scaled by zoom: this models the user's hand, which does not
 * rescale with the camera.
 */
const DRAG_THRESHOLD_CSS_PX = 6;

export interface PrototypeScreenViewProps {
  document: import('@varve/scene').Document;
  screenId: string;
  overlayStack: string[];
  onEvent: (event: { type: 'click'; nodeId: NodeId; screenId: string }) => void;
  /**
   * Per-hotspot overrides during Smart Animate transitions. Values are in
   * scene space and are mapped through the same screen mapping as everything
   * else, so an animating layer and its active region move together.
   */
  hotspotOverrides?: Record<NodeId, HotspotTransitionOverride>;
  /** Draw the active region boxes. Audience hints; off by default. */
  showHotspots?: boolean;
}

export function PrototypeScreenView({
  document,
  screenId,
  overlayStack,
  onEvent,
  hotspotOverrides,
  showHotspots = false,
}: PrototypeScreenViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const screen = document.nodes[screenId];
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [raster, setRaster] = useState<ScreenRasterInfo | null>(null);

  const frameW = screen?.kind === 'frame' ? (screen.w ?? 375) : 375;
  const frameH = screen?.kind === 'frame' ? (screen.h ?? 812) : 812;

  // Render the screen's real content once per screen/document/size and keep
  // the engine's reported raster geometry. In environments without a raster
  // path the raster stays null and the mapping falls back to the screen's own
  // bounds, which is exact for an image-less surface.
  useEffect(() => {
    let cancelled = false;
    setImageUrl(null);
    setRaster(null);
    void renderScreenRaster(document, screenId, frameW, frameH).then((result) => {
      if (cancelled) return;
      setImageUrl(result.dataUrl);
      setRaster(result.raster);
    });
    return () => {
      cancelled = true;
    };
  }, [document, screenId, frameW, frameH]);

  const overlayKey = overlayStack.join('|');
  const resolved = useMemo(
    () =>
      resolvePrototypeHotspots({
        document,
        screenId,
        overlayStack,
        frameWidth: frameW,
        frameHeight: frameH,
        raster,
      }),
    [document, screenId, overlayKey, frameW, frameH, raster],
  );

  /** Regions in paint order (document order), for DOM order and tab order. */
  const paintOrdered = useMemo(
    () => [...resolved.hotspots].sort((a, b) => a.paintOrder - b.paintOrder),
    [resolved.hotspots],
  );

  const gestureRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    startNodeId: NodeId | null;
    suppressed: boolean;
  }>({ pointerId: null, startX: 0, startY: 0, startNodeId: null, suppressed: false });

  const activate = useCallback(
    (nodeId: NodeId) => {
      onEvent({ type: 'click', nodeId, screenId });
    },
    [onEvent, screenId],
  );

  const pointFromEvent = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  const hitAt = useCallback(
    (clientX: number, clientY: number): NodeId | null => {
      const hit = hitTestPrototypeHotspots(
        resolved.hotspots,
        pointFromEvent(clientX, clientY),
        resolved.mapping,
        resolved.raster,
      );
      return hit?.nodeId ?? null;
    },
    [pointFromEvent, resolved],
  );

  /**
   * Pointer gestures complete here rather than on a DOM `click`.
   *
   * Keeping the whole gesture on the pointer stream means the viewer never
   * depends on a synthesised click: a scroll that takes over the gesture, a
   * cancelled pointer, or a programmatic click cannot navigate. Activation
   * requires the press to start and finish on the *same* region, so a press
   * that drags off one region and releases over another does nothing.
   */
  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      gestureRef.current = {
        pointerId: event.pointerId ?? 0,
        startX: event.clientX,
        startY: event.clientY,
        startNodeId: hitAt(event.clientX, event.clientY),
        suppressed: false,
      };
    },
    [hitAt],
  );

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    const gesture = gestureRef.current;
    if (gesture.pointerId === null) return;
    if (gesture.pointerId !== (event.pointerId ?? 0)) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_CSS_PX) gesture.suppressed = true;
  }, []);

  const handlePointerUp = useCallback(
    (event: React.PointerEvent) => {
      const gesture = gestureRef.current;
      const startNodeId = gesture.startNodeId;
      const matchesPointer = gesture.pointerId === (event.pointerId ?? 0);
      gestureRef.current = {
        pointerId: null,
        startX: 0,
        startY: 0,
        startNodeId: null,
        suppressed: false,
      };
      if (!matchesPointer || gesture.suppressed || !startNodeId) return;
      if (hitAt(event.clientX, event.clientY) !== startNodeId) return;
      activate(startNodeId);
    },
    [activate, hitAt],
  );

  const handlePointerCancel = useCallback(() => {
    gestureRef.current = {
      pointerId: null,
      startX: 0,
      startY: 0,
      startNodeId: null,
      suppressed: true,
    };
  }, []);

  const handleHotspotKeyActivate = useCallback(
    (nodeId: NodeId) => {
      activate(nodeId);
    },
    [activate],
  );

  if (screen?.kind !== 'frame') {
    return <div className="prototype-screen-view__empty">Screen not found</div>;
  }

  return (
    <section
      ref={containerRef}
      className="prototype-screen-view"
      style={{ width: frameW, height: frameH }}
      aria-label={`Prototype screen: ${screen.name}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      data-prototype-screen={screenId}
      data-prototype-letterboxed={resolved.mapping.letterboxed ? 'true' : 'false'}
    >
      {imageUrl && (
        <img
          className="prototype-screen-view__image"
          src={imageUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      )}
      <span className="prototype-screen-view__label">{screen.name}</span>
      <div className="prototype-screen-view__hotspots">
        {paintOrdered.map((hotspot) => (
          <HotspotControl
            key={hotspot.nodeId}
            hotspot={hotspot}
            mapping={resolved.mapping}
            raster={resolved.raster}
            override={hotspotOverrides?.[hotspot.nodeId]}
            showHotspots={showHotspots}
            onActivate={handleHotspotKeyActivate}
          />
        ))}
      </div>
    </section>
  );
}

interface HotspotControlProps {
  hotspot: PrototypeHotspot;
  mapping: ScreenFrameMapping;
  raster: ScreenRasterInfo;
  override?: HotspotTransitionOverride;
  showHotspots: boolean;
  onActivate: (nodeId: NodeId) => void;
}

/**
 * One active region as a real button.
 *
 * `pointer-events: none` (see the stylesheet) keeps the *container* the sole
 * pointer authority, so a rotated or clipped region is resolved exactly rather
 * than by the browser against a loose axis-aligned box. The button still takes
 * focus and still fires on Enter/Space, which is the keyboard and assistive
 * technology path.
 */
function HotspotControl({
  hotspot,
  mapping,
  raster,
  override,
  showHotspots,
  onActivate,
}: HotspotControlProps) {
  const box = override
    ? {
        x: mapping.offsetX + (override.left - raster.sourceBounds.x) * mapping.scale,
        y: mapping.offsetY + (override.top - raster.sourceBounds.y) * mapping.scale,
        w: override.width * mapping.scale,
        h: override.height * mapping.scale,
      }
    : hotspot.rect;

  return (
    <button
      type="button"
      className={
        showHotspots
          ? 'prototype-screen-view__hotspot prototype-screen-view__hotspot--visible'
          : 'prototype-screen-view__hotspot'
      }
      style={{
        left: box.x,
        top: box.y,
        width: Math.max(0, box.w),
        height: Math.max(0, box.h),
        opacity: override ? override.opacity : 1,
      }}
      data-prototype-hotspot=""
      data-node-id={hotspot.nodeId}
      data-interaction-ids={hotspot.interactionIds.join(',')}
      aria-label={hotspot.nodeName}
      onClick={(event) => {
        // Reached by keyboard and assistive-technology activation only: a real
        // pointer press targets the container, which owns gesture resolution.
        // `detail > 0` is a pointer-generated click; ignoring it means a
        // stylesheet that re-enables pointer events on the control cannot
        // double-activate the region.
        if (event.detail > 0) return;
        event.stopPropagation();
        onActivate(hotspot.nodeId);
      }}
    />
  );
}
