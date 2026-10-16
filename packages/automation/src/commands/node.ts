/**
 * node.* commands: inspect and edit scene nodes.
 *
 * Every mutation is a pure function from a document to a document, validated
 * before it runs and verified after (the node really exists, the parent really
 * holds it). That check is what turns the legacy "precondition says OK, apply
 * silently drops the child" case into a refusal.
 */
import {
  addChild,
  addNode,
  arrangeNode,
  type Document,
  isContainer,
  makeFrameNode,
  makeShapeNode,
  makeTextNode,
  moveChild,
  moveNode,
  nextNodeId,
  nodeWorldTransform,
  removeNode,
  reparentNode,
  resizeSceneNode,
  type SceneNode,
} from '@varve/scene';
import { type Affine, invertAffine, multiplyAffine } from '@varve/shared';
import { defineCommand, type MutationPlan } from '../catalog';
import { CommandRejection } from '../errors';
import { type Infer, s } from '../schema';
import {
  assertEditable,
  BLEND_MODES,
  COORD,
  colorToHex,
  describeNode,
  HEX_COLOR,
  hexToRgb,
  NODE_ID,
  NODE_IDS,
  NODE_KINDS,
  NODE_NAME,
  NODE_VIEW,
  type NodeView,
  parentIndexOf,
  protectedRoots,
  requireNodes,
  SIZE,
  siblingsOf,
} from './common';

const HEADLESS_AND_LIVE = ['headless', 'connected'] as const;

// ── Queries ──────────────────────────────────────────────────────────────────

const listInput = s.object({
  parentId: s.optional(
    s.nullable(NODE_ID, {
      description:
        'Container to list. Omit for the default insertion surface (the active page content root); null for the document root.',
    }),
  ),
  kinds: s.optional(
    s.array(s.enum(NODE_KINDS), { minItems: 1, maxItems: NODE_KINDS.length, unique: true }),
  ),
  nameContains: s.optional(s.string({ maxBytes: 256, minLength: 1 })),
  limit: s.integer({ min: 1, max: 500, default: 100 }),
  cursor: s.optional(s.string({ maxBytes: 16, pattern: '^o:[0-9]{1,9}$' })),
});

const listOutput = s.object({
  parentId: s.nullable(s.string({ maxBytes: 128 })),
  total: s.integer({ min: 0 }),
  nodes: s.array(NODE_VIEW, { maxItems: 500 }),
  nextCursor: s.optional(s.string({ maxBytes: 16 })),
});

type ListOutput = Infer<typeof listOutput>;

export const nodeList = defineCommand({
  id: 'varve.node.list',
  version: 1,
  title: 'List child nodes',
  summary:
    'List the direct children of a container in paint order (bottom to top), with stable ids, names, kinds, parent-local position and size.',
  keywords: ['children', 'layers', 'hierarchy', 'tree', 'inspect'],
  effect: 'read',
  authorization: 'read',
  runtimes: HEADLESS_AND_LIVE,
  input: listInput,
  output: listOutput,
  examples: [{ title: 'First 50 children of the default surface', args: { limit: 50 } }],
  query(doc, args: Infer<typeof listInput>, ctx): ListOutput {
    const parents = parentIndexOf(doc);
    const parentId = args.parentId === undefined ? ctx.defaultParentId : args.parentId;
    let childIds: readonly string[];
    if (parentId === null) {
      childIds = doc.rootChildren;
    } else {
      const parent = requireNodes(doc, [parentId], 'parentId')[0] as SceneNode;
      if (!isContainer(parent)) {
        throw new CommandRejection('INVARIANT_VIOLATION', {
          message: `parentId: ${parentId} is a ${parent.kind}, not a container, so it has no children to list`,
        });
      }
      childIds = parent.children;
    }
    const needle = args.nameContains?.toLowerCase();
    const filtered = childIds
      .map((id) => doc.nodes[id])
      .filter((node): node is SceneNode => node !== undefined)
      .filter((node) => (args.kinds ? args.kinds.includes(node.kind as never) : true))
      .filter((node) => (needle ? node.name.toLowerCase().includes(needle) : true));
    const start = args.cursor ? Number(args.cursor.slice(2)) : 0;
    const page = filtered.slice(start, start + args.limit);
    const next = start + page.length < filtered.length ? `o:${start + page.length}` : undefined;
    const result: ListOutput = {
      parentId,
      total: filtered.length,
      nodes: page.map((node) => describeNode(doc, node, parents)),
    };
    if (next !== undefined) result.nextCursor = next;
    return result;
  },
});

