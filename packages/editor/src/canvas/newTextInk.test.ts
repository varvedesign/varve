import {
  addNode,
  createDocument,
  DARK_TEXT_INK,
  LIGHT_TEXT_INK,
  makeFrameNode,
} from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newTextInk } from './newTextInk';

// Stand-in for the one-pixel canvas that resolves the board token: it reports
// whatever colour the test assigns to `boardPixel`.
let boardPixel: [number, number, number] = [11, 14, 20];
class FakeOffscreenCanvas {
  getContext() {
    return {
      fillStyle: '',
      fillRect() {},
      getImageData: () => ({ data: new Uint8ClampedArray([...boardPixel, 255]) }),
    };
  }
}

// jsdom does not resolve custom properties in computed style, so the theme
// token is supplied directly.
function withToken(token: string) {
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => (name === '--color-surface-sunken' ? token : ''),
  }));
}

function withBoard(token: string, pixel: [number, number, number]) {
  boardPixel = pixel;
  withToken(token);
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newTextInk', () => {
  it('gives text on the dark board the light ink', () => {
    withBoard('oklch(0.12 0.01 260)', [11, 14, 20]);
    expect(newTextInk(createDocument('Test', true), null, 'design')).toEqual(LIGHT_TEXT_INK);
  });

  it('gives text on the light board the dark ink', () => {
    withBoard('oklch(0.95 0.01 260)', [236, 238, 243]);
    expect(newTextInk(createDocument('Test', true), null, 'design')).toEqual(DARK_TEXT_INK);
  });

  it('follows a white frame the text is placed in, whatever the theme', () => {
    withBoard('oklch(0.13 0.01 260)', [11, 14, 20]);
    const doc = addNode(
      createDocument('Test', true),
      makeFrameNode('card', { fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } }),
    );
    expect(newTextInk(doc, 'card', 'design')).toEqual(DARK_TEXT_INK);
  });

  it('keeps the scene default on print pages, which are paper whatever the theme', () => {
    withBoard('oklch(0.14 0.01 260)', [11, 14, 20]);
    expect(newTextInk(createDocument(), null, 'print')).toBeUndefined();
  });

  it('keeps the scene default when no canvas can resolve the board colour', () => {
    withToken('oklch(0.15 0 0)');
    vi.stubGlobal('OffscreenCanvas', undefined);
    expect(newTextInk(createDocument('Test', true), null, 'design')).toBeUndefined();
  });
});
