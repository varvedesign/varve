import { addChild, addNode, createDocument, makeGroupNode, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { sourceLocalBounds } from './objectRepeatGeometry';
import { nodeWorldTransform } from './world';

describe('sourceLocalBounds', () => {
  it('anchors repeat controls to source artwork away from the group origin', () => {
    let document = createDocument();
    document = addNode(document, makeGroupNode('group'));
    document = addChild(
      document,
      'group',
      makeShapeNode(
        'source',
        { kind: 'rect', x: 0, y: 0, w: 40, h: 30 },
        { transform: [1, 0, 0, 1, 500, 200] },
      ),
    );
    const group = document.nodes.group;
    if (group?.kind !== 'group') throw new Error('group fixture was not created');

    expect(sourceLocalBounds(document, group, (id) => nodeWorldTransform(document, id))).toEqual({
      x: 500,
      y: 200,
      w: 40,
      h: 30,
    });
  });
});