const GET_INPUT = s.object({
  nodeIds: s.array(NODE_ID, { minItems: 1, maxItems: 100, unique: true }),
});

const GET_OUTPUT = s.object({ nodes: s.array(NODE_VIEW, { maxItems: 100 }) });

type GetOutput = Infer<typeof GET_OUTPUT>;

export const nodeGet = defineCommand({
  id: 'varve.node.get',
  version: 1,
  title: 'Get nodes',
  summary:
    'Return effective properties for specific nodes by id. A request naming an unknown id is refused as a whole and lists every unknown id.',
  keywords: ['inspect', 'properties', 'read'],
  effect: 'read',
  authorization: 'read',
  runtimes: HEADLESS_AND_LIVE,
  input: GET_INPUT,
  output: GET_OUTPUT,
  examples: [{ title: 'One node', args: { nodeIds: ['n1'] } }],
  query(doc, args: Infer<typeof GET_INPUT>): GetOutput {
    const nodes = requireNodes(doc, args.nodeIds);
    const parents = parentIndexOf(doc);
    return { nodes: nodes.map((node) => describeNode(doc, node, parents, { includeText: true })) };
  },
});

const FIND_INPUT = s.object({
  name: s.string({ maxBytes: 256, minLength: 1 }),
  match: s.enum(['exact', 'contains'] as const, { default: 'exact' }),
  kinds: s.optional(
    s.array(s.enum(NODE_KINDS), { minItems: 1, maxItems: NODE_KINDS.length, unique: true }),
  ),
  limit: s.integer({ min: 1, max: 200, default: 50 }),
});

const FIND_OUTPUT = s.object({
  matches: s.array(NODE_VIEW, { maxItems: 200 }),
  total: s.integer({ min: 0 }),
  ambiguous: s.boolean(),
});

type FindOutput = Infer<typeof FIND_OUTPUT>;

export const nodeFind = defineCommand({
  id: 'varve.node.find',
  version: 1,
  title: 'Find nodes by name',
  summary:
    'Look nodes up by name. Names are not ids and are not unique: every match is returned and `ambiguous` says whether more than one matched.',
  keywords: ['search', 'name', 'lookup'],
  effect: 'read',
  authorization: 'read',
  runtimes: HEADLESS_AND_LIVE,
  input: FIND_INPUT,
  output: FIND_OUTPUT,
  examples: [{ title: 'Exact name', args: { name: 'Hero title' } }],
  query(doc, args: Infer<typeof FIND_INPUT>): FindOutput {
    const parents = parentIndexOf(doc);
    const needle = args.name;
    const found: SceneNode[] = [];
    for (const node of Object.values(doc.nodes)) {
      if (args.kinds && !args.kinds.includes(node.kind as never)) continue;
      const hit =
        args.match === 'exact'
          ? node.name === needle
          : node.name.toLowerCase().includes(needle.toLowerCase());
      if (hit) found.push(node);
    }
    found.sort((a, b) => a.id.localeCompare(b.id));
    return {
      matches: found.slice(0, args.limit).map((node) => describeNode(doc, node, parents)),
      total: found.length,
      ambiguous: found.length > 1,
    };
  },
});

// ── Create ───────────────────────────────────────────────────────────────────

