import type { SceneNode } from '@varve/scene';
import { getParent } from '@varve/scene';
import { useMemo } from 'react';
import { useEditor } from '../../../context';
import { InspectorFieldGroup } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { commonValue, isMixed } from '../selection/selectionState';
import './GridPlacementFields.css';

type GridPlacementAxis = 'columns' | 'rows';

function axisPlacement(
  node: SceneNode,
  parent: SceneNode | undefined,
  axis: GridPlacementAxis,
): { start?: number; end?: number; span?: number } {
  const placement = node.gridPlacement;
  if (!placement) return {};
  const startKey = axis === 'columns' ? 'gridColumnStart' : 'gridRowStart';
  const endKey = axis === 'columns' ? 'gridColumnEnd' : 'gridRowEnd';
  const idKey = axis === 'columns' ? 'gridColumnStartTrackId' : 'gridRowStartTrackId';
  const spanKey = axis === 'columns' ? 'gridColumnSpan' : 'gridRowSpan';
  const tracks =
    parent?.kind === 'frame'
      ? axis === 'columns'
        ? parent.layoutStyle?.gridColumnTracks
        : parent.layoutStyle?.gridRowTracks
      : undefined;
  const identityIndex = placement[idKey]
    ? (tracks?.findIndex((track) => track.id === placement[idKey]) ?? -1)
    : -1;
  const start = identityIndex >= 0 ? identityIndex + 1 : placement[startKey];
  const span =
    placement[spanKey] ??
    (start != null && placement[endKey] != null
      ? Math.max(1, placement[endKey]! - start)
      : undefined);
  const end = start != null && span != null ? start + span : placement[endKey];
  return { start, end, span };
}

/**
 * Grid item placement is a child capability, not a property of every frame.
 * Keep the fields in one small, reusable surface so frame children and other
 * grid-capable nodes get the same labels, value semantics, and geometry.
 */
export function GridPlacementFields({ nodes }: { nodes: SceneNode[] }) {
  const { state, setSelectedGridPlacement } = useEditor();
  const parent = useMemo(() => {
    const parentIds = nodes.map((node) => getParent(state.document, node.id));
    if (parentIds.length === 0 || parentIds.some((id) => id !== parentIds[0])) return undefined;
    const candidate = parentIds[0] ? state.document.nodes[parentIds[0]] : undefined;
    return candidate?.kind === 'frame' ? candidate : undefined;
  }, [nodes, state.document]);

  const hasGridParent = parent?.layoutStyle?.mode === 'grid';
  const hasAuthoredPlacement = nodes.some((node) => node.gridPlacement != null);
  if (!hasGridParent && !hasAuthoredPlacement) return null;

  const gridColumnStart = commonValue(
    nodes,
    (node) => axisPlacement(node, parent, 'columns').start,
  );
  const gridColumnEnd = commonValue(nodes, (node) => axisPlacement(node, parent, 'columns').end);
  const gridRowStart = commonValue(nodes, (node) => axisPlacement(node, parent, 'rows').start);
  const gridRowEnd = commonValue(nodes, (node) => axisPlacement(node, parent, 'rows').end);

  const setAxisStart = (axis: GridPlacementAxis, value: number) => {
    setSelectedGridPlacement((current, node) => {
      const resolved = axisPlacement(node, parent, axis);
      const start = value > 0 ? value : undefined;
      const span = start == null ? undefined : (resolved.span ?? 1);
      const tracks =
        parent?.kind === 'frame'
          ? axis === 'columns'
            ? parent.layoutStyle?.gridColumnTracks
            : parent.layoutStyle?.gridRowTracks
          : undefined;
      const trackId = start == null ? undefined : tracks?.[start - 1]?.id;
      const keys =
        axis === 'columns'
          ? {
              startKey: 'gridColumnStart',
              endKey: 'gridColumnEnd',
              idKey: 'gridColumnStartTrackId',
              spanKey: 'gridColumnSpan',
            }
          : {
              startKey: 'gridRowStart',
              endKey: 'gridRowEnd',
              idKey: 'gridRowStartTrackId',
              spanKey: 'gridRowSpan',
            };
      return {
        ...current,
        [keys.startKey]: start,
        [keys.endKey]: undefined,
        [keys.idKey]: trackId,
        [keys.spanKey]: span,
      };
    });
  };

  const setAxisEnd = (axis: GridPlacementAxis, value: number) => {
    setSelectedGridPlacement((current, node) => {
      const resolved = axisPlacement(node, parent, axis);
      const start = resolved.start ?? 1;
      const end = value > 0 ? Math.max(value, start + 1) : undefined;
      const span = end == null ? undefined : end - start;
      return axis === 'columns'
        ? { ...current, gridColumnEnd: end, gridColumnSpan: span }
        : { ...current, gridRowEnd: end, gridRowSpan: span };
    });
  };

  const draftKey = nodes
    .map((node) => node.id)
    .sort()
    .join(',');

  return (
    <div className="insp-grid-placement">
      <div className="insp-grid-placement__title">Grid placement</div>
      {!hasGridParent && hasAuthoredPlacement && (
        <p className="insp-panel__color-mode-note" role="note">
          This placement is stored on the layer and will apply when it is inside a grid frame.
        </p>
      )}
      <InspectorFieldGroup columns={2} className="insp-grid-placement__fields">
        <NumberField
          label="Column start"
          value={isMixed(gridColumnStart) ? 0 : (gridColumnStart ?? 0)}
          mixed={isMixed(gridColumnStart)}
          min={0}
          labelWrap
          draftKey={`${draftKey}:grid-column-start`}
          onChange={(value) => setAxisStart('columns', value)}
        />
        <NumberField
          label="Column end"
          value={isMixed(gridColumnEnd) ? 0 : (gridColumnEnd ?? 0)}
          mixed={isMixed(gridColumnEnd)}
          min={0}
          labelWrap
          draftKey={`${draftKey}:grid-column-end`}
          onChange={(value) => setAxisEnd('columns', value)}
        />
        <NumberField
          label="Row start"
          value={isMixed(gridRowStart) ? 0 : (gridRowStart ?? 0)}
          mixed={isMixed(gridRowStart)}
          min={0}
          labelWrap
          draftKey={`${draftKey}:grid-row-start`}
          onChange={(value) => setAxisStart('rows', value)}
        />
        <NumberField
          label="Row end"
          value={isMixed(gridRowEnd) ? 0 : (gridRowEnd ?? 0)}
          mixed={isMixed(gridRowEnd)}
          min={0}
          labelWrap
          draftKey={`${draftKey}:grid-row-end`}
          onChange={(value) => setAxisEnd('rows', value)}
        />
      </InspectorFieldGroup>
    </div>
  );
}
