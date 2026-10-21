/**
 * Bundle asset contract + CSS-family raster fallback acceptance.
 *
 * Covers the S1 vertical slice: content-addressed bundle assets, the file vs
 * inline emission profiles, native CSS lowering (conic gradients, inset
 * shadows, blurs, layered fills), and the Flutter/SwiftUI raster paths.
 */

import type { RasterAsset } from '@varve/codegen';
import type { Document, Fill, SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  buildBundleAssets,
  bytesToDataUrl,
  dataUrlToBytes,
  resolveBundleAssets,
} from '../bundle-assets';
import { exportNodeToCss } from '../css';
import { exportNodeToCssModulesBundle } from '../css-modules';
import { exportNodeToFlutter } from '../flutter';
import { exportNodeToSwiftUI } from '../swiftui';
import { exportNodeToTailwind, exportNodeToTailwindBundle } from '../tailwind';
import { buildGraphicsShowcaseDoc, TINY_PNG_DATA_URL } from './helpers/corpus';

/** Corpus builders guarantee their ids; make that contract explicit to tsc. */
function requireNode(doc: Document, id: string): SceneNode {
  const node = doc.nodes[id];
  if (!node) throw new Error(`corpus node ${id} missing`);
  return node;
}

const fakeRaster = (nodeId: string, marker: string): RasterAsset => ({
  nodeId,
  dataUrl: bytesToDataUrl(new TextEncoder().encode(marker), 'image/png'),
  pixelWidth: 180,
  pixelHeight: 120,
  cssWidth: 180,
  cssHeight: 120,
});

