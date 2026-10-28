// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetImageCache } from './imageCache';
import { replayIr } from './replay';
import { recorder } from './replay-fill.test-helpers';
import type { RenderItem } from './types';

beforeEach(() => {
  resetImageCache();
});

afterEach(() => {
  resetImageCache();
});
describe('blend mode mapping', () => {
  const modes: [string, string][] = [
    ['multiply', 'multiply'],
    ['screen', 'screen'],
    ['overlay', 'overlay'],
    ['darken', 'darken'],
    ['lighten', 'lighten'],
    ['colorDodge', 'color-dodge'],
    ['colorBurn', 'color-burn'],
    ['hardLight', 'hard-light'],
    ['softLight', 'soft-light'],
    ['difference', 'difference'],
    ['exclusion', 'exclusion'],
    ['hue', 'hue'],
    ['saturation', 'saturation'],
    ['color', 'color'],
    ['luminosity', 'luminosity'],
  ];

  for (const [mode, expected] of modes) {
    it(`maps ${mode} to ${expected}`, () => {
      const rec = recorder();
      const item: RenderItem = {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        blendMode: mode as RenderItem['blendMode'],
        primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      };
      replayIr(rec.target, [item]);
      expect(rec.props.globalCompositeOperation).toBe('source-over');
    });
  }

  it('blendMode=normal uses source-over', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      blendMode: 'normal',
      primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    };
    const rec2 = recorder();
    replayIr(rec2.target, [item]);
    expect(rec2.props.globalCompositeOperation).toBe('source-over');
  });
});
