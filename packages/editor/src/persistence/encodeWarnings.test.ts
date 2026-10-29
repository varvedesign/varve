import { createDocument, makeGroupNode, makeShapeNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeDocumentJson, setEncodeWarningToast } from './encodeWarnings';

describe('encodeWarnings', () => {
  afterEach(() => {
    setEncodeWarningToast(undefined);
  });

  it('logs encode warnings and toasts a given message only once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const toast = vi.fn();
    setEncodeWarningToast(toast);
    const content = makeShapeNode('content', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 });
    const group = makeGroupNode('clip', { children: ['content'] });
    group.mask = { type: 'clip', sourceNodeId: 'missing', visible: true };
    const doc = {
      ...createDocument('Broken mask encode', true),
      nodes: { clip: group, content },
      rootChildren: ['clip'],
    };

    encodeDocumentJson(doc);
    encodeDocumentJson(doc);

    expect(warn.mock.calls.length).toBeGreaterThan(0);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(String(toast.mock.calls[0]?.[0])).toMatch(/clip|mask/i);
    warn.mockRestore();
  });
});
