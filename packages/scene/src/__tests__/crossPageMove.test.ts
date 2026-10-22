/**
 * A node moved to another page must still be on that page after save and reopen.
 *
 * Reported upstream as OpenPencil #374: "clone_node + reparent_node across pages
 * is lost on save/reload — frames orphaned, pages reopen empty". Varve keeps
 * page membership in two places — the page's `contentRoot` child list and the
 * container's `children` array — plus the document-wide `rootChildren` order, so
 * a move that updates one and not the others produces exactly that symptom: the
 * node disappears from the page it left but never appears on the page it joined.
 *
 * These tests cross the persistence boundary because an in-memory assertion
 * cannot catch it: the encoder prunes and re-derives page structures, so a
 * half-applied move can survive in memory and vanish on reopen.
 */
import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import { addPage, createDocument, makeShapeNode } from '../document';
import { reparentNode } from '../document-nodes';
import { DocumentCodec } from '../documentCodec';
import type { NodeId } from '../types';

/** The content root that owns a page's children. */
function contentRootOf(doc: Document, pageId: NodeId): NodeId {
  const page = (doc.pages ?? []).find((candidate) => candidate.id === pageId);
  if (!page) throw new Error(`no page ${pageId}`);
  return page.contentRoot;
}

function pageIds(doc: Document): NodeId[] {
  return (doc.pages ?? []).map((page) => page.id);
}

/** Round-trip through the real save format. */
function reopen(doc: Document): Document {
  const encoded = DocumentCodec.encode(doc);
  const decoded = DocumentCodec.decode(encoded);
  if (!decoded.ok) throw new Error(`decode failed: ${JSON.stringify(decoded).slice(0, 200)}`);
  return decoded.document;
}

function docWithTwoPages(): { doc: Document; first: NodeId; second: NodeId } {
  let doc = createDocument('cross-page move', false);
  doc = addPage(doc, { name: 'Second' });
  const [first, second] = pageIds(doc);
  if (!first || !second) throw new Error('expected two pages');
  return { doc, first, second };
}

describe('cross-page node moves', () => {
  it('keeps a moved node on its new page after save and reopen', () => {
    const { doc: base, first, second } = docWithTwoPages();

    const rect = makeShapeNode('moved-rect', { kind: 'rect', x: 10, y: 20, w: 40, h: 30 });
    const doc = {
      ...base,
      nodes: { ...base.nodes, 'moved-rect': rect },
      rootChildren: [...base.rootChildren, 'moved-rect'],
    } as Document;

    // Move it from page one's content root to page two's.
    const targetRoot = contentRootOf(doc, second);
    const moved = reparentNode(doc, 'moved-rect', targetRoot, 0);
    expect(moved).not.toBe(doc);

    // In memory: it belongs to the destination and no longer to the source.
    const reopened = reopen(moved);
    const destination = reopened.nodes[contentRootOf(reopened, second)];
    const source = reopened.nodes[contentRootOf(reopened, first)];
    expect(destination?.kind).toBe('group');
    expect(source?.kind).toBe('group');
    if (destination?.kind !== 'group' || source?.kind !== 'group') return;

    expect(destination.children).toContain('moved-rect');
    expect(source.children).not.toContain('moved-rect');
    expect(reopened.nodes['moved-rect']).toBeDefined();
    // Exactly one page owns it — a duplicated child reference would render twice
    // and delete twice.
    const owners = (reopened.pages ?? []).filter((page) => {
      const root = reopened.nodes[page.contentRoot];
      return root?.kind === 'group' && root.children.includes('moved-rect');
    });
    expect(owners).toHaveLength(1);
    expect(owners[0]?.id).toBe(second);
  });

  it('survives a second reopen without drifting', () => {
    const { doc: base, second } = docWithTwoPages();
    const rect = makeShapeNode('moved-rect', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const doc = {
      ...base,
      nodes: { ...base.nodes, 'moved-rect': rect },
      rootChildren: [...base.rootChildren, 'moved-rect'],
    } as Document;

    const moved = reparentNode(doc, 'moved-rect', contentRootOf(doc, second), 0);
    const once = reopen(moved);
    const twice = reopen(once);

    const root = twice.nodes[contentRootOf(twice, second)];
    expect(root?.kind).toBe('group');
    if (root?.kind !== 'group') return;
    expect(root.children.filter((child) => child === 'moved-rect')).toHaveLength(1);
  });

  it('preserves a cross-page move of a subtree with children', () => {
    const { doc: base, second } = docWithTwoPages();
    const child = makeShapeNode('child-rect', { kind: 'rect', x: 1, y: 1, w: 5, h: 5 });
    const parent = {
      id: 'moved-group',
      kind: 'group' as const,
      name: 'Moved group',
      transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
      children: ['child-rect'],
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      rotation: 0,
    };
    const doc = {
      ...base,
      nodes: { ...base.nodes, 'moved-group': parent, 'child-rect': child },
      rootChildren: [...base.rootChildren, 'moved-group'],
    } as unknown as Document;

    const moved = reparentNode(doc, 'moved-group', contentRootOf(doc, second), 0);
    const reopened = reopen(moved);

    const root = reopened.nodes[contentRootOf(reopened, second)];
    expect(root?.kind).toBe('group');
    if (root?.kind !== 'group') return;
    expect(root.children).toContain('moved-group');
    const group = reopened.nodes['moved-group'];
    expect(group?.kind).toBe('group');
    if (group?.kind !== 'group') return;
    expect(group.children).toEqual(['child-rect']);
    expect(reopened.nodes['child-rect']).toBeDefined();
  });
});
