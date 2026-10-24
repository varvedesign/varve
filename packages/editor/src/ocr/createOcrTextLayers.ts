import type { OcrWord } from '@varve/engine';
import {
  addChild,
  addNode,
  type Document,
  getParent,
  makeTextNode,
  nextNodeId,
} from '@varve/scene';
import { type Affine, multiplyAffine, tryInvertAffine } from '@varve/shared';
import { nodeWorldTransform } from '../scene/world';
import { prepareImageMaskMapper } from '../tools/imageMaskCoordinates';
import { ocrRegionPlacement } from './regionPlacement';

/** Text is read in the corrected orientation; place it back in source space. */
function textRegionGeometry(word: OcrWord): { transform: Affine; width: number; height: number } {
  const { x, y, width, height } = word;
  switch (word.orientationCorrected) {
    case 90:
      return { transform: [0, -1, 1, 0, x, y + height], width: height, height: width };
    case 180:
      return { transform: [-1, 0, 0, -1, x + width, y + height], width, height };
    case 270:
      return { transform: [0, 1, -1, 0, x + width, y], width: height, height: width };
    default:
      return { transform: [1, 0, 0, 1, x, y], width, height };
  }
}

/** A single document transaction, with editable text beside its source image.
 * Source dimensions come from the decoded pixels used for recognition, never
 * guessed metadata. Parent/page ownership and every affine axis are preserved. */
export function createOcrTextLayers(
  document: Document,
  imageId: string,
  words: readonly OcrWord[],
  source: { width: number; height: number },
): { document: Document; created: number } {
  const node = document.nodes[imageId];
  if (!node) return { document, created: 0 };
  const mapper = prepareImageMaskMapper({
    document,
    node,
    sourceWidth: source.width,
    sourceHeight: source.height,
  });
  if (!mapper) return { document, created: 0 };
  const parent = getParent(document, imageId);
  const inverseParent = parent ? tryInvertAffine(nodeWorldTransform(document, parent)) : null;
  if (parent && !inverseParent) return { document, created: 0 };
  const imageWorld = nodeWorldTransform(document, imageId);
  const imageToParent = inverseParent ? multiplyAffine(inverseParent, imageWorld) : imageWorld;
  let result = document;
  let created = 0;
  for (const word of words) {
    if (!word.text.trim()) continue;
    const sourceTransform = ocrRegionPlacement(mapper.placement, word);
    if (!sourceTransform) continue;
    const geometry = textRegionGeometry(word);
    const local = multiplyAffine(sourceTransform, geometry.transform);
    const transform = multiplyAffine(imageToParent, local);
    const { id, doc } = nextNodeId(result);
    const text = makeTextNode(id, word.text, {
      name: `OCR: ${word.text.slice(0, 20)}`,
      transform,
      // A line-height-sized box stays legible instead of shrinking every region
      // to 8% of the entire image. Font identification is a separate workflow.
      fontSize: geometry.height / 1.2,
      lineHeight: 1.2,
      w: geometry.width,
      h: geometry.height,
      textOverflow: 'visible',
    });
    result = parent ? addChild(doc, parent, text) : addNode(doc, text);
    created++;
  }
  return { document: result, created };
}
