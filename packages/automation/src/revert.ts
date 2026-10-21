/**
 * Three-way revert of one transaction onto the current document.
 *
 * Given `base` (the document before the transaction), `after` (the document it
 * produced) and `current` (where the document is now, possibly with later and
 * unrelated work on top), compute a document in which the transaction's effect
 * is undone and everything else is kept. This is how an agent can take back
 * its own change without popping the last N edits and erasing a person's work.
 *
 * Rules, per entity and per field:
 * - A field the transaction did not change is left exactly as it is now.
 * - A field it changed that still holds the value it set is restored.
 * - A list of ids (a container's children, the root order) is reverted as a
 *   set: the transaction's additions are removed and its removals restored,
 *   while items other work added are kept.
 * - A field later work changed to something else is a conflict. Nothing is
 *   written, and the conflicting entities are reported.
 * - A node the transaction created is removed only if it is still exactly as
 *   created; a later edit to it is a conflict.
 * After merging, any child reference that would dangle is a conflict too.
 */
import type { Document } from '@varve/scene';
import { BOOKKEEPING_FIELDS, deepEqual, touchedBetween } from './diff';

export interface RevertConflict {
  entity: string;
  reason: string;
}

export type RevertResult =
  | { ok: true; doc: Document; restored: string[] }
  | { ok: false; conflicts: RevertConflict[] };

type Rec = Record<string, unknown>;

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function mergeIdList(base: string[], after: string[], current: string[]): string[] | null {
  const baseSet = new Set(base);
  const afterSet = new Set(after);
  const added = new Set(after.filter((id) => !baseSet.has(id)));
  const removed = base.filter((id) => !afterSet.has(id));

  if (added.size === 0 && removed.length === 0) {
    // Pure reorder: restore only if nobody reordered since.
    return deepEqual(current, after) ? [...base] : null;
  }

  const result = current.filter((id) => !added.has(id));
  const present = new Set(result);
  for (const id of removed) {
    if (present.has(id)) continue;
    const at = base.indexOf(id);
    let insertAfter = -1;
    for (let i = at - 1; i >= 0; i--) {
      const idx = result.indexOf(base[i] as string);
      if (idx >= 0) {
        insertAfter = idx;
        break;
      }
    }
    result.splice(insertAfter + 1, 0, id);
    present.add(id);
  }
  return result;
}

function mergeRecord(
  base: Rec,
  after: Rec,
  current: Rec,
  ignore: ReadonlySet<string>,
  path: string,
  conflicts: RevertConflict[],
): Rec {
  const out: Rec = { ...current };
  const keys = new Set([...Object.keys(base), ...Object.keys(after)]);
  for (const key of keys) {
    if (ignore.has(key)) continue;
    const b = base[key];
    const a = after[key];
    if (deepEqual(b, a)) continue; // the transaction did not touch this field
    const c = current[key];
    if (deepEqual(c, a)) {
      if (b === undefined) delete out[key];
      else out[key] = b;
      continue;
    }
    if (isIdList(b ?? []) && isIdList(a ?? []) && isIdList(c ?? [])) {
      const merged = mergeIdList(
        (b as string[]) ?? [],
        (a as string[]) ?? [],
        (c as string[]) ?? [],
      );
      if (merged !== null) {
        out[key] = merged;
        continue;
      }
    }
    conflicts.push({
      entity: path,
      reason: `field "${key}" was changed again after this transaction`,
    });
  }
  return out;
}

/** Child references in `doc` that name a node which does not exist. */
function danglingReferences(doc: Document): Set<string> {
  const dangling = new Set<string>();
  const check = (owner: string, ids: unknown): void => {
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
      if (typeof id === 'string' && doc.nodes[id] === undefined) dangling.add(`${owner}>${id}`);
    }
  };
  check('document', doc.rootChildren);
  check('document-global', doc.globalChildren);
  for (const [id, node] of Object.entries(doc.nodes)) {
    check(id, (node as unknown as { children?: unknown }).children);
  }
  return dangling;
}

export function revertTransaction(
  current: Document,
  base: Document,
  after: Document,
): RevertResult {
  const conflicts: RevertConflict[] = [];
  const touched = touchedBetween(base, after);
  const nodes = { ...current.nodes };
  const restored: string[] = [];

  for (const id of touched.nodes) {
    const b = base.nodes[id];
    const a = after.nodes[id];
    const c = current.nodes[id];
    if (b === undefined) {
      // Created by the transaction.
      if (c === undefined) continue;
      if (deepEqual(c, a)) {
        delete nodes[id];
        restored.push(id);
      } else {
        conflicts.push({ entity: id, reason: 'was edited after it was created' });
      }
    } else if (a === undefined) {
      // Deleted by the transaction.
      if (c === undefined) {
        nodes[id] = b;
        restored.push(id);
      } else {
        conflicts.push({ entity: id, reason: 'was re-created after it was deleted' });
      }
    } else {
      if (c === undefined) {
        conflicts.push({ entity: id, reason: 'was deleted after this transaction changed it' });
        continue;
      }
      const merged = mergeRecord(
        b as unknown as Rec,
        a as unknown as Rec,
        c as unknown as Rec,
        new Set(),
        id,
        conflicts,
      );
      if (!deepEqual(merged, c)) {
        nodes[id] = merged as unknown as (typeof nodes)[string];
        restored.push(id);
      }
    }
  }

  const merged = mergeRecord(
    base as unknown as Rec,
    after as unknown as Rec,
    current as unknown as Rec,
    BOOKKEEPING_FIELDS,
    'document',
    conflicts,
  );
  for (const field of touched.fields) {
    if (!deepEqual(merged[field], (current as unknown as Rec)[field]))
      restored.push(`field:${field}`);
  }

  if (conflicts.length > 0) return { ok: false, conflicts };

  const next = { ...merged, nodes } as unknown as Document;
  const before = danglingReferences(current);
  for (const reference of danglingReferences(next)) {
    if (!before.has(reference)) {
      const [owner] = reference.split('>');
      conflicts.push({
        entity: owner as string,
        reason: `would reference a node this rollback removes (${reference.split('>')[1]})`,
      });
    }
  }
  if (conflicts.length > 0) return { ok: false, conflicts };
  return { ok: true, doc: next, restored };
}
