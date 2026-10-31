import { NonFiniteDocumentError } from '@varve/scene';
import type { SaveIssue } from './types';

/** How many offending fields an actionable save message names before summarizing. */
const NAMED_FIELD_LIMIT = 3;

function formatNonFinite(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  return value > 0 ? 'Infinity' : '-Infinity';
}

/**
 * Map an exception thrown while producing or writing a save payload to the
 * user-visible `SaveIssue`.
 *
 * Most save exceptions are I/O failures whose message already explains itself,
 * so they keep the generic `unknown-io` category. A non-finite document value
 * is different: `JSON.stringify` would silently write `null`, so the save is
 * refused and the message must name the field(s) and a recovery path instead of
 * reporting an anonymous I/O error.
 */
export function saveFailureIssue(error: unknown): SaveIssue {
  if (error instanceof NonFiniteDocumentError) {
    const named = error.fields
      .slice(0, NAMED_FIELD_LIMIT)
      .map(({ path, value }) => `${path || 'document'} = ${formatNonFinite(value)}`);
    const remaining = error.fields.length - named.length;
    const where = `${named.join(', ')}${remaining > 0 ? ` and ${remaining} more` : ''}`;
    return {
      category: 'serialization-failed',
      message: `This document cannot be saved because it contains a non-finite number (${where}). Undo the change that produced it, or reopen the file. Saving would replace the value with null.`,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { category: 'unknown-io', message };
}
