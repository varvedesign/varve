import { renderHook } from '@testing-library/react';
import { createDocument, type Document, makeImageShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { collectAnimatedLayerIds, DEFAULT_FILTER } from './layerFilterTypes';
import { selectMatchingEntryIds } from './layerMatchSelection';
import { flattenTree, useFlatTree } from './useFlatTree';

function fixture(): Document {
  const image = makeImageShapeNode('image', {
    src: 'asset.gif',
    w: 20,
    h: 20,
    imageWidth: 20,
    imageHeight: 20,
  });
  return {
    ...createDocument('animated layers', true),
    rootChildren: ['image'],
    nodes: {
      image: {
        ...image,
        fills: image.fills?.map((fill) =>
          fill.image ? { ...fill, image: { ...fill.image, assetId: 'asset' } } : fill,
        ),
      },
    },
    assets: {
      asset: {
        id: 'asset',
        storage: 'embedded',
        mimeType: 'image/gif',
        dataUrl: 'data:image/gif;base64,R0lGODlh',
        naturalWidth: 20,
        naturalHeight: 20,
        byteLength: 6,
        hash: 'fixture',
        animated: {
          kind: 'gif',
          frameCount: 2,
          durationMs: 200,
          loopCount: 'infinite',
          width: 20,
          height: 20,
          frames: [0, 1].map((index) => ({
            index,
            durationMs: 100,
            x: 0,
            y: 0,
            width: 20,
            height: 20,
            blend: 'source',
            disposal: 'none',
          })),
          decoderVersion: 1,
        },
      },
    },
  };
}

describe('animated Layers filter membership', () => {
  it('includes animated image assets without a timeline in both rows and result selection', () => {
    const doc = fixture();
    const filter = { ...DEFAULT_FILTER, attributes: { animated: true } };
    const animated = collectAnimatedLayerIds(doc);
    const entries = flattenTree(doc, new Set(), filter);
    expect([...animated]).toEqual(['image']);
    expect(entries.map((entry) => entry.node.id)).toEqual(['image']);
    expect(selectMatchingEntryIds(entries, filter, doc, undefined, animated)).toEqual(['image']);
  });

  it.each([true, false])('refreshes animated=%s after only asset metadata changes', (animated) => {
    const doc = fixture();
    const filter = { ...DEFAULT_FILTER, attributes: { animated } };
    const expanded = new Set<string>();
    const { result, rerender } = renderHook(
      ({ document }) => useFlatTree(document, expanded, filter),
      {
        initialProps: { document: doc },
      },
    );
    expect(result.current).toHaveLength(animated ? 1 : 0);
    rerender({
      document: { ...doc, assets: { asset: { ...doc.assets!.asset!, animated: undefined } } },
    });
    expect(result.current).toHaveLength(animated ? 0 : 1);
  });
});