function createVariant<K extends string, P extends Parameters<typeof s.object>[0]>(
  kind: K,
  props: P,
) {
  return s.object({
    kind: s.literal(kind),
    ...props,
    name: s.optional(NODE_NAME),
    fill: s.optional(HEX_COLOR),
    parentId: s.optional(NODE_ID),
    index: s.optional(s.integer({ min: 0, max: 1_000_000 })),
  });
}

const createInput = s.union('kind', {
  rect: createVariant('rect', {
    x: COORD,
    y: COORD,
    width: SIZE,
    height: SIZE,
    cornerRadius: s.optional(s.number({ min: 0, max: 1_000_000, unit: 'px' })),
  }),
  ellipse: createVariant('ellipse', { x: COORD, y: COORD, width: SIZE, height: SIZE }),
  frame: createVariant('frame', { x: COORD, y: COORD, width: SIZE, height: SIZE }),
  text: createVariant('text', {
    x: COORD,
    y: COORD,
    text: s.string({ maxBytes: 100_000 }),
    fontSize: s.optional(s.number({ min: 1, max: 2000, unit: 'px' })),
    width: s.optional(SIZE),
    height: s.optional(SIZE),
  }),
});

type CreateArgs = Infer<typeof createInput>;

function buildNode(id: string, args: CreateArgs): SceneNode {
  const transform: Affine = [1, 0, 0, 1, args.x, args.y];
  const common = {
    ...(args.name !== undefined ? { name: args.name } : {}),
    ...(args.fill !== undefined ? { fill: hexToRgb(args.fill) } : {}),
    transform,
  };
  switch (args.kind) {
    case 'rect':
      return makeShapeNode(
        id,
        { kind: 'rect', x: 0, y: 0, w: args.width, h: args.height },
        {
          ...common,
          ...(args.cornerRadius !== undefined ? { cornerRadius: args.cornerRadius } : {}),
        },
      );
    case 'ellipse':
      return makeShapeNode(
        id,
        {
          kind: 'ellipse',
          cx: args.width / 2,
          cy: args.height / 2,
          rx: args.width / 2,
          ry: args.height / 2,
        },
        common,
      );
    case 'frame':
      return makeFrameNode(id, { ...common, w: args.width, h: args.height });
    case 'text':
      return makeTextNode(id, args.text, {
        ...common,
        ...(args.fontSize !== undefined ? { fontSize: args.fontSize } : {}),
        ...(args.width !== undefined ? { w: args.width } : {}),
        ...(args.height !== undefined ? { h: args.height } : {}),
      });
  }
}

const CREATE_OUTPUT = s.object({
  node: NODE_VIEW,
  parentId: s.nullable(s.string({ maxBytes: 128 })),
});

export const nodeCreate = defineCommand({
  id: 'varve.node.create',
  version: 1,
  title: 'Create a node',
  summary:
    'Create a rectangle, ellipse, frame or text node at a parent-local position. The new id and the parent actually used are returned.',
  keywords: ['add', 'new', 'rectangle', 'ellipse', 'frame', 'text', 'shape', 'insert'],
  effect: 'mutate',
  authorization: 'edit',
  runtimes: HEADLESS_AND_LIVE,
  input: createInput,
  output: CREATE_OUTPUT,
  examples: [
    {
      title: 'A teal rectangle',
      args: { kind: 'rect', x: 40, y: 40, width: 200, height: 120, fill: '#14b8a6' },
    },
    {
      title: 'Headline text',
      args: { kind: 'text', x: 40, y: 200, text: 'Spring sale', fontSize: 48 },
    },
  ],
  plan(
    doc,
    args: Infer<typeof createInput>,
    ctx,
  ): MutationPlan<{ node: NodeView; parentId: string | null }> {
    const parents = parentIndexOf(doc);
    const parentId = args.parentId !== undefined ? args.parentId : ctx.defaultParentId;
    if (parentId !== null) {
      const parent = requireNodes(doc, [parentId], 'parentId')[0] as SceneNode;
      if (!isContainer(parent)) {
        throw new CommandRejection('INVARIANT_VIOLATION', {
          message: `parentId: ${parentId} is a ${parent.kind}; only frames and groups can contain nodes`,
          hint: 'omit parentId to use the default surface, or pass a frame/group id',
        });
      }
      assertEditable(doc, parents, [parentId]);
    }
    const minted = nextNodeId(doc, ctx.rng);
    const node = buildNode(minted.id, args);
    let next: Document =
      parentId !== null ? addChild(minted.doc, parentId, node) : addNode(minted.doc, node);
    if (next.nodes[node.id] === undefined) {
      throw new CommandRejection('INVARIANT_VIOLATION', {
        message: `the node could not be inserted under ${parentId ?? 'the document root'}`,
      });
    }
    if (args.index !== undefined) {
      next =
        parentId !== null
          ? moveChild(next, parentId, node.id, args.index)
          : moveNode(next, node.id, args.index);
    }
    const placed = next.nodes[node.id] as SceneNode;
    const view = describeNode(next, placed, parentIndexOf(next));
    return {
      doc: next,
      label: `Create ${args.kind}`,
      created: [node.id],
      changed: parentId !== null ? [parentId] : [],
      output: { node: view, parentId },
    };
  },
});

