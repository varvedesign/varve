import {
  addChild,
  addNode,
  createDocument,
  DEFAULT_EMAIL_PROFILE,
  DEFAULT_EMAIL_SEMANTIC_MAP,
  makeFrameNode,
  makeTextNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { emailPreflightResult } from './emailPreflight';
import { getEmailCompilation } from './Inspector/panels/emailCompilation';

function overlappingEmailDocument() {
  let doc = createDocument('email-status', true);
  const root = makeFrameNode('email-root', { name: 'Email', w: 600, h: 200 });
  const headline = makeTextNode('headline', 'Headline', {
    transform: [1, 0, 0, 1, 0, 0],
    w: 400,
    h: 120,
  });
  const caption = makeTextNode('caption', 'Caption', {
    transform: [1, 0, 0, 1, 200, 40],
    w: 300,
    h: 120,
  });
  doc = addNode(doc, root);
  doc = addChild(doc, root.id, headline);
  doc = addChild(doc, root.id, caption);
  return {
    ...doc,
    emailProfile: DEFAULT_EMAIL_PROFILE,
    emailSemantics: {
      ...DEFAULT_EMAIL_SEMANTIC_MAP,
      nodeLinks: {
        headline: { kind: 'web' as const, url: '' },
      },
    },
  };
}

describe('emailPreflightResult', () => {
  it('counts compiler diagnostics, not print bleed', () => {
    const doc = overlappingEmailDocument();
    const compilation = getEmailCompilation(doc);
    const result = emailPreflightResult(doc);
    const diagnosticErrors =
      compilation?.ir.diagnostics.filter((item) => item.severity === 'error').length ?? 0;
    const outputErrors =
      compilation?.output.warnings.filter((item) => item.severity === 'error').length ?? 0;

    expect(result.errorCount).toBe(diagnosticErrors + outputErrors);
    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.issues.some((issue) => /url is empty/i.test(issue.message))).toBe(true);
    expect(result.issues.every((issue) => issue.source === 'email')).toBe(true);
    expect(result.issues.some((issue) => /bleed/i.test(issue.message))).toBe(false);
  });

  it('does not compile an unprofiled document for the status-bar count', () => {
    const doc = createDocument('no-email-profile', true);
    expect(getEmailCompilation(doc)).toBeNull();
    const result = emailPreflightResult(doc);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.issues).toEqual([]);
  });
});
