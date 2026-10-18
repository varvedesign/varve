import { describe, expect, it } from 'vitest';
import { applyConstraints, defaultConstraints } from '../constraints';

describe('defaultConstraints', () => {
  it('returns min/min defaults', () => {
    const c = defaultConstraints();
    expect(c.horizontal).toBe('min');
    expect(c.vertical).toBe('min');
  });
});

describe('applyConstraints', () => {
  const child = { x: 10, y: 20, w: 80, h: 60 };

  it('min: keeps position unchanged', () => {
    const r = applyConstraints({ horizontal: 'min', vertical: 'min' }, child, 200, 300, 400, 600);
    expect(r.x).toBe(10);
    expect(r.y).toBe(20);
    expect(r.w).toBe(80);
    expect(r.h).toBe(60);
  });

  it('max: pins to right/bottom edge', () => {
    const r = applyConstraints({ horizontal: 'max', vertical: 'max' }, child, 200, 300, 400, 600);
    expect(r.x).toBe(210);
    expect(r.y).toBe(320);
    expect(r.w).toBe(80);
    expect(r.h).toBe(60);
  });

  it('stretch: maintains margins from both edges', () => {
    const r = applyConstraints(
      { horizontal: 'stretch', vertical: 'stretch' },
      child,
      200,
      300,
      400,
      600,
    );
    expect(r.x).toBe(10);
    expect(r.y).toBe(20);
    expect(r.w).toBe(280);
    expect(r.h).toBe(360);
  });

  it('scale: scales position and size proportionally', () => {
    const r = applyConstraints(
      { horizontal: 'scale', vertical: 'scale' },
      child,
      200,
      300,
      400,
      600,
    );
    expect(r.x).toBe(20);
    expect(r.y).toBe(40);
    expect(r.w).toBe(160);
    expect(r.h).toBe(120);
  });

  it('center: keeps relative centered position', () => {
    const r = applyConstraints(
      { horizontal: 'center', vertical: 'center' },
      child,
      200,
      300,
      400,
      600,
    );
    expect(r.x).toBeCloseTo(26.67, 1);
    expect(r.y).toBeCloseTo(45, 0);
  });

  it('centerOffset: preserves the child center offset during parent resize', () => {
    const r = applyConstraints(
      { horizontal: 'centerOffset', vertical: 'centerOffset' },
      { x: 60, y: 30, w: 40, h: 20 },
      200,
      100,
      300,
      200,
    );
    expect(r).toEqual({ x: 110, y: 80, w: 40, h: 20 });
  });

  it('keeps center proportional placement distinct from centerOffset', () => {
    const r = applyConstraints(
      { horizontal: 'center', vertical: 'center' },
      { x: 60, y: 30, w: 40, h: 20 },
      200,
      100,
      300,
      200,
    );
    expect(r).toEqual({ x: 97.5, y: 67.5, w: 40, h: 20 });
  });

  it('handles zero-size parent gracefully', () => {
    const r = applyConstraints({ horizontal: 'scale', vertical: 'scale' }, child, 0, 0, 400, 600);
    expect(r.x).toBe(10);
    expect(r.y).toBe(20);
    expect(r.w).toBe(80);
    expect(r.h).toBe(60);
  });
});