// ── Set properties ───────────────────────────────────────────────────────────

const setInput = s.object({
  nodeIds: NODE_IDS,
  name: s.optional(NODE_NAME),
  visible: s.optional(s.boolean()),
  locked: s.optional(s.boolean()),
  opacity: s.optional(s.number({ min: 0, max: 1 })),
  rotation: s.optional(s.number({ min: -3600, max: 3600, unit: 'deg' })),
  blendMode: s.optional(s.enum(BLEND_MODES)),
  fill: s.optional(HEX_COLOR),
  text: s.optional(s.string({ maxBytes: 100_000 })),
  fontSize: s.optional(s.number({ min: 1, max: 2000, unit: 'px' })),
});

const PROPERTY_KEYS = [
  'name',
  'visible',
  'locked',
  'opacity',
  'rotation',
  'blendMode',
  'fill',
  'text',
  'fontSize',
] as const;

const SET_OUTPUT = s.object({ nodes: s.array(NODE_VIEW, { maxItems: 500 }) });

export const nodeSet = defineCommand({
  id: 'varve.node.set',
  version: 1,
  title: 'Set node properties',
  summary:
    'Set one or more typed properties on one or more nodes in a single undo step. Refused as a whole if any node does not exist, is locked, or does not support a property.',
  keywords: ['edit', 'rename', 'opacity', 'color', 'fill', 'visibility', 'lock', 'rotate', 'text'],
  effect: 'mutate',
  authorization: 'edit',
  runtimes: HEADLESS_AND_LIVE,
  naturallyIdempotent: true,
  input: setInput,
  output: SET_OUTPUT,
  examples: [{ title: 'Fade two layers', args: { nodeIds: ['n1', 'n2'], opacity: 0.5 } }],
  plan(doc, args: Infer<typeof setInput>): MutationPlan<{ nodes: NodeView[] }> {
    const provided = PROPERTY_KEYS.filter((key) => args[key] !== undefined);
    if (provided.length === 0) {
      throw new CommandRejection('INVALID_ARGUMENT', {
        message: `no properties to set; provide at least one of: ${PROPERTY_KEYS.join(', ')}`,
      });
    }
    const targets = requireNodes(doc, args.nodeIds);
    const parents = parentIndexOf(doc);

    // A locked node may only be edited in the same call that unlocks it, and a
    // locked ancestor must be unlocked on its own: lock state is never bypassed.
    const unlocking = args.locked === false;
    assertEditable(
      doc,
      parents,
      targets.filter((node) => !(unlocking && node.locked)).map((node) => node.id),
    );
    if (unlocking) {
      const viaAncestor = targets.filter((node) => {
        const parentId = parents.get(node.id);
        return (
          parentId !== undefined &&
          doc.nodes[parentId] !== undefined &&
          parentLocked(doc, parents, parentId)
        );
      });
      if (viaAncestor.length > 0) {
        assertEditable(
          doc,
          parents,
          viaAncestor.map((node) => parents.get(node.id) as string),
        );
      }
    }

    const unsupported: string[] = [];
    for (const node of targets) {
      if ((args.text !== undefined || args.fontSize !== undefined) && node.kind !== 'text') {
        unsupported.push(`${node.id} (${node.kind}) has no text properties`);
      }
      if (args.fill !== undefined && (node.fills?.length || node.paintRefs?.length)) {
        unsupported.push(
          `${node.id} has a stacked fill; a single color would not change what is drawn`,
        );
      }
    }
    if (unsupported.length > 0) {
      throw new CommandRejection('INVARIANT_VIOLATION', {
        message: `property not supported on ${unsupported.length} node(s): ${unsupported.slice(0, 5).join('; ')}`,
        details: { unsupported },
      });
    }

    const nodes = { ...doc.nodes };
    for (const node of targets) {
      const patch: Record<string, unknown> = {};
      if (args.name !== undefined) {
        patch.name = args.name;
        patch.nameMode = 'custom';
      }
      if (args.visible !== undefined) patch.visible = args.visible;
      if (args.locked !== undefined) patch.locked = args.locked;
      if (args.opacity !== undefined) patch.opacity = args.opacity;
      if (args.rotation !== undefined) patch.rotation = args.rotation;
      if (args.blendMode !== undefined) patch.blendMode = args.blendMode;
      if (args.fill !== undefined) patch.fill = hexToRgb(args.fill);
      if (args.text !== undefined) patch.text = args.text;
      if (args.fontSize !== undefined) patch.fontSize = args.fontSize;
      nodes[node.id] = { ...node, ...patch } as SceneNode;
    }
    const next: Document = { ...doc, nodes };
    const nextParents = parentIndexOf(next);
    return {
      doc: unchanged(doc, next, targets) ? doc : next,
      label: `Set ${provided.join(', ')}`,
      changed: targets.map((node) => node.id),
      output: {
        nodes: targets.map((node) =>
          describeNode(next, next.nodes[node.id] as SceneNode, nextParents),
        ),
      },
      ...(unchanged(doc, next, targets) ? { noOp: 'all values already matched' } : {}),
    };
  },
});

