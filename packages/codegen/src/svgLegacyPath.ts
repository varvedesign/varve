import type { SceneNode } from '@varve/scene';
import { pathToData } from './svgStrokeGeometry';

export function legacyPathToPathShape(
  node: Extract<SceneNode, { kind: 'path' }>,
): Extract<import('@varve/engine').Shape, { kind: 'path' }> {
  return {
    kind: 'path',
    points: node.points,
    closed: node.closed,
    tolerance: 1,
  };
}

export function pathNodeClipElement(node: Extract<SceneNode, { kind: 'path' }>): string | null {
  const data = pathToData(legacyPathToPathShape(node));
  return data ? `<path d="${data}" />` : null;
}

export function pathNodeBoundCorners(
  node: Extract<SceneNode, { kind: 'path' }>,
): Array<readonly [number, number]> {
  const samples: Array<[number, number]> = [];
  for (const point of node.points) {
    samples.push([point.x, point.y]);
    if (point.handleIn) samples.push([point.x + point.handleIn[0], point.y + point.handleIn[1]]);
    if (point.handleOut) samples.push([point.x + point.handleOut[0], point.y + point.handleOut[1]]);
  }
  if (samples.length === 0) {
    return [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
  }
  const halfStroke = Math.max(
    0,
    ...(node.strokes ?? []).map((stroke) =>
      stroke.visible === false ? 0 : (stroke.weight ?? 0) / 2,
    ),
  );
  const xs = samples.map((sample) => sample[0]);
  const ys = samples.map((sample) => sample[1]);
  const x = Math.min(...xs) - halfStroke;
  const y = Math.min(...ys) - halfStroke;
  const maxX = Math.max(...xs) + halfStroke;
  const maxY = Math.max(...ys) + halfStroke;
  return [
    [x, y],
    [maxX, y],
    [maxX, maxY],
    [x, maxY],
  ];
}
