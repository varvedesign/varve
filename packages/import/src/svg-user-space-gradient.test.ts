import { applyAffine } from '@varve/engine';
import { linearGradientHandles, radialGradientHandles } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { parseSvg } from './svg';

const STOPS = '<stop offset="0" stop-color="black"/><stop offset="1" stop-color="white"/>';

function importedShape(source: string) {
  const result = parseSvg(source);
  const node = Object.values(result.document.nodes).find((candidate) => candidate.kind === 'shape');
  const gradient = node?.fills?.[0]?.gradient;
  if (!node || !gradient) throw new Error('Expected an imported gradient-filled shape');
  return { result, node, gradient };
}

describe('SVG user-space gradients after geometry rebasing (Graphite #2524)', () => {
  it('keeps numeric linear endpoints in the positioned rectangle local space', () => {
    const { node, gradient } = importedShape(
      `<svg><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="200" y1="140" x2="300" y2="140">${STOPS}</linearGradient></defs><rect x="200" y="100" width="100" height="80" fill="url(#g)"/></svg>`,
    );
    const handles = linearGradientHandles(gradient, { x: 0, y: 0, w: 100, h: 80 });
    expect(handles.start).toEqual([0, 40]);
    expect(handles.end).toEqual([100, 40]);
    expect(applyAffine(node.transform, handles.start)).toEqual([200, 140]);
  });

  it('keeps radial centres and axes relative to a centred circle primitive', () => {
    const { gradient } = importedShape(
      `<svg><defs><radialGradient id="g" gradientUnits="userSpaceOnUse" cx="240" cy="180" r="87">${STOPS}</radialGradient></defs><circle cx="240" cy="180" r="87" fill="url(#g)"/></svg>`,
    );
    const handles = radialGradientHandles(gradient, { x: -87, y: -87, w: 174, h: 174 });
    expect(handles.center).toEqual([0, 0]);
    expect(handles.uAxisEnd).toEqual([87, 0]);
    expect(handles.vAxisEnd).toEqual([0, 87]);
  });

  it('does not undo authored transforms when correcting the local origin', () => {
    const { node, gradient } = importedShape(
      `<svg><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="200" y1="140" x2="300" y2="140" gradientTransform="translate(10 5)">${STOPS}</linearGradient></defs><rect x="200" y="100" width="100" height="80" transform="matrix(2 .5 -.25 3 20 30)" fill="url(#g)"/></svg>`,
    );
    const handles = linearGradientHandles(gradient, { x: 0, y: 0, w: 100, h: 80 });
    expect(handles.start).toEqual([10, 45]);
    expect(applyAffine(node.transform, handles.start)).toEqual([403.75, 570]);
  });

  it('leaves path coordinates and their gradient in the same user space', () => {
    const { gradient } = importedShape(
      `<svg><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="200" y1="140" x2="300" y2="140">${STOPS}</linearGradient></defs><path d="M200 100h100v80h-100z" fill="url(#g)"/></svg>`,
    );
    const handles = linearGradientHandles(gradient, { x: 200, y: 100, w: 100, h: 80 });
    expect(handles.start).toEqual([200, 140]);
    expect(handles.end).toEqual([300, 140]);
  });

  it('leaves objectBoundingBox fills attached to the rebased target bounds', () => {
    const { gradient } = importedShape(
      `<svg><defs><linearGradient id="g">${STOPS}</linearGradient></defs><rect x="200" y="100" width="100" height="80" fill="url(#g)"/></svg>`,
    );
    const handles = linearGradientHandles(gradient, { x: 0, y: 0, w: 100, h: 80 });
    expect(handles.start).toEqual([0, 0]);
    expect(handles.end).toEqual([100, 0]);
  });

  it.each([
    ['ellipse', '<ellipse cx="200" cy="100" rx="100" ry="40" fill="url(#g)"/>', [0, 0]],
    ['polyline', '<polyline points="200,100 300,180 200,180" fill="url(#g)"/>', [0, 0]],
    ['polygon', '<polygon points="200,100 300,100 300,180 200,180" fill="url(#g)"/>', [-50, -40]],
    ['line', '<line x1="200" y1="100" x2="300" y2="180" fill="url(#g)"/>', [0, 0]],
  ] as const)('rebases the %s field by the same origin as its geometry', (_tag, element, start) => {
    const { gradient } = importedShape(
      `<svg><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="200" y1="100" x2="300" y2="100">${STOPS}</linearGradient></defs>${element}</svg>`,
    );
    const handles = linearGradientHandles(gradient, { x: 0, y: 0, w: 100, h: 80 });
    expect(handles.start).toEqual(start);
    expect(handles.end).toEqual([start[0] + 100, start[1]]);
  });

  it('scales the geometry offset and gradient translation together on import', () => {
    const result = parseSvg(
      `<svg><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="200" y1="140" x2="300" y2="140" gradientTransform="translate(10 5)">${STOPS}</linearGradient></defs><rect x="200" y="100" width="100" height="80" fill="url(#g)"/></svg>`,
      { scale: 2 },
    );
    const gradient = result.document.nodes[result.nodeIds[0]!]!.fills![0]!.gradient!;
    const handles = linearGradientHandles(gradient, { x: 0, y: 0, w: 200, h: 160 });
    expect(handles.start).toEqual([20, 90]);
    expect(handles.end).toEqual([220, 90]);
  });

  it('keeps the local field intact beneath root viewBox and nested group transforms', () => {
    const { result, node, gradient } = importedShape(
      `<svg width="800" height="600" viewBox="100 50 400 300"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="200" y1="140" x2="300" y2="140">${STOPS}</linearGradient></defs><g transform="translate(10 20)"><g transform="scale(2)"><rect x="200" y="100" width="100" height="80" fill="url(#g)"/></g></g></svg>`,
    );
    const handles = linearGradientHandles(gradient, { x: 0, y: 0, w: 100, h: 80 });
    expect(handles.start).toEqual([0, 40]);
    let world = applyAffine(node.transform, handles.start);
    let parent = Object.values(result.document.nodes).find(
      (candidate) => 'children' in candidate && candidate.children.includes(node.id),
    );
    while (parent) {
      world = applyAffine(parent.transform, world);
      const parentId = parent.id;
      parent = Object.values(result.document.nodes).find(
        (candidate) => 'children' in candidate && candidate.children.includes(parentId),
      );
    }
    expect(world).toEqual([620, 500]);
  });

  it('keeps the field local to referenced geometry rather than cancelling a use translation', () => {
    const { node, gradient } = importedShape(
      `<svg><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="200" y1="140" x2="300" y2="140">${STOPS}</linearGradient><rect id="r" x="200" y="100" width="100" height="80" fill="url(#g)"/></defs><use href="#r" x="25" y="30"/></svg>`,
    );
    const handles = linearGradientHandles(gradient, { x: 0, y: 0, w: 100, h: 80 });
    expect(handles.start).toEqual([0, 40]);
    expect(applyAffine(node.transform, handles.start)).toEqual([225, 170]);
  });

  it('retains the existing warning for viewport-dependent user-space percentages', () => {
    const { result } = importedShape(
      `<svg width="400" height="300"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="10%" x2="90%">${STOPS}</linearGradient></defs><rect x="200" y="100" width="100" height="80" fill="url(#g)"/></svg>`,
    );
    expect(result.warnings).toContain(
      'SVG gradient #g uses userSpaceOnUse percentages; the imported field is normalized to the target bounds',
    );
  });

  it('does not need an inverse of a singular authored transform to preserve the local field', () => {
    const { node, gradient } = importedShape(
      `<svg><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="200" y1="140" x2="300" y2="140">${STOPS}</linearGradient></defs><rect x="200" y="100" width="100" height="80" transform="scale(0 1)" fill="url(#g)"/></svg>`,
    );
    const handles = linearGradientHandles(gradient, { x: 0, y: 0, w: 100, h: 80 });
    expect(handles.start).toEqual([0, 40]);
    expect(node.transform).toEqual([0, 0, 0, 1, 0, 100]);
  });

  it('subtracts the geometry origin after an affine gradientTransform, not before it', () => {
    const { gradient } = importedShape(
      `<svg><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="200" y1="140" x2="300" y2="140" gradientTransform="matrix(1 .25 -.5 2 -10 30)">${STOPS}</linearGradient></defs><rect x="200" y="100" width="100" height="80" fill="url(#g)"/></svg>`,
    );
    const handles = linearGradientHandles(gradient, { x: 0, y: 0, w: 100, h: 80 });
    expect(handles.start).toEqual([-80, 260]);
    expect(handles.end).toEqual([20, 285]);
  });
});
