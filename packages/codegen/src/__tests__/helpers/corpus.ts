/**
 * Acceptance corpus for the code-export pipeline.
 *
 * Each builder returns a complete, valid `Document` exercising one real-world
 * handoff shape. The corpus is the shared input for codegen regression tests,
 * the verification harness fixtures, and baseline capture — one place to keep
 * the "does the export survive a real document" cases honest.
 *
 * Builders are pure: they never mutate the input document and return the
 * document plus the ids a test needs to address subtrees.
 */

import type { Document, GroupNode, ManagedColor, NodeId, RichText } from '@varve/scene';
import {
  addChild,
  addComponentProperty,
  addNode,
  createComponent,
  createDocument,
  createVariant,
  gradientFill,
  imageFill,
  instantiate,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
  setPropertyOverride,
  setVariantForInstance,
} from '@varve/scene';

const rgb = (r: number, g: number, b: number, a = 255): ManagedColor => ({
  space: 'rgb',
  r,
  g,
  b,
  a,
});

const TEAL = rgb(57, 208, 198);
const INK = rgb(16, 21, 31);
const CORAL = rgb(232, 90, 79);
const SUN = rgb(247, 181, 56);

/** A 1x1 teal PNG data URL — stable bytes for image-fill and asset tests. */
export const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export interface GraphicsShowcaseDoc {
  doc: Document;
  rootId: NodeId;
  /** Rect carrying drop + inner shadows. */
  shadowedRectId: NodeId;
  /** Rect filled with an angular gradient. */
  angularGradientRectId: NodeId;
  /** Multiply-blended circle over the gradient backdrop. */
  blendedCircleId: NodeId;
  /** Alpha-masked group (mask source is an ellipse sibling). */
  maskedGroupId: NodeId;
  /** Image-filled shape. */
  imageShapeId: NodeId;
}

/**
 * Masked, blended, shadowed, gradient-filled composition over a colored
 * backdrop. This is the corpus for graphics-fallback work: every member
 * historically degraded somewhere in the CSS-family pipeline.
 */
