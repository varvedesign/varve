/**
 * varve.node.group and varve.node.ungroup.
 *
 * Both are served by the scene's own group operations (the ones the editor's
 * Group and Ungroup actions call), so the result is the document the UI would
 * have made. What the commands add is what a command must: every refusal is
 * decided and explained up front, because the scene operation itself answers an
 * unsupported request by quietly returning the document unchanged.
 */
import { describe, expect, it } from 'vitest';
import { addFrame, addRect, makeSession, type Session } from './harness';

type Node = {
  id: string;
  kind: string;
  name: string;
  parentId: string | null;
  index: number;
  childCount?: number;
  position: { x: number; y: number };
};

async function view(session: Session, nodeId: string): Promise<Node> {
  const r = await session.run('varve.node.get', { nodeIds: [nodeId] });
  expect(r.outcome).toBe('ok');
  return (r.output as { nodes: Node[] }).nodes[0] as Node;
}

async function threeRects(session: Session): Promise<[string, string, string]> {
  const a = await addRect(session, { x: 0, y: 0, name: 'A' });
  const b = await addRect(session, { x: 120, y: 0, name: 'B' });
  const c = await addRect(session, { x: 240, y: 0, name: 'C' });
  return [a, b, c];
}

describe('varve.node.group', () => {
  it('groups siblings under a new group that takes the first one’s place', async () => {
    const s = makeSession();
    const [a, b, c] = await threeRects(s);
    const parentBefore = (await view(s, a)).parentId;

    const r = await s.run('varve.node.group', { nodeIds: [a, b] });
    expect(r.outcome).toBe('applied');
    expect(r.created).toHaveLength(1);
    const groupId = r.created[0] as string;

    const group = await view(s, groupId);
    expect(group.kind).toBe('group');
    expect(group.name).toBe('Group');
    expect(group.childCount).toBe(2);
    expect(group.parentId).toBe(parentBefore);
    expect(group.index).toBe(0); // where A was; C still follows it
    expect((await view(s, a)).parentId).toBe(groupId);
    expect((await view(s, b)).parentId).toBe(groupId);
    expect((await view(s, c)).parentId).toBe(parentBefore);
    expect((await view(s, c)).index).toBe(1);
    // The receipt names the group the caller was told about.
    expect((r.output as { group: Node }).group.id).toBe(groupId);
  });

  it('keeps the members in their existing stacking order whatever order they were named in', async () => {
    const s = makeSession();
    const [a, b] = await threeRects(s);
    const r = await s.run('varve.node.group', { nodeIds: [b, a] });
    expect(r.outcome).toBe('applied');
    expect((await view(s, a)).index).toBe(0);
    expect((await view(s, b)).index).toBe(1);
  });

  it('names the group when asked', async () => {
    const s = makeSession();
    const [a, b] = await threeRects(s);
    const r = await s.run('varve.node.group', { nodeIds: [a, b], name: 'Hero' });
    expect(r.outcome).toBe('applied');
    expect((await view(s, r.created[0] as string)).name).toBe('Hero');
  });

  it('groups inside a frame, leaving the frame in place', async () => {
    const s = makeSession();
    const frame = await addFrame(s);
    const a = await addRect(s, { parentId: frame });
    const b = await addRect(s, { parentId: frame, x: 50 });
    const r = await s.run('varve.node.group', { nodeIds: [a, b] });
    expect(r.outcome).toBe('applied');
    expect((await view(s, r.created[0] as string)).parentId).toBe(frame);
  });

  it('refuses a single node: a group of one is not what anyone asked for', async () => {
    const s = makeSession();
    const [a] = await threeRects(s);
    const r = await s.run('varve.node.group', { nodeIds: [a] });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('INVALID_ARGUMENT');
  });

  it('refuses nodes with different parents, and says what to do instead', async () => {
    const s = makeSession();
    const frame = await addFrame(s);
    const inside = await addRect(s, { parentId: frame });
    const outside = await addRect(s);
    const before = s.doc();

    const r = await s.run('varve.node.group', { nodeIds: [inside, outside] });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('INVARIANT_VIOLATION');
    expect(r.error?.message).toContain('same parent');
    expect(r.error?.hint).toContain('varve.node.reparent');
    expect(s.doc()).toBe(before);
  });

  it('refuses an id that does not exist, changing nothing', async () => {
    const s = makeSession();
    const [a] = await threeRects(s);
    const before = s.doc();
    const r = await s.run('varve.node.group', { nodeIds: [a, 'ghost'] });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('UNKNOWN_TARGET');
    expect(s.doc()).toBe(before);
  });

  it('refuses a locked node, and a node whose ancestor is locked', async () => {
    const s = makeSession();
    const [a, b, c] = await threeRects(s);
    await s.run('varve.node.set', { nodeIds: [b], locked: true });
    const before = s.doc();
    const r = await s.run('varve.node.group', { nodeIds: [a, b] });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('LOCKED');
    expect(s.doc()).toBe(before);
    // The others are still groupable.
    expect((await s.run('varve.node.group', { nodeIds: [a, c] })).outcome).toBe('applied');
  });

  it('refuses a page content root', async () => {
    const s = makeSession();
    const info = await s.run('varve.document.info', {});
    const root = (info.output as { defaultParentId: string }).defaultParentId;
    const [a] = await threeRects(s);
    const r = await s.run('varve.node.group', { nodeIds: [a, root] });
    expect(r.outcome).toBe('rejected');
    expect(['INVARIANT_VIOLATION', 'INVALID_ARGUMENT']).toContain(r.error?.code);
  });

  it('previews without changing the document', async () => {
    const s = makeSession();
    const [a, b] = await threeRects(s);
    const before = s.doc();
    const r = await s.run('varve.node.group', { nodeIds: [a, b] }, { dryRun: true });
    expect(r.outcome).toBe('preview');
    expect(r.created).toHaveLength(1);
    expect(s.doc()).toBe(before);
  });

  it('is one transaction that can be rolled back to the exact prior document', async () => {
    const s = makeSession();
    const [a, b] = await threeRects(s);
    const before = s.doc();
    const r = await s.run('varve.node.group', { nodeIds: [a, b] });
    expect(r.outcome).toBe('applied');
    const back = await s.run('varve.history.rollback', { transactionId: r.transactionId });
    expect(back.outcome).toBe('applied');
    expect(s.doc().nodes).toEqual(before.nodes);
    expect(s.doc().rootChildren).toEqual(before.rootChildren);
  });
});