function parentLocked(doc: Document, parents: Map<string, string>, id: string): boolean {
  let cursor: string | undefined = id;
  const seen = new Set<string>();
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    if (doc.nodes[cursor]?.locked) return true;
    cursor = parents.get(cursor);
  }
  return false;
}

function unchanged(before: Document, after: Document, targets: readonly SceneNode[]): boolean {
  for (const node of targets) {
    const a = before.nodes[node.id] as unknown as Record<string, unknown>;
    const b = after.nodes[node.id] as unknown as Record<string, unknown>;
    for (const key of Object.keys(b)) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
    }
  }
  return true;
}

// ── Move / resize ────────────────────────────────────────────────────────────

const moveInput = s.union('mode', {
  to: s.object({
    mode: s.literal('to'),
    nodeId: NODE_ID,
    x: COORD,
    y: COORD,
  }),
  by: s.object({
    mode: s.literal('by'),
    nodeIds: NODE_IDS,
    dx: s.number({ min: -10_000_000, max: 10_000_000, unit: 'px' }),
    dy: s.number({ min: -10_000_000, max: 10_000_000, unit: 'px' }),
  }),
});

const MOVE_OUTPUT = s.object({ nodes: s.array(NODE_VIEW, { maxItems: 500 }) });

export const nodeMove = defineCommand({
  id: 'varve.node.move',
  version: 1,
  title: 'Move nodes',
  summary:
    'Move one node to an absolute parent-local position (mode "to"), or move several nodes by a delta (mode "by"). Positions are the node transform translation, matching the editor.',
  keywords: ['position', 'translate', 'nudge', 'drag'],
  effect: 'mutate',
  authorization: 'edit',
  runtimes: HEADLESS_AND_LIVE,
  input: moveInput,
  output: MOVE_OUTPUT,
  examples: [
    { title: 'Absolute', args: { mode: 'to', nodeId: 'n1', x: 100, y: 50 } },
    { title: 'Relative', args: { mode: 'by', nodeIds: ['n1', 'n2'], dx: 10, dy: 0 } },
  ],
  plan(doc, args: Infer<typeof moveInput>): MutationPlan<{ nodes: NodeView[] }> {
    const ids = args.mode === 'to' ? [args.nodeId] : args.nodeIds;
    const targets = requireNodes(doc, ids);
    const parents = parentIndexOf(doc);
    assertEditable(doc, parents, ids);
    const nodes = { ...doc.nodes };
    let moved = false;
    for (const node of targets) {
      const t = node.transform ?? ([1, 0, 0, 1, 0, 0] as Affine);
      const x = args.mode === 'to' ? args.x : (t[4] ?? 0) + args.dx;
      const y = args.mode === 'to' ? args.y : (t[5] ?? 0) + args.dy;
      if (x === (t[4] ?? 0) && y === (t[5] ?? 0)) continue;
      moved = true;
      nodes[node.id] = {
        ...node,
        transform: [t[0] ?? 1, t[1] ?? 0, t[2] ?? 0, t[3] ?? 1, x, y] as Affine,
      } as SceneNode;
    }
    const next: Document = moved ? { ...doc, nodes } : doc;
    const nextParents = parentIndexOf(next);
    return {
      doc: next,
      label: targets.length === 1 ? 'Move' : `Move ${targets.length} layers`,
      changed: moved ? targets.map((node) => node.id) : [],
      output: {
        nodes: targets.map((node) =>
          describeNode(next, next.nodes[node.id] as SceneNode, nextParents),
        ),
      },
      ...(moved ? {} : { noOp: 'already at the requested position' }),
    };
  },
});

