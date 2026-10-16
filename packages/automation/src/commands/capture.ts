import { defineCommand } from '../catalog';
import { s } from '../schema';
import { NODE_ID } from './common';

/** Longest edge, in pixels, an agent may ask for. */
export const CAPTURE_MAX_DIMENSION = 2048;
/** Encoded PNG bytes a capture may return. Base64 grows this by a third. */
export const CAPTURE_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const CAPTURE_INPUT = s.object({
  nodeId: NODE_ID,
  maxDimension: s.integer({
    min: 16,
    max: CAPTURE_MAX_DIMENSION,
    default: 1024,
    unit: 'px',
    description:
      'Longest edge of the image in pixels. The node is scaled to fit; it is never rendered larger than its natural size times four.',
  }),
  background: s.enum(['transparent', 'white'] as const, {
    default: 'white',
    description:
      'white composites onto an opaque white page so contrast can be judged; transparent keeps the alpha channel.',
  }),
});

const CAPTURE_OUTPUT = s.object({
  kind: s.literal('document-pixels', {
    description:
      'These are pixels of the document rendered by the export pipeline, not a screenshot of the application window.',
  }),
  nodeId: s.string({ maxBytes: 128 }),
  revision: s.integer({
    min: 0,
    description: 'The document revision that was rendered. The pixels show exactly this revision.',
  }),
  currentRevision: s.integer({
    min: 0,
    description:
      'The revision when the image was ready. Greater than `revision` when the document changed while rendering; capture again if that matters.',
  }),
  complete: s.boolean({
    description:
      'True only when every font and image the node needs had settled. False means the image may show fallbacks or omit artwork: read `warnings`.',
  }),
  warnings: s.array(s.string({ maxBytes: 1024 }), { maxItems: 50 }),
  width: s.integer({ min: 1, unit: 'px' }),
  height: s.integer({ min: 1, unit: 'px' }),
  scale: s.number({
    description:
      'Pixels per document unit. Pixel (px, py) is the document point (bounds.x + px / scale, bounds.y + py / scale).',
  }),
  bounds: s.object(
    {
      x: s.number(),
      y: s.number(),
      w: s.number(),
      h: s.number(),
    },
    { description: 'The rectangle of the document the image covers, in document units.' },
  ),
  background: s.enum(['transparent', 'white'] as const),
  renderMs: s.number({ min: 0 }),
  backend: s.string({
    maxBytes: 64,
    description: 'The renderer that produced the pixels.',
  }),
  image: s.object({
    mimeType: s.literal('image/png'),
    bytes: s.integer({ min: 1 }),
    data: s.string({ maxBytes: Math.ceil((CAPTURE_MAX_IMAGE_BYTES * 4) / 3) + 8 }),
  }),
});

export const captureNode = defineCommand({
  id: 'varve.capture.node',
  version: 1,
  title: 'Capture an image of a node',
  summary:
    'Render one node (a frame, group or shape) to a PNG with the same pipeline File > Export uses, and return the pixels with their size, the document rectangle they cover, the revision rendered and whether every font and image had settled. Use it to check the result of an edit visually. It captures document pixels, not the application window. Requires the capture permission and a live application.',
  keywords: ['screenshot', 'render', 'image', 'png', 'preview', 'visual', 'verify', 'look', 'see'],
  effect: 'external',
  authorization: 'capture',
  runtimes: ['connected'],
  input: CAPTURE_INPUT,
  output: CAPTURE_OUTPUT,
  examples: [
    { title: 'Look at a frame', args: { nodeId: 'frame-id', maxDimension: 800 } },
    {
      title: 'Keep transparency',
      args: { nodeId: 'logo-id', background: 'transparent' },
    },
  ],
});

export const CAPTURE_COMMANDS = [captureNode];