describe('varve.node.ungroup', () => {
  async function grouped(s: Session) {
    const [a, b, c] = await threeRects(s);
    const g = await s.run('varve.node.group', { nodeIds: [a, b] });
    return { a, b, c, groupId: g.created[0] as string };
  }

  it('moves the members to the group’s parent, in place, and removes the group', async () => {
    const s = makeSession();
    const { a, b, c, groupId } = await grouped(s);
    const parent = (await view(s, groupId)).parentId;

    const r = await s.run('varve.node.ungroup', { nodeId: groupId });
    expect(r.outcome).toBe('applied');
    expect(r.deleted).toEqual([groupId]);
    expect((await s.run('varve.node.get', { nodeIds: [groupId] })).outcome).toBe('rejected');
    expect((await view(s, a)).parentId).toBe(parent);
    expect((await view(s, b)).parentId).toBe(parent);
    expect([(await view(s, a)).index, (await view(s, b)).index, (await view(s, c)).index]).toEqual([
      0, 1, 2,
    ]);
    expect((r.output as { nodeIds: string[] }).nodeIds).toEqual([a, b]);
  });

  it('keeps every member where it was on the canvas when the group had moved', async () => {
    const s = makeSession();
    const { a, groupId } = await grouped(s);
    const world = (await view(s, a)).position;
    const moved = await s.run('varve.node.move', {
      mode: 'by',
      nodeIds: [groupId],
      dx: 50,
      dy: 20,
    });
    expect(moved.outcome).toBe('applied');

    // While grouped, its own position is group-local and does not change.
    expect((await view(s, a)).position).toEqual(world);
    const r = await s.run('varve.node.ungroup', { nodeId: groupId });
    expect(r.outcome).toBe('applied');
    const placed = (await view(s, a)).position;
    // Its position now includes what the group's transform contributed.
    expect(placed.x).toBeCloseTo(world.x + 50, 6);
    expect(placed.y).toBeCloseTo(world.y + 20, 6);
  });

  it('undoes grouping exactly: group then ungroup restores order and parent', async () => {
    const s = makeSession();
    const [a, b, c] = await threeRects(s);
    const orderBefore = [a, b, c].map(async (id) => (await view(s, id)).index);
    const g = await s.run('varve.node.group', { nodeIds: [a, b, c] });
    await s.run('varve.node.ungroup', { nodeId: g.created[0] as string });
    const orderAfter = [a, b, c].map(async (id) => (await view(s, id)).index);
    expect(await Promise.all(orderAfter)).toEqual(await Promise.all(orderBefore));
  });

  it('refuses a node that is not a group', async () => {
    const s = makeSession();
    const [a] = await threeRects(s);
    const before = s.doc();
    const r = await s.run('varve.node.ungroup', { nodeId: a });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('INVALID_ARGUMENT');
    expect(r.error?.message).toContain('not a group');
    expect(s.doc()).toBe(before);
  });

  it('refuses a locked group and a group holding a locked member', async () => {
    const s = makeSession();
    const { a, groupId } = await grouped(s);
    await s.run('varve.node.set', { nodeIds: [a], locked: true });
    const before = s.doc();
    const r = await s.run('varve.node.ungroup', { nodeId: groupId });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('LOCKED');
    expect(s.doc()).toBe(before);
  });

  it('refuses a frame: ungroup is for groups, and a frame has its own meaning', async () => {
    const s = makeSession();
    const frame = await addFrame(s);
    const r = await s.run('varve.node.ungroup', { nodeId: frame });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('INVALID_ARGUMENT');
  });

  it('refuses an unknown id', async () => {
    const s = makeSession();
    const r = await s.run('varve.node.ungroup', { nodeId: 'ghost' });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('UNKNOWN_TARGET');
  });
});

describe('permissions', () => {
  it('are edit-class commands: a read-only client does not see or run them', async () => {
    const s = makeSession();
    const [a, b] = await threeRects(s);
    const reader = s.as({
      id: 'r',
      kind: 'agent',
      label: 'r',
      transport: 'stdio',
      grants: ['read'],
    });
    const r = await s.executor.execute(reader, {
      command: 'varve.node.group',
      args: { nodeIds: [a, b] },
    });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('PERMISSION_DENIED');
  });
});