const RESIZE_INPUT = s.object({ nodeId: NODE_ID, width: SIZE, height: SIZE });

const RESIZE_OUTPUT = s.object({ node: NODE_VIEW });

export const nodeResize = defineCommand({
  id: 'varve.node.resize',
  version: 1,
  title: 'Resize a node',
  summary:
    'Set a node width and height using the same resize the editor applies. Kinds without a direct size (groups, tables, adjustments) are refused rather than ignored.',
  keywords: ['size', 'scale', 'width', 'height'],
  effect: 'mutate',
  authorization: 'edit',
  runtimes: HEADLESS_AND_LIVE,
  naturallyIdempotent: true,
  input: RESIZE_INPUT,
  output: RESIZE_OUTPUT,
  examples: [{ title: 'Resize', args: { nodeId: 'n1', width: 320, height: 200 } }],
  plan(doc, args: Infer<typeof RESIZE_INPUT>): MutationPlan<{ node: NodeView }> {
    const node = requireNodes(doc, [args.nodeId], 'nodeId')[0] as SceneNode;
    assertEditable(doc, parentIndexOf(doc), [args.nodeId]);
    const resized = resizeSceneNode(node, args.width, args.height);
    if (resized === node) {
      throw new CommandRejection('INVARIANT_VIOLATION', {
        message: `${args.nodeId} is a ${node.kind}${node.kind === 'shape' ? ` (${(node.shape as { kind: string }).kind})` : ''} and has no direct width/height`,
        hint: 'resize its children, or convert it to a frame',
      });
    }
    const next: Document = { ...doc, nodes: { ...doc.nodes, [node.id]: resized } };
    return {
      doc: next,
      label: 'Resize',
      changed: [node.id],
      output: { node: describeNode(next, resized, parentIndexOf(next)) },
    };
  },
});

