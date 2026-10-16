import { describe, expect, it } from 'vitest';
import { defaultInsertionParent } from '../surface';
import { addFrame, makeSession, principal } from './harness';

/** The same headless authority, answering "where do new nodes go" the way a live editor can. */
function withDefaultParent(
  s: ReturnType<typeof makeSession>,
  answer: () => string | null | undefined,
) {
  const authority = new Proxy(s.authority, {
    get(target, property) {
      if (property === 'defaultParentId') return answer;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { ...s.ctx, authority };
}

const RECT = { kind: 'rect', x: 0, y: 0, width: 10, height: 10 };

function parentOf(s: ReturnType<typeof makeSession>, id: string): string | undefined {
  for (const [candidate, node] of Object.entries(s.doc().nodes)) {
    const children = (node as { children?: string[] }).children;
    if (children?.includes(id)) return candidate;
  }
  return undefined;
}

describe('where a new node goes when the caller names no parent', () => {
  it('uses what a live authority says the person is looking at', async () => {
    const s = makeSession();
    const frame = await addFrame(s);
    const ctx = withDefaultParent(s, () => frame);
    const r = await s.executor.execute(ctx, { command: 'varve.node.create', args: RECT });
    expect(r.outcome).toBe('applied');
    expect(parentOf(s, r.created[0] as string)).toBe(frame);
  });

  it('reports the same parent in document.info that a command would use', async () => {
    const s = makeSession();
    const frame = await addFrame(s);
    const ctx = withDefaultParent(s, () => frame);
    const info = await s.executor.execute(ctx, { command: 'varve.document.info', args: {} });
    expect((info.output as { defaultParentId: string | null }).defaultParentId).toBe(frame);
  });

  it('falls back to the headless default when the authority has no opinion', async () => {
    const s = makeSession();
    const ctx = withDefaultParent(s, () => undefined);
    const r = await s.executor.execute(ctx, { command: 'varve.node.create', args: RECT });
    expect(parentOf(s, r.created[0] as string)).toBe(defaultInsertionParent(s.doc()));
    const info = await s.executor.execute(ctx, { command: 'varve.document.info', args: {} });
    expect((info.output as { defaultParentId: string | null }).defaultParentId).toBe(
      defaultInsertionParent(s.doc()),
    );
  });

  it('an explicit parent still wins over the default', async () => {
    const s = makeSession();
    const frame = await addFrame(s);
    const other = await addFrame(s);
    const ctx = withDefaultParent(s, () => frame);
    const r = await s.executor.execute(ctx, {
      command: 'varve.node.create',
      args: { ...RECT, parentId: other },
    });
    expect(parentOf(s, r.created[0] as string)).toBe(other);
  });

  it('a headless authority never claims to know what a person is looking at', () => {
    const s = makeSession();
    expect(s.authority.defaultParentId).toBeUndefined();
    expect(principal('x', ['read']).grants).toEqual(['read']);
  });
});
