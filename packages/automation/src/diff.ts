/**
 * Structural diff helpers over immutable documents.
 *
 * The executor and the headless authority derive created/changed/deleted sets
 * and rollback conflicts from the documents themselves, not from lists a
 * command reports, so a command bug cannot make a receipt or an undo lie.
 */
import type { Document } from '@varve/scene';

export interface Touched {
  nodes: Set<string>;
  fields: Set<string>;
}

/** Document fields that are bookkeeping, not authored state; never rolled back. */
export const BOOKKEEPING_FIELDS: ReadonlySet<string> = new Set(['nodes', 'nextId']);

/**
 * Entities whose content differs between two documents. Reference inequality
 * is the fast path; value equality is the tie-breaker so an operation that
 * rebuilds an equal array or node does not register as a change.
 */
export function touchedBetween(before: Document, after: Document): Touched {
  const nodes = new Set<string>();
  for (const id of Object.keys(before.nodes)) {
    const a = before.nodes[id];
    const b = after.nodes[id];
    if (a !== b && !deepEqual(a, b)) nodes.add(id);
  }
  for (const id of Object.keys(after.nodes)) {
    if (!(id in before.nodes)) nodes.add(id);
  }
  const fields = new Set<string>();
  const left = before as unknown as Record<string, unknown>;
  const right = after as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (BOOKKEEPING_FIELDS.has(key)) continue;
    if (left[key] !== right[key] && !deepEqual(left[key], right[key])) fields.add(key);
  }
  return { nodes, fields };
}

export function deepEqual(a: unknown, b: unknown, depth = 0): boolean {
  if (a === b) return true;
  if (depth > 64) return false;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b);
  }
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (aIsArray) {
    const left = a as unknown[];
    const right = b as unknown[];
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
      if (!deepEqual(left[i], right[i], depth + 1)) return false;
    }
    return true;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined);
  const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!deepEqual(left[key], right[key], depth + 1)) return false;
  }
  return true;
}