// ── Delete / reorder / reparent ──────────────────────────────────────────────

const DELETE_INPUT = s.object({ nodeIds: NODE_IDS });

const DELETE_OUTPUT = s.object({
  deleted: s.array(s.string({ maxBytes: 128 }), { maxItems: 100_000 }),
});

export const nodeDelete = defineCommand({
  id: 'varve.node.delete',
  version: 1,
  title: 'Delete nodes',
  summary:
    'Delete nodes and their descendants as one undo step. Page and master content roots are protected. Refused as a whole if any id is unknown or locked.',
  keywords: ['remove', 'trash'],
  effect: 'mutate',
  authorization: 'edit',
  runtimes: HEADLESS_AND_LIVE,
  input: DELETE_INPUT,
  output: DELETE_OUTPUT,
  examples: [{ title: 'Delete one', args: { nodeIds: ['n1'] } }],
  plan(doc, args: Infer<typeof DELETE_INPUT>): MutationPlan<{ deleted: string[] }> {
    requireNodes(doc, args.nodeIds);
    const roots = protectedRoots(doc);
    const protectedHits = args.nodeIds.filter((id) => roots.has(id));
    if (protectedHits.length > 0) {
      throw new CommandRejection('INVARIANT_VIOLATION', {
        message: `${protectedHits.join(', ')} is a page or master content root and cannot be deleted`,
        hint: 'delete the page with the page commands instead',
      });
    }
    assertEditable(doc, parentIndexOf(doc), args.nodeIds);
    let next = doc;
    for (const id of args.nodeIds) {
      if (next.nodes[id] !== undefined) next = removeNode(next, id);
    }
    const deleted = Object.keys(doc.nodes).filter((id) => next.nodes[id] === undefined);
    return {
      doc: next,
      label: args.nodeIds.length === 1 ? 'Delete' : `Delete ${args.nodeIds.length} layers`,
      deleted,
      output: { deleted },
    };
  },
});

const REORDER_INPUT = s.object({
  nodeId: NODE_ID,
  position: s.enum(['front', 'back', 'forward', 'backward'] as const),
});

const REORDER_OUTPUT = s.object({ node: NODE_VIEW });

export const nodeReorder = defineCommand({
  id: 'varve.node.reorder',
  version: 1,
  title: 'Change paint order',
  summary:
    'Move a node within its siblings: front, back, forward one, or backward one. Reports no-op when it is already at the boundary.',
  keywords: ['z-order', 'arrange', 'bring to front', 'send to back', 'layer order'],
  effect: 'mutate',
  authorization: 'edit',
  runtimes: HEADLESS_AND_LIVE,
  input: REORDER_INPUT,
  output: REORDER_OUTPUT,
  examples: [{ title: 'Bring to front', args: { nodeId: 'n1', position: 'front' } }],
  plan(doc, args: Infer<typeof REORDER_INPUT>): MutationPlan<{ node: NodeView }> {
    const node = requireNodes(doc, [args.nodeId], 'nodeId')[0] as SceneNode;
    const parents = parentIndexOf(doc);
    assertEditable(doc, parents, [args.nodeId]);
    const before = siblingsOf(doc, parents, args.nodeId).indexOf(args.nodeId);
    const next = arrangeNode(doc, args.nodeId, args.position);
    const nextParents = parentIndexOf(next);
    const after = siblingsOf(next, nextParents, args.nodeId).indexOf(args.nodeId);
    return {
      doc: before === after ? doc : next,
      label: `Reorder (${args.position})`,
      changed: [node.id],
      output: { node: describeNode(next, next.nodes[node.id] as SceneNode, nextParents) },
      ...(before === after
        ? {
            noOp: `already at the ${args.position === 'front' || args.position === 'forward' ? 'top' : 'bottom'}`,
          }
        : {}),
    };
  },
});

const REPARENT_INPUT = s.object({
  nodeId: NODE_ID,
  parentId: s.nullable(NODE_ID),
  index: s.optional(s.integer({ min: 0, max: 1_000_000 })),
  keepWorldPosition: s.boolean({ default: true }),
});

