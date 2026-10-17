/**
 * Grouping: `varve.node.group` and `varve.node.ungroup`.
 *
 * Both are the scene's own operations (`groupNodes`, `ungroupNode`), the ones the
 * editor's Group and Ungroup actions call, so the document that results is the
 * one the UI would have made. What these commands add is what a command owes:
 * every refusal is decided and explained here, up front, because the scene
 * operations answer an unsupported request by quietly returning the document
 * unchanged, which would reach an agent as a no-op with no reason.
 */
import {
  groupNodes,
  isLiveBooleanNode,
  makeGroupNode,
  nextNodeId,
  type SceneNode,
  ungroupNode,
} from '@varve/scene';
import { defineCommand, type MutationPlan } from '../catalog';
import { CommandRejection } from '../errors';
import { type Infer, s } from '../schema';
import {
  assertEditable,
  describeNode,
  NODE_ID,
  NODE_NAME,
  NODE_VIEW,
  type NodeView,
  parentIndexOf,
  protectedRoots,
  requireNodes,
} from './common';

const HEADLESS_AND_LIVE = ['headless', 'connected'] as const;

const GROUP_INPUT = s.object({
  nodeIds: s.array(NODE_ID, {
    minItems: 2,
    maxItems: 500,
    unique: true,
    description: 'Two or more nodes that share one parent.',
  }),
  name: s.optional(NODE_NAME),
});

const GROUP_OUTPUT = s.object({ group: NODE_VIEW });

export const nodeGroup = defineCommand({
  id: 'varve.node.group',
  version: 1,
  title: 'Group nodes',
  summary:
    'Wrap two or more sibling nodes in a new group that takes the first one’s place in the stacking order. The members keep their relative order. The new group id is returned.',
  keywords: ['group', 'combine', 'nest', 'wrap', 'container'],
  effect: 'mutate',
  authorization: 'edit',
  runtimes: HEADLESS_AND_LIVE,
  input: GROUP_INPUT,
  output: GROUP_OUTPUT,
  examples: [
    { title: 'Group two layers', args: { nodeIds: ['n2', 'n3'] } },
    { title: 'Group and name', args: { nodeIds: ['n2', 'n3'], name: 'Hero' } },
  ],
  plan(doc, args: Infer<typeof GROUP_INPUT>, ctx): MutationPlan<{ group: NodeView }> {
    requireNodes(doc, args.nodeIds, 'nodeIds');
    const roots = protectedRoots(doc);
    const rooted = args.nodeIds.filter((id) => roots.has(id));
    if (rooted.length > 0) {
      throw new CommandRejection('INVARIANT_VIOLATION', {
        message: `${rooted.join(', ')} is a page or master content root and cannot be grouped`,
        hint: 'group the content inside it instead',
      });
    }
    const parents = parentIndexOf(doc);
    assertEditable(doc, parents, args.nodeIds);

    const parentOf = (id: string): string | null => parents.get(id) ?? null;
    const distinct = new Set(args.nodeIds.map(parentOf));
    if (distinct.size !== 1) {
      const where = [...distinct].map((p) => p ?? 'the document root').join(', ');
      throw new CommandRejection('INVARIANT_VIOLATION', {
        message: `nodes must share the same parent to be grouped; these are under: ${where}`,
        hint: 'move them into one container first with varve.node.reparent, then group them',
        details: { parents: [...distinct] },
      });
    }
    const parentId = parentOf(args.nodeIds[0] as string);

    const minted = nextNodeId(doc, ctx.rng);
    const group = makeGroupNode(minted.id, { name: args.name ?? 'Group' });
    const next = groupNodes(minted.doc, args.nodeIds, group);
    const placed = parentIndexOf(next);
    const intact =
      next.nodes[group.id] !== undefined &&
      args.nodeIds.every((id) => placed.get(id) === group.id) &&
      (placed.get(group.id) ?? null) === parentId;
    if (!intact) {
      throw new CommandRejection('INVARIANT_VIOLATION', {
        message: 'the nodes could not be grouped; the document was not changed',
      });
    }
    return {
      doc: next,
      label: 'Group',
      created: [group.id],
      changed: [...args.nodeIds, ...(parentId ? [parentId] : [])],
      output: { group: describeNode(next, next.nodes[group.id] as SceneNode, placed) },
    };
  },
});

const UNGROUP_INPUT = s.object({ nodeId: NODE_ID });

const UNGROUP_OUTPUT = s.object({
  nodeIds: s.array(s.string({ maxBytes: 128 }), { maxItems: 100_000 }),
  parentId: s.nullable(s.string({ maxBytes: 128 })),
});

export const nodeUngroup = defineCommand({
  id: 'varve.node.ungroup',
  version: 1,
  title: 'Ungroup a group',
  summary:
    'Dissolve a group: its members move to the group’s parent, in the group’s place and in their existing order, keeping their position on the canvas. The group is removed.',
  keywords: ['ungroup', 'dissolve', 'release', 'flatten', 'unwrap'],
  effect: 'mutate',
  authorization: 'edit',
  runtimes: HEADLESS_AND_LIVE,
  input: UNGROUP_INPUT,
  output: UNGROUP_OUTPUT,
  examples: [{ title: 'Dissolve a group', args: { nodeId: 'n4' } }],
  plan(
    doc,
    args: Infer<typeof UNGROUP_INPUT>,
  ): MutationPlan<{ nodeIds: string[]; parentId: string | null }> {
    const node = requireNodes(doc, [args.nodeId], 'nodeId')[0] as SceneNode;
    if (node.kind !== 'group') {
      throw new CommandRejection('INVALID_ARGUMENT', {
        message: `${node.id} is a ${node.kind}, not a group`,
        hint: 'ungroup applies to groups only; move a frame’s children with varve.node.reparent',
      });
    }
    if (isLiveBooleanNode(node)) {
      throw new CommandRejection('INVARIANT_VIOLATION', {
        message: `${node.id} is a live boolean shape, which expands into a path rather than ungrouping`,
        hint: 'expand it from the editor; ungrouping its operands would discard the boolean result',
      });
    }
    const parents = parentIndexOf(doc);
    const members = [...node.children];
    assertEditable(doc, parents, [node.id, ...members]);
    const parentId = parents.get(node.id) ?? null;

    const next = ungroupNode(doc, node.id);
    const placed = parentIndexOf(next);
    const intact =
      next.nodes[node.id] === undefined &&
      members.every((id) => next.nodes[id] !== undefined && (placed.get(id) ?? null) === parentId);
    if (!intact) {
      throw new CommandRejection('INVARIANT_VIOLATION', {
        message: `${node.id} could not be ungrouped; the document was not changed`,
      });
    }
    return {
      doc: next,
      label: 'Ungroup',
      changed: [...members, ...(parentId ? [parentId] : [])],
      deleted: [node.id],
      output: { nodeIds: members, parentId },
    };
  },
});

export const STRUCTURE_COMMANDS = [nodeGroup, nodeUngroup];
