import { NonFiniteDocumentError } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { saveFailureIssue } from './saveIssues';

describe('saveFailureIssue', () => {
  it('names the non-finite field and offers a recovery path instead of a generic I/O error', () => {
    const issue = saveFailureIssue(
      new NonFiniteDocumentError([
        { path: 'nodes.shape.opacity', value: Number.POSITIVE_INFINITY },
        { path: 'pages[0].w', value: Number.NaN },
      ]),
    );

    expect(issue.category).toBe('serialization-failed');
    expect(issue.message).toContain('nodes.shape.opacity = Infinity');
    expect(issue.message).toContain('pages[0].w = NaN');
    expect(issue.message).toContain('Undo the change that produced it');
    expect(issue.message).not.toContain('unknown');
  });

  it('summarizes additional offending fields', () => {
    const issue = saveFailureIssue(
      new NonFiniteDocumentError([
        { path: 'a', value: Number.POSITIVE_INFINITY },
        { path: 'b', value: Number.POSITIVE_INFINITY },
        { path: 'c', value: Number.POSITIVE_INFINITY },
        { path: 'd', value: Number.NEGATIVE_INFINITY },
      ]),
    );

    expect(issue.message).toContain('a = Infinity');
    expect(issue.message).toContain('c = Infinity');
    expect(issue.message).toContain('and 1 more');
    expect(issue.message).not.toContain('d = -Infinity');
  });

  it('keeps other exceptions as the generic I/O category', () => {
    expect(saveFailureIssue(new Error('disk exploded'))).toEqual({
      category: 'unknown-io',
      message: 'disk exploded',
    });
    expect(saveFailureIssue('not an error')).toEqual({
      category: 'unknown-io',
      message: 'not an error',
    });
  });
});