const REPARENT_OUTPUT = s.object({ node: NODE_VIEW });

export const nodeReparent = defineCommand({
  id: 'varve.node.reparent',
  version: 1,
  title: 'Move a node into another container',
  summary:
    'Move a node under a frame or group (or the document root with parentId null). By default the node keeps its on-canvas position by recomputing its local transform in the new parent space.',
  keywords: ['group', 'nest', 'move into', 'frame', 'hierarchy'],
  effect: 'mutate',
  authorization: 'edit',
  runtimes: HEADLESS_AND_LIVE,
  input: REPARENT_INPUT,
  output: REPARENT_OUTPUT,
  examples: [{ title: 'Into a frame', args: { nodeId: 'n2', parentId: 'n1' } }],
  plan(doc, args: Infer<typeof REPARENT_INPUT>): MutationPlan<{ node: NodeView }> {
    const node = requireNodes(doc, [args.nodeId], 'nodeId')[0] as SceneNode;
    if (protectedRoots(doc).has(node.id)) {
      throw new CommandRejection('INVARIANT_VIOLATION', {
        message: `${node.id} is a page or master content root and cannot be moved`,
      });
    }
    const parents = parentIndexOf(doc);
    assertEditable(doc, parents, [node.id]);
    if (args.parentId !== null) {
      const parent = requireNodes(doc, [args.parentId], 'parentId')[0] as SceneNode;
      if (!isContainer(parent)) {
        throw new CommandRejection('INVARIANT_VIOLATION', {
          message: `parentId: ${args.parentId} is a ${parent.kind}; only frames and groups can contain nodes`,
        });
      }
      assertEditable(doc, parents, [args.parentId]);
      for (
        let cursor: string | undefined = args.parentId;
        cursor !== undefined;
        cursor = parents.get(cursor)
      ) {
        if (cursor === node.id) {
          throw new CommandRejection('INVARIANT_VIOLATION', {
            message: `${args.parentId} is inside ${node.id}; a node cannot be moved into its own descendant`,
          });
        }
      }
    }
    const siblingsAfter =
      args.parentId === null
        ? doc.rootChildren.filter((id) => id !== node.id).length
        : (doc.nodes[args.parentId] as { children: string[] }).children.filter(
            (id) => id !== node.id,
          ).length;
    const toIndex = Math.min(args.index ?? siblingsAfter, siblingsAfter);

    let local: Affine | undefined;
    if (args.keepWorldPosition) {
      const world = nodeWorldTransform(doc, node.id, parents);
      const parentWorld: Affine =
        args.parentId === null
          ? [1, 0, 0, 1, 0, 0]
          : nodeWorldTransform(doc, args.parentId, parents);
      local = multiplyAffine(invertAffine(parentWorld), world);
    }
    const next = reparentNode(doc, node.id, args.parentId, toIndex, local);
    const actualParent = parentIndexOf(next).get(node.id) ?? null;
    if (next === doc || actualParent !== args.parentId) {
      throw new CommandRejection('INVARIANT_VIOLATION', {
        message: `the node could not be moved under ${args.parentId ?? 'the document root'}`,
      });
    }
    const oldParent = parents.get(node.id);
    return {
      doc: next,
      label: 'Reparent',
      changed: [
        node.id,
        ...(oldParent ? [oldParent] : []),
        ...(args.parentId ? [args.parentId] : []),
      ],
      output: { node: describeNode(next, next.nodes[node.id] as SceneNode, parentIndexOf(next)) },
    };
  },
});

export const NODE_COMMANDS = [
  nodeList,
  nodeGet,
  nodeFind,
  nodeCreate,
  nodeSet,
  nodeMove,
  nodeResize,
  nodeDelete,
  nodeReorder,
  nodeReparent,
];

// Re-exported for tests that assert colors round-trip.
export { colorToHex };
