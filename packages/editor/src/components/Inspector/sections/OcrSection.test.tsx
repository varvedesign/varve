import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  addChild,
  addNode,
  createDocument,
  type Document,
  getParent,
  makeFrameNode,
  makeImageShapeNode,
  type ShapeNode,
  type TextNode,
} from '@varve/scene';
import { applyAffine } from '@varve/shared';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nodeWorldTransform } from '../../../scene/world';
import { OcrSection } from './OcrSection';

const boundary = vi.hoisted(() => ({
  available: vi.fn(),
  download: vi.fn(),
  announce: vi.fn(),
  recognize: vi.fn(),
  document: null as Document | null,
  updateDoc: vi.fn(),
}));
vi.mock('../../../context', () => ({
  useEditor: () => ({
    state: { document: boundary.document, workspaceMode: 'photo' },
    announce: boundary.announce,
    updateDoc: boundary.updateDoc,
  }),
}));
vi.mock('@varve/engine', async (original) => ({
  ...(await original<typeof import('@varve/engine')>()),
  getModelLoader: () => ({
    isModelAvailable: boundary.available,
    downloadModel: boundary.download,
  }),
  getImageCache: () => ({ load: async () => ({ width: 400, height: 200 }) }),
  cachedImageDims: () => ({ width: 400, height: 200 }),
  runOcrPipeline: boundary.recognize,
}));
vi.mock('../controls/DisclosureSection', () => ({
  DisclosureSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

const image = makeImageShapeNode('image', { src: 'data:image/png;base64,fixture', w: 432, h: 82 });
beforeEach(() => {
  boundary.available.mockReset().mockResolvedValue(false);
  boundary.download.mockReset().mockResolvedValue(undefined);
  boundary.announce.mockReset();
  boundary.document = null;
  boundary.updateDoc.mockReset().mockImplementation((update: (doc: Document) => Document) => {
    boundary.document = update(boundary.document!);
  });
  boundary.recognize.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OCR resource readiness', () => {
  it('requires the dictionary as well as both executable graphs', async () => {
    boundary.available.mockImplementation(async (id: string) => id !== 'paddleocr-keys-v1');
    render(<OcrSection nodes={[image]} />);
    await waitFor(() => expect(boundary.available).toHaveBeenCalledWith('paddleocr-rec-v4'));
    expect(screen.queryByRole('button', { name: 'Recognize text in image' })).toBeNull();
    expect(screen.getByRole('button', { name: /Download OCR models/i })).toBeVisible();
  });

  it('acquires all three resources and keeps a dictionary failure recoverable', async () => {
    boundary.download.mockImplementation(async (id: string) => {
      if (id === 'paddleocr-keys-v1') throw new Error('Dictionary download interrupted');
    });
    render(<OcrSection nodes={[image]} />);
    fireEvent.click(screen.getByRole('button', { name: /Download OCR models/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Dictionary download interrupted');
    expect(boundary.download.mock.calls.map(([id]) => id)).toEqual([
      'paddleocr-det-v4',
      'paddleocr-rec-v4',
      'paddleocr-keys-v1',
    ]);
    expect(screen.queryByRole('button', { name: 'Recognize text in image' })).toBeNull();
  });

  it('aborts acquisition on unmount and ignores a late success', async () => {
    let finish: () => void = () => {};
    let signal: AbortSignal | undefined;
    boundary.download.mockImplementation((_id: string, _progress: unknown, abort: AbortSignal) => {
      signal = abort;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const { unmount } = render(<OcrSection nodes={[image]} />);
    fireEvent.click(screen.getByRole('button', { name: /Download OCR models/i }));
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal!.aborted).toBe(true);
    finish();
    await Promise.resolve();
    expect(boundary.download).toHaveBeenCalledTimes(1);
    expect(boundary.announce).not.toHaveBeenCalled();
  });
});

async function recognizeAndApply(node: ShapeNode): Promise<TextNode> {
  boundary.available.mockResolvedValue(true);
  boundary.recognize.mockResolvedValue({
    words: [
      {
        x: 120,
        y: 60,
        width: 100,
        height: 20,
        text: 'Hello',
        confidence: 0.99,
        detectionConfidence: 0.99,
        charConfidences: [],
      },
    ],
    executionProvider: 'native-cpu',
    processingTimeMs: 1,
    dictionaryAvailable: true,
  });
  const canvasPrototype: { getContext(id: '2d'): CanvasRenderingContext2D | null } =
    HTMLCanvasElement.prototype;
  vi.spyOn(canvasPrototype, 'getContext').mockReturnValue({
    drawImage() {},
    getImageData: () => new ImageData(400, 200),
  } as unknown as CanvasRenderingContext2D);
  render(<OcrSection nodes={[node]} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Recognize text in image' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Create editable text layers' }));
  await waitFor(() => expect(boundary.updateDoc).toHaveBeenCalledTimes(1));
  const text = Object.values(boundary.document!.nodes).find((item) => item.kind === 'text');
  expect(text?.kind).toBe('text');
  return text as TextNode;
}

describe('OCR layer application', () => {
  it('uses decoded source dimensions when image metadata is absent', async () => {
    const node = makeImageShapeNode('image', { src: 'fixture', w: 200, h: 100 });
    boundary.document = addNode(createDocument('OCR'), node);
    const text = await recognizeAndApply(node);
    expect(applyAffine(text.transform, [0, 0])).toEqual([60, 30]);
    expect(applyAffine(text.transform, [text.w!, text.h!])).toEqual([110, 40]);
  });

  it('keeps text in its image parent and preserves crop scale and node rotation', async () => {
    const node = makeImageShapeNode('image', {
      src: 'fixture',
      w: 200,
      h: 100,
      imageWidth: 400,
      imageHeight: 200,
      imageFit: 'crop',
      transform: [0, 2, -2, 0, 300, 40],
    });
    node.fills![0]!.image = { ...node.fills![0]!.image!, x: -100, y: -20, scale: 1.5 };
    const parent = makeFrameNode('parent', { w: 1000, h: 1000, transform: [1, 0, 0, 1, 50, 70] });
    boundary.document = addChild(addNode(createDocument('OCR'), parent), parent.id, node);
    const text = await recognizeAndApply(node);
    expect(getParent(boundary.document!, text.id)).toBe('parent');
    const transform = nodeWorldTransform(boundary.document!, text.id);
    const origin = applyAffine(transform, [0, 0]);
    const corner = applyAffine(transform, [text.w!, text.h!]);
    expect(origin[0]).toBeCloseTo(210, 8);
    expect(origin[1]).toBeCloseTo(270, 8);
    expect(corner[0]).toBeCloseTo(150, 8);
    expect(corner[1]).toBeCloseTo(570, 8);
  });
});
