import { createDocument, makeGroupNode, makeShapeNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearEncodeWarningState,
  encodeDocumentJson,
  setEncodeWarningToast,
} from './encodeWarnings';

function brokenMaskDoc() {
  const content = makeShapeNode('content', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 });
  const group = makeGroupNode('clip', { children: ['content'] });
  group.mask = { type: 'clip', sourceNodeId: 'missing', visible: true };
  return {
    ...createDocument('Broken mask encode', true),
    nodes: { clip: group, content },
    rootChildren: ['clip'],
  };
}

describe('encodeWarnings', () => {
  afterEach(() => {
    setEncodeWarningToast(undefined);
    clearEncodeWarningState();
  });

  it('logs encode warnings and toasts a given message only once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const toast = vi.fn();
    setEncodeWarningToast(toast);
    const doc = brokenMaskDoc();

    encodeDocumentJson(doc);
    const warned = warn.mock.calls.length;
    expect(warned).toBeGreaterThan(0);
    encodeDocumentJson(doc);

    expect(warn).toHaveBeenCalledTimes(warned);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(String(toast.mock.calls[0]?.[0])).toMatch(/clip|mask/i);
    warn.mockRestore();
  });

  it('toasts the same warning again after encode state is cleared', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const toast = vi.fn();
    setEncodeWarningToast(toast);
    const doc = brokenMaskDoc();

    encodeDocumentJson(doc);
    const warned = warn.mock.calls.length;
    expect(warned).toBeGreaterThan(0);
    clearEncodeWarningState();
    encodeDocumentJson(doc);

    expect(warn).toHaveBeenCalledTimes(warned * 2);
    expect(toast).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