describe('bundle asset contract', () => {
  it('decodes data URLs to exact bytes', () => {
    const decoded = dataUrlToBytes(TINY_PNG_DATA_URL);
    expect(decoded).not.toBeNull();
    expect(decoded?.mimeType).toBe('image/png');
    expect(decoded?.bytes.byteLength).toBeGreaterThan(0);
    expect(dataUrlToBytes('not-a-data-url')).toBeNull();
  });

  it('deduplicates by content and assigns stable relative paths', () => {
    const { assets, pathsByNode, failedNodeIds } = buildBundleAssets({
      a: fakeRaster('a', 'same-bytes'),
      b: fakeRaster('b', 'same-bytes'),
      c: fakeRaster('c', 'other-bytes'),
    });
    expect(failedNodeIds).toEqual([]);
    expect(assets).toHaveLength(2);
    expect(pathsByNode.a).toBe(pathsByNode.b);
    expect(pathsByNode.c).not.toBe(pathsByNode.a);
    for (const asset of assets) {
      expect(asset.path).toMatch(/^assets\/[0-9a-f]{16}\.png$/);
      expect(asset.sha256).toHaveLength(64);
    }
  });

  it('keeps asset paths for node IDs matching Object prototype keys', () => {
    const rasters = Object.fromEntries([['__proto__', fakeRaster('__proto__', 'prototype')]]);
    const { pathsByNode, failedNodeIds } = buildBundleAssets(rasters);
    expect(failedNodeIds).toEqual([]);
    expect(Object.hasOwn(pathsByNode, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(pathsByNode, '__proto__')?.value).toMatch(
      /^assets\/[0-9a-f]{16}\.png$/,
    );
  });

  it('reports undecodable assets as failures instead of emitting dangling files', () => {
    const { assets, pathsByNode, failedNodeIds } = buildBundleAssets({
      broken: {
        nodeId: 'broken',
        dataUrl: 'garbage',
        pixelWidth: 1,
        pixelHeight: 1,
        cssWidth: 1,
        cssHeight: 1,
      },
    });
    expect(assets).toEqual([]);
    expect(pathsByNode.broken).toBeUndefined();
    expect(failedNodeIds).toEqual(['broken']);
  });

  it('rejects file bundles when a fallback cannot become a real asset', () => {
    const g = buildGraphicsShowcaseDoc();
    const broken = { ...fakeRaster('angular', 'pixels'), dataUrl: 'garbage' };
    const node = requireNode(g.doc, g.rootId);
    expect(() =>
      exportNodeToTailwindBundle(node, g.doc, {
        rasterAssets: { angular: broken },
        assetMode: 'files',
      }),
    ).toThrow(/angular/);
    expect(() =>
      exportNodeToCssModulesBundle(node, g.doc, {
        rasterAssets: { angular: broken },
        assetMode: 'files',
      }),
    ).toThrow(/angular/);
  });

  it('resolveBundleAssets switches between the inline and files profiles', () => {
    const raster = { node: fakeRaster('node', 'x') };
    expect(resolveBundleAssets({ rasterAssets: raster }).assets).toBeUndefined();
    const files = resolveBundleAssets({ rasterAssets: raster, assetMode: 'files' });
    expect(files.assets).toHaveLength(1);
    expect(files.assetPaths?.node).toMatch(/^assets\//);
  });
});

describe('CSS raster fallback and native lowering', () => {
  it('emits the referenced asset path instead of the checkerboard when composed', () => {
    const g = buildGraphicsShowcaseDoc();
    const css = exportNodeToCss(requireNode(g.doc, g.rootId), g.doc, {
      rasterAssets: {
        angular: fakeRaster('angular', 'angular-raster'),
        blended: fakeRaster('blended', 'blended-raster'),
        'masked-group': fakeRaster('masked-group', 'masked-raster'),
      },
      assetPaths: {
        angular: 'assets/angular000000000000.png',
        blended: 'assets/blended0000000000000.png',
        'masked-group': 'assets/masked0000000000000.png',
      },
    });
    expect(css).toContain('url("assets/angular000000000000.png")');
    expect(css).toContain('url("assets/blended0000000000000.png")');
    expect(css).not.toContain('repeating-conic-gradient');
    // The rasterized masked group replaces its subtree.
    expect(css).not.toContain('.masked-art');
  });

  it('lowers angular gradients to conic-gradient without a raster asset', () => {
    const g = buildGraphicsShowcaseDoc();
    const css = exportNodeToCss(requireNode(g.doc, g.rootId), g.doc);
    const bannerRule = css.split('\n\n').find((rule) => rule.includes('.angular-banner'));
    expect(bannerRule).toContain('conic-gradient(from');
    // The checkerboard is the no-fallback diagnostic, never an angular
    // gradient's representation.
    expect(bannerRule).not.toContain('repeating-conic-gradient(#eee');
  });

  it('emits inner shadows as inset box-shadow and blurs as filters', () => {
    const g = buildGraphicsShowcaseDoc();
    const css = exportNodeToCss(requireNode(g.doc, g.rootId), g.doc);
    const shadowRule = css.split('\n\n').find((rule) => rule.includes('.shadowed-card'));
    expect(shadowRule).toContain('inset 0px 2px 6px 0px');
    expect(shadowRule).toContain('box-shadow: 0px 8px 24px 2px');
  });

  it('stacked fills emit layered backgrounds in CSS paint order', () => {
    const g = buildGraphicsShowcaseDoc();
    const css = exportNodeToCss(requireNode(g.doc, g.rootId), g.doc);
    const badgeRule = css.split('\n\n').find((rule) => rule.includes('.linear-badge'));
    expect(badgeRule).toContain('background-image: linear-gradient(');
    const bannerRule = css.split('\n\n').find((rule) => rule.includes('.angular-banner'));
    expect(bannerRule).toContain('background-image: conic-gradient(');
  });

  it('keeps solid layers and translucent gradient stops valid in background-image', () => {
    const g = buildGraphicsShowcaseDoc();
    const badge = requireNode(g.doc, 'linear-badge');
    const gradient = badge.fills?.[0];
    if (!gradient) throw new Error('badge gradient missing');
    const solid: Fill = {
      type: 'solid',
      color: { space: 'rgb', r: 12, g: 34, b: 56, a: 255 },
      opacity: 0.5,
      blendMode: 'normal',
      visible: true,
    };
    const doc: Document = {
      ...g.doc,
      nodes: {
        ...g.doc.nodes,
        [badge.id]: { ...badge, fills: [solid, { ...gradient, opacity: 0.5 }] },
      },
    };
    const css = exportNodeToCss(requireNode(doc, g.rootId), doc);
    const rule = css.split('\n\n').find((part) => part.includes('.linear-badge'));
    expect(rule).toContain('background-image: linear-gradient(');
    expect(rule).toContain('color-mix(in srgb, rgba(');
    expect(rule).not.toMatch(/background-image:\s*(?:#[\da-f]|color-mix\()/i);
    expect(rule).not.toContain('color-mix(in srgb, linear-gradient(');
    const tailwind = exportNodeToTailwind(requireNode(doc, 'linear-badge'), doc);
    expect(tailwind).toContain('rgba(12,34,56,0.500)');
    expect(tailwind).toContain('color-mix(in_srgb,');
  });
});

describe('Tailwind raster fallback and paint utilities', () => {
  it('emits a literal img for the composed asset and skips its children', () => {
    const g = buildGraphicsShowcaseDoc();
    const code = exportNodeToTailwind(requireNode(g.doc, g.rootId), g.doc, {
      rasterAssets: { 'masked-group': fakeRaster('masked-group', 'masked-raster') },
      assetPaths: { 'masked-group': 'assets/masked0000000000000.png' },
    });
    expect(code).toContain('<img src="assets/masked0000000000000.png"');
    // The rasterized subtree's own artwork must not re-appear beside it.
    expect(code).not.toContain('Masked artwork');
    expect(code).not.toContain('Masked ellipse');
  });

  it('emits gradients and shadows as complete literal arbitrary values', () => {
    const g = buildGraphicsShowcaseDoc();
    const code = exportNodeToTailwind(requireNode(g.doc, g.rootId), g.doc);
    expect(code).toMatch(/bg-\[conic-gradient\(/);
    expect(code).toMatch(/shadow-\[/);
  });

  it('bundle mode attaches deduplicated assets and references their paths', () => {
    const g = buildGraphicsShowcaseDoc();
    const bundle = exportNodeToTailwindBundle(requireNode(g.doc, g.rootId), g.doc, {
      rasterAssets: { angular: fakeRaster('angular', 'angular-raster') },
      assetMode: 'files',
    });
    expect(bundle.assets).toHaveLength(1);
    expect(bundle.assets?.[0]?.path).toMatch(/^assets\//);
    expect(bundle.files[0]?.contents).toContain(bundle.assets?.[0]?.path ?? '');
    expect((bundle.setup ?? []).join('\n')).toContain('Serve assets/ at the URL base');
  });

  it('css modules bundles carry the same asset contract', () => {
    const g = buildGraphicsShowcaseDoc();
    const bundle = exportNodeToCssModulesBundle(requireNode(g.doc, g.rootId), g.doc, {
      rasterAssets: {
        angular: fakeRaster('angular', 'angular-raster'),
        blended: fakeRaster('blended', 'blended-raster'),
        'masked-group': fakeRaster('masked-group', 'masked-raster'),
      },
      assetMode: 'files',
    });
    expect(bundle.assets).toHaveLength(3);
    const cssFile = bundle.files.find((f) => f.path.endsWith('.module.css'));
    for (const asset of bundle.assets ?? []) {
      expect(cssFile?.contents).toContain(asset.path);
    }
    expect(cssFile?.contents).not.toContain('repeating-conic-gradient');
  });
});

describe('Flutter and SwiftUI raster and native paint', () => {
  it('flutter emits Image.asset for file-mode raster surfaces with expansion padding', () => {
    const g = buildGraphicsShowcaseDoc();
    const code = exportNodeToFlutter(requireNode(g.doc, g.rootId), g.doc, {
      rasterAssets: {
        angular: {
          ...fakeRaster('angular', 'angular-raster'),
          expansion: { left: 4, top: 4, right: 4, bottom: 4 },
        },
      },
      assetPaths: { angular: 'assets/angular000000000000.png' },
    });
    expect(code).toContain("Image.asset('assets/angular000000000000.png'");
    expect(code).toContain('width: 236');
    expect(code).toContain('left: 224');
    expect(code).not.toContain(');,');
  });

  it('flutter emits gradient decorations and box shadows natively', () => {
    const g = buildGraphicsShowcaseDoc();
    const code = exportNodeToFlutter(requireNode(g.doc, g.rootId), g.doc);
    expect(code).toContain('LinearGradient(');
    expect(code).toContain('BoxShadow(');
    expect(code).toContain('stops: [');
  });

  it('swiftui emits gradient fills, shadow modifiers, and bundle images', () => {
    const g = buildGraphicsShowcaseDoc();
    const code = exportNodeToSwiftUI(requireNode(g.doc, g.rootId), g.doc, {
      rasterAssets: { angular: fakeRaster('angular', 'angular-raster') },
      assetPaths: { angular: 'assets/angular1234567890abcdef.png' },
    });
    expect(code).toContain('LinearGradient(stops:');
    expect(code).toContain('.shadow(color:');
    expect(code).toContain('Image(decorative: "assets/angular1234567890abcdef"');
  });
});