export function buildGraphicsShowcaseDoc(): GraphicsShowcaseDoc {
  let doc = createDocument('Graphics showcase');

  const root = makeFrameNode('root', {
    name: 'Showcase',
    w: 480,
    h: 360,
    fill: rgb(24, 28, 36),
    clipContent: true,
  });
  doc = addNode(doc, root);

  const shadowedRect = makeShapeNode(
    'shadowed',
    { kind: 'rect', x: 24, y: 24, w: 180, h: 120 },
    {
      name: 'Shadowed card',
      fill: rgb(255, 255, 255),
      cornerRadius: 12,
      effects: [
        {
          type: 'dropShadow',
          x: 0,
          y: 8,
          blur: 24,
          spread: 2,
          color: rgb(0, 0, 0, 96),
          opacity: 0.6,
          blendMode: 'normal',
          visible: true,
        },
        {
          type: 'innerShadow',
          x: 0,
          y: 2,
          blur: 6,
          spread: 0,
          color: rgb(0, 0, 0, 70),
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
    },
  );
  doc = addChild(doc, 'root', shadowedRect);

  const angularRect = makeShapeNode(
    'angular',
    { kind: 'rect', x: 228, y: 24, w: 228, h: 120 },
    {
      name: 'Angular banner',
      cornerRadius: 12,
    },
  );
  doc = addChild(doc, 'root', {
    ...angularRect,
    fills: [
      gradientFill('angular', [
        { position: 0, color: CORAL },
        { position: 0.5, color: SUN },
        { position: 1, color: TEAL },
      ]),
    ],
  });

  const backdrop = makeShapeNode(
    'backdrop',
    { kind: 'rect', x: 24, y: 168, w: 200, h: 168 },
    { name: 'Photo backdrop', fill: rgb(38, 46, 60), cornerRadius: 12 },
  );
  doc = addChild(doc, 'root', backdrop);

  const blendedCircle = makeShapeNode(
    'blended',
    { kind: 'ellipse', x: 84, y: 212, w: 120, h: 120 },
    {
      name: 'Blended orb',
      fill: CORAL,
      blendMode: 'multiply',
    },
  );
  doc = addChild(doc, 'root', blendedCircle);

  const maskSource = makeShapeNode(
    'mask-source',
    { kind: 'ellipse', x: 0, y: 0, w: 160, h: 168 },
    { name: 'Mask ellipse', fill: rgb(255, 255, 255) },
  );

  const maskedChild = makeShapeNode(
    'masked-art',
    { kind: 'rect', x: 0, y: 0, w: 208, h: 168 },
    { name: 'Masked artwork', fill: SUN },
  );

  // The masked group clips its artwork child with the ellipse sibling. The
  // mask source must be a direct child of the container that owns the mask.
  const maskedGroup = makeGroupNode('masked-group', { name: 'Masked group' });
  const groupWithMask: GroupNode = {
    ...maskedGroup,
    mask: { type: 'alpha', visible: true, sourceNodeId: 'mask-source' },
  };
  doc = addNode(doc, groupWithMask);
  doc = addChild(doc, 'masked-group', maskSource);
  doc = addChild(doc, 'masked-group', maskedChild);

  const imageShape = makeShapeNode(
    'image-shape',
    { kind: 'rect', x: 24, y: 24, w: 96, h: 96 },
    {
      name: 'Image tile',
      cornerRadius: 8,
    },
  );
  doc = addChild(doc, 'root', {
    ...imageShape,
    fills: [imageFill(TINY_PNG_DATA_URL, { fit: 'cover', imageWidth: 1, imageHeight: 1 })],
  });

  return {
    doc,
    rootId: 'root',
    shadowedRectId: 'shadowed',
    angularGradientRectId: 'angular',
    blendedCircleId: 'blended',
    maskedGroupId: 'masked-group',
    imageShapeId: 'image-shape',
  };
}

export interface RichTextDoc {
  doc: Document;
  rootId: NodeId;
  textId: NodeId;
}

/** Multi-paragraph, mixed-run editorial text: the rich-text fidelity corpus. */
export function buildRichTextDoc(): RichTextDoc {
  let doc = createDocument('Rich text');

  const root = makeFrameNode('root', {
    name: 'Article',
    w: 420,
    h: 320,
    fill: rgb(255, 255, 255),
  });
  doc = addNode(doc, root);

  const richText: RichText = {
    paragraphs: [
      {
        runs: [
          { text: 'Design', format: { fontWeight: 700, fontSize: 28, color: INK } },
          { text: ' to ', format: { fontSize: 28, color: INK } },
          {
            text: 'code',
            format: { fontWeight: 700, fontStyle: 'italic', fontSize: 28, color: TEAL },
          },
        ],
        format: { textAlign: 'left' },
      },
      // Empty paragraph: a deliberate blank line that must survive export.
      { runs: [] },
      {
        runs: [
          { text: 'Runs can split mid-word: super', format: { fontSize: 15, color: INK } },
          { text: 'cali', format: { fontSize: 15, color: CORAL, textDecoration: 'underline' } },
          {
            text: 'fragilistic. Literal markup lives as text: <b>&</b> {braces} `ticks`.',
            format: { fontSize: 15, color: INK },
          },
        ],
      },
      {
        runs: [
          {
            text: 'Emoji and combining marks: \u2728 design \u00e9t\u00e9.',
            format: { fontSize: 15, color: INK },
          },
        ],
      },
      {
        runs: [
          {
            text: '\u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645',
            format: { fontSize: 18, color: INK },
          },
        ],
        format: { direction: 'rtl', textAlign: 'right' },
      },
    ],
  };

  const text = makeTextNode('headline', 'Design to code', {
    name: 'Article body',
    richText,
    w: 380,
    h: 260,
    textMode: 'area',
    fontSize: 15,
    fill: INK,
  });
  doc = addChild(doc, 'root', text);

  return { doc, rootId: 'root', textId: 'headline' };
}

export interface WrappedTextDoc {
  doc: Document;
  rootId: NodeId;
  textId: NodeId;
}

/** Fixed-width area text whose paragraph must wrap: the SVG line-breaking corpus. */
export function buildWrappedTextDoc(): WrappedTextDoc {
  let doc = createDocument('Wrapped text');

  const root = makeFrameNode('root', {
    name: 'Card',
    w: 320,
    h: 200,
    fill: rgb(255, 255, 255),
  });
  doc = addNode(doc, root);

  const text = makeTextNode(
    'body',
    'Varve wraps this paragraph at the authored frame width, not at a guessed character count. Every measured line keeps its baseline, alignment, and styled runs.',
    {
      name: 'Card body',
      w: 280,
      h: 140,
      textMode: 'area',
      fontSize: 16,
      lineHeight: 1.4,
      fill: INK,
    },
  );
  doc = addChild(doc, 'root', text);

  return { doc, rootId: 'root', textId: 'body' };
}

export interface ResponsivePageDoc {
  doc: Document;
  rootId: NodeId;
  headerId: NodeId;
  cardsRowId: NodeId;
  heroId: NodeId;
}

/**
 * Fluid product page: header / hero / cards row / footer with authored
 * auto-layout, fill and hug sizing. No responsive conditions are authored
 * here — this corpus proves fluid behavior needs no breakpoints.
 */
export function buildResponsivePageDoc(): ResponsivePageDoc {
  let doc = createDocument('Responsive page');

  const root = makeFrameNode('root', {
    name: 'Page',
    w: 960,
    h: 720,
    fill: rgb(250, 250, 250),
    layoutStyle: {
      mode: 'flex',
      direction: 'column',
      gap: 24,
      padding: [32, 32, 32, 32],
      alignItems: 'stretch',
    },
  });
  doc = addNode(doc, root);

  const header = makeFrameNode('header', {
    name: 'Header',
    w: 896,
    h: 56,
    fill: INK,
    layoutSizingWidth: 'fill',
    layoutSizingHeight: 'fixed',
    layoutStyle: {
      mode: 'flex',
      direction: 'row',
      gap: 16,
      padding: [0, 24, 0, 24],
      alignItems: 'center',
      justifyContent: 'space-between',
    },
  });
  doc = addChild(doc, 'root', header);

  const brand = makeTextNode('brand', 'Varve', {
    name: 'Brand',
    fontSize: 20,
    fontWeight: 700,
    fill: rgb(255, 255, 255),
  });
  doc = addChild(doc, 'header', brand);
  const nav = makeTextNode('nav', 'Docs  Pricing  Download', {
    name: 'Nav',
    fontSize: 14,
    fill: rgb(220, 224, 230),
  });
  doc = addChild(doc, 'header', nav);

  const hero = makeFrameNode('hero', {
    name: 'Hero',
    w: 896,
    h: 220,
    fill: TEAL,
    layoutSizingWidth: 'fill',
    layoutSizingHeight: 'fixed',
    cornerRadius: 16,
  });
  doc = addChild(doc, 'root', hero);
  const heroText = makeTextNode('hero-text', 'Ship designs that become real code', {
    name: 'Hero title',
    fontSize: 32,
    fontWeight: 700,
    fill: rgb(255, 255, 255),
    w: 600,
  });
  doc = addChild(doc, 'hero', heroText);

  const cardsRow = makeFrameNode('cards', {
    name: 'Cards',
    w: 896,
    h: 180,
    fill: rgb(250, 250, 250),
    layoutSizingWidth: 'fill',
    layoutSizingHeight: 'hug',
    layoutStyle: {
      mode: 'flex',
      direction: 'row',
      gap: 16,
      alignItems: 'stretch',
    },
  });
  doc = addChild(doc, 'root', cardsRow);
  for (let i = 0; i < 3; i += 1) {
    const card = makeFrameNode(`card-${i}`, {
      name: `Card ${i + 1}`,
      w: 200,
      h: 120,
      fill: rgb(255, 255, 255),
      layoutSizingWidth: 'fill',
      layoutSizingHeight: 'hug',
      cornerRadius: 10,
      layoutStyle: { mode: 'flex', direction: 'column', gap: 8, padding: [16, 16, 16, 16] },
    });
    doc = addChild(doc, 'cards', card);
    const title = makeTextNode(`card-title-${i}`, `Feature ${i + 1}`, {
      name: 'Card title',
      fontSize: 16,
      fontWeight: 600,
      fill: INK,
    });
    doc = addChild(doc, `card-${i}`, title);
  }

  const footer = makeFrameNode('footer', {
    name: 'Footer',
    w: 896,
    h: 48,
    fill: rgb(230, 233, 238),
    layoutSizingWidth: 'fill',
    layoutSizingHeight: 'fixed',
  });
  doc = addChild(doc, 'root', footer);

  return { doc, rootId: 'root', headerId: 'header', cardsRowId: 'cards', heroId: 'hero' };
}

export interface ComponentFamilyDoc {
  doc: Document;
  rootId: NodeId;
  componentId: NodeId;
  masterId: NodeId;
  defaultInstanceId: NodeId;
  largeInstanceId: NodeId;
  largeVariantId: string;
}

/**
 * Button component family: a text-property master, a size variant, and two
 * instances (one default, one variant + text override). The component
 * corpus for extraction and production-mapping work.
 */
export function buildComponentFamilyDoc(): ComponentFamilyDoc {
  let doc = createDocument('Component family');

  const root = makeFrameNode('root', {
    name: 'Specimen',
    w: 520,
    h: 200,
    fill: rgb(250, 250, 250),
    layoutStyle: { mode: 'flex', direction: 'row', gap: 24, padding: [24, 24, 24, 24] },
  });
  doc = addNode(doc, root);

  // Master: a pill button whose label layer matches the property name.
  const master = makeFrameNode('btn-master', {
    name: 'Button',
    w: 140,
    h: 44,
    fill: TEAL,
    cornerRadius: 22,
    layoutStyle: { mode: 'flex', direction: 'row', alignItems: 'center', justifyContent: 'center' },
  });
  doc = addNode(doc, master);
  const masterLabel = makeTextNode('btn-label', 'Get started', {
    name: 'Label',
    fontSize: 15,
    fontWeight: 600,
    fill: rgb(255, 255, 255),
  });
  doc = addChild(doc, 'btn-master', masterLabel);

  const created = createComponent(doc, 'Button', 'btn-master', []);
  doc = created.doc;
  const componentId = created.component.id;

  const propAdded = addComponentProperty(doc, componentId, {
    name: 'Label',
    type: 'text',
    defaultValue: 'Get started',
  });
  doc = propAdded.doc;

  const variantCreated = createVariant(doc, componentId, 'Large', {
    Label: 'Get started',
  });
  doc = variantCreated.doc;
  const largeVariantId = variantCreated.variant.id;

  // Instance 1: default.
  const inst1 = instantiate(doc, created.component);
  doc = inst1.doc;
  doc = addChild(doc, 'root', inst1.node);

  // Instance 2: Large variant plus a text override.
  const inst2 = instantiate(doc, created.component);
  doc = inst2.doc;
  doc = addChild(doc, 'root', inst2.node);
  doc = setVariantForInstance(doc, inst2.node.id, largeVariantId);
  doc = setPropertyOverride(doc, inst2.node.id, 'Label', 'Try Varve');

  return {
    doc,
    rootId: 'root',
    componentId,
    masterId: 'btn-master',
    defaultInstanceId: inst1.node.id,
    largeInstanceId: inst2.node.id,
    largeVariantId,
  };
}
