/**
 * SVG `<image>` conversion — the one place a declarative SVG attribute can
 * name a decoded raster resource. Remote and non-raster hrefs are refused by
 * `resourcePolicy`; the bytes an inline data URL carries are inspected and
 * charged against the parse's cumulative decode budget before they become a
 * scene fill the renderer will decode.
 */
import { type SceneNode, makeShapeNode } from '@varve/scene';
import {
  admitSvgRasterSource,
  resolveSvgImageHref,
  type SvgConversionOptions,
} from './resourcePolicy';
import { composeTransforms, composeWithOffset, type ParsedElement, svgLayerName } from './shared';

export function convertImage(
  el: ParsedElement,
  transforms: string[],
  opts: SvgConversionOptions,
  unsupported: string[],
): { node: SceneNode; warnings: string[] } | null {
  const x = parseFloat(el.attrs.x ?? '0') * opts.scale;
  const y = parseFloat(el.attrs.y ?? '0') * opts.scale;
  const w = parseFloat(el.attrs.width ?? '100') * opts.scale;
  const h = parseFloat(el.attrs.height ?? '100') * opts.scale;
  const decision = resolveSvgImageHref(el.attrs.href ?? el.attrs['xlink:href'] ?? '');
  if (!decision.allowed) {
    // Dropping the node beats leaving an invisible placeholder the user
    // cannot explain. The report names what went missing and why.
    unsupported.push(decision.feature);
    return null;
  }
  const href = decision.href;
  const admission = admitSvgRasterSource(href, opts.rasterBudget);
  if (admission !== 'allowed') {
    unsupported.push(
      admission === 'over-budget'
        ? 'SVG embedded raster pixel budget exceeded'
        : 'SVG image with an invalid or unsupported raster payload',
    );
    return null;
  }
  const transform = composeTransforms(transforms);

  const node: SceneNode = {
    ...makeShapeNode(
      '',
      { kind: 'rect', x: 0, y: 0, w, h },
      {
        name: svgLayerName(el, 'Image'),
        transform: composeWithOffset(transform, x, y),
        fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
      },
    ),
    fills: [
      {
        type: 'image',
        image: { src: href, fit: 'fill', x: 0, y: 0, scale: 1 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
  };
  return { node, warnings: [] };
}
