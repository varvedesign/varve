/** drawClusters: kerning-off cluster layout and glyph adjustments. */
import { describe, expect, it } from 'vitest';
import { drawClusters } from './replay';
import { Recorder } from './replay.test-helpers';
import type { RenderItem } from './types';

describe('drawClusters (kerning-off and glyph adjustments)', () => {
  const basePrimitive: Extract<RenderItem['primitive'], { kind: 'text' }> = {
    kind: 'text',
    text: 'ABC',
    fontSize: 16,
    fontFamily: 'Inter',
    fontWeight: 400,
    fontStyle: 'normal',
    textAlign: 'left',
    textAlignVertical: 'top',
    letterSpacing: 0,
    lineHeight: 1.4,
    paragraphSpacing: 0,
    textCase: 'none',
    textDecoration: 'none',
    textOverflow: 'visible',
    listStyle: 'none',
    x: 0,
    y: 0,
    w: 100,
    h: 20,
  };

  function recorderTarget(): Recorder {
    const rec = new Recorder();
    rec.textBaseline = 'top';
    rec.textAlign = 'left';
    rec.font = '400 16px "Inter"';
    return rec;
  }

  it('draws one fillText per cluster (kerning off between clusters)', () => {
    const rec = recorderTarget();
    drawClusters(rec, 'ABC', 0, 0, 0, 0, basePrimitive, () => 10);
    expect(rec.calls.filter((c) => c.startsWith('fillText'))).toEqual([
      'fillText("A",0,0)',
      'fillText("B",10,0)',
      'fillText("C",20,0)',
    ]);
    expect(rec.calls).not.toContain('fillText("ABC",0,0)');
  });

  it('applies pair adjustments to the following cluster advance', () => {
    const rec = recorderTarget();
    drawClusters(rec, 'ABC', 0, 0, 0, 0, { ...basePrimitive, pairAdjustments: { 0: 5 } }, () => 10);
    expect(rec.calls).toContain('fillText("A",0,0)');
    expect(rec.calls).toContain('fillText("B",15,0)');
    expect(rec.calls).toContain('fillText("C",25,0)');
  });

  it('applies glyph offset via translate and draws at local origin', () => {
    const rec = recorderTarget();
    drawClusters(
      rec,
      'AB',
      0,
      0,
      0,
      0,
      {
        ...basePrimitive,
        glyphAdjustments: { 1: { dx: 3, dy: -2, advance: 0, rotation: 0, scaleX: 1, scaleY: 1 } },
      },
      () => 10,
    );
    expect(rec.calls).toContain('translate(13,-2)');
    expect(rec.calls).toContain('fillText("B",0,0)');
  });

  it('applies rotation and scale transforms', () => {
    const rec = recorderTarget();
    drawClusters(
      rec,
      'AB',
      0,
      0,
      0,
      0,
      {
        ...basePrimitive,
        glyphAdjustments: {
          0: { dx: 0, dy: 0, advance: 0, rotation: 0.5, scaleX: 1.5, scaleY: 1 },
        },
      },
      () => 10,
    );
    expect(rec.calls).toContain('translate(0,0)');
    expect(rec.calls).toContain('rotate(0.5)');
    expect(rec.calls).toContain('scale(1.5,1)');
  });

  it('advance override shifts following clusters', () => {
    const rec = recorderTarget();
    drawClusters(
      rec,
      'ABC',
      0,
      0,
      0,
      0,
      {
        ...basePrimitive,
        glyphAdjustments: { 0: { dx: 0, dy: 0, advance: 7, rotation: 0, scaleX: 1, scaleY: 1 } },
      },
      () => 10,
    );
    expect(rec.calls).toContain('fillText("B",17,0)');
  });

  it('adds letterSpacing and tracking to every cluster advance', () => {
    const rec = recorderTarget();
    drawClusters(rec, 'AB', 0, 0, 2, 1, basePrimitive, () => 10);
    expect(rec.calls).toContain('fillText("B",13,0)');
  });
});
