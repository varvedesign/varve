import { describe, expect, it } from 'vitest';
import {
  DERIVED_WORK_HOST_RESERVE_BYTES,
  DERIVED_WORK_MAX_TRACKED_BYTES,
  DERIVED_WORK_MIN_TRACKED_BYTES,
  deriveDerivedWorkBudgetBytes,
} from './hostMemory';

const GIB = 1024 * 1024 * 1024;

describe('deriveDerivedWorkBudgetBytes', () => {
  it('keeps the conservative floor when the host reports nothing', () => {
    expect(deriveDerivedWorkBudgetBytes(null)).toBe(DERIVED_WORK_MIN_TRACKED_BYTES);
    expect(deriveDerivedWorkBudgetBytes(0)).toBe(DERIVED_WORK_MIN_TRACKED_BYTES);
    expect(deriveDerivedWorkBudgetBytes(-1)).toBe(DERIVED_WORK_MIN_TRACKED_BYTES);
    expect(deriveDerivedWorkBudgetBytes(Number.NaN)).toBe(DERIVED_WORK_MIN_TRACKED_BYTES);
  });

  it('never drops below the historical ceiling on a constrained host', () => {
    // 2 GB available is fully absorbed by the app-and-OS reserve, so the floor
    // wins instead of a negative or near-zero budget.
    expect(deriveDerivedWorkBudgetBytes(2 * GIB)).toBe(DERIVED_WORK_MIN_TRACKED_BYTES);
    // 2.5 GB leaves 512 MB, which is above the floor but still modest.
    expect(deriveDerivedWorkBudgetBytes(2.5 * GIB)).toBe(Math.floor(0.5 * GIB));
    expect(deriveDerivedWorkBudgetBytes(2.5 * GIB)).toBeGreaterThan(DERIVED_WORK_MIN_TRACKED_BYTES);
  });

  it('grants headroom above the floor as measured memory grows', () => {
    expect(deriveDerivedWorkBudgetBytes(6 * GIB)).toBe(4 * GIB);
    expect(deriveDerivedWorkBudgetBytes(10 * GIB)).toBe(8 * GIB);
    // The exact case that used to be refused: a 480x640 ai-quality request
    // reserves ~454 MB, which a 4 GB host budget must admit.
    expect(deriveDerivedWorkBudgetBytes(6 * GIB)).toBeGreaterThan(454 * 1024 * 1024);
  });

  it('caps absurd host values and subtracts the reserve exactly once', () => {
    const available = 64 * GIB;
    expect(deriveDerivedWorkBudgetBytes(available)).toBe(DERIVED_WORK_MAX_TRACKED_BYTES);
    const modest = 5 * GIB;
    expect(deriveDerivedWorkBudgetBytes(modest)).toBe(modest - DERIVED_WORK_HOST_RESERVE_BYTES);
  });

  it('returns safe integers only', () => {
    const budget = deriveDerivedWorkBudgetBytes(7.9 * GIB);
    expect(Number.isSafeInteger(budget)).toBe(true);
    expect(Number.isInteger(budget)).toBe(true);
  });
});
