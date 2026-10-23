import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Boot/lazy wiring for the host budget.
 *
 * The gate itself is covered elsewhere; these tests exist because the reported
 * defect is only fixed if the *measurement reaches the singleton*. Reverting
 * `initializeDerivedWorkBudget()` or its lazy call must fail here.
 */

const GIB = 1024 * 1024 * 1024;

const probe = vi.hoisted(() => vi.fn());

vi.mock('./hostMemory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hostMemory')>();
  return { ...actual, probeHostMemory: probe };
});

import {
  DerivedWorkAdmission,
  getDerivedWorkAdmission,
  initializeDerivedWorkBudget,
  resetDerivedWorkBudgetInitialization,
  setDerivedWorkAdmissionForTest,
  setDerivedWorkMemoryProfile,
} from './derivedWorkAdmission';

describe('initializeDerivedWorkBudget', () => {
  beforeEach(() => {
    probe.mockReset();
    probe.mockResolvedValue({ availableBytes: 8 * GIB, source: 'native' });
    setDerivedWorkAdmissionForTest(null);
    resetDerivedWorkBudgetInitialization();
  });

  it('applies the measured host budget to the process gate', async () => {
    expect(getDerivedWorkAdmission().snapshot()).toMatchObject({
      budgetSource: 'conservative-default',
    });

    const snapshot = await initializeDerivedWorkBudget();

    expect(snapshot).toMatchObject({
      maxReservedBytes: 6 * GIB,
      budgetSource: 'host-measured',
    });
    expect(getDerivedWorkAdmission().snapshot().maxReservedBytes).toBe(6 * GIB);
  });

  it('measures the host exactly once across repeated calls', async () => {
    await Promise.all([initializeDerivedWorkBudget(), initializeDerivedWorkBudget()]);
    await initializeDerivedWorkBudget();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('admits work that was waiting for a larger budget', async () => {
    const gate = new DerivedWorkAdmission({ maxConcurrent: 2 });
    setDerivedWorkAdmissionForTest(gate);
    const holder = await gate.acquire({
      id: 'holder',
      kind: 'inference',
      priority: 'visible',
      estimatedBytes: 250_000_000,
    });
    const waiting = gate.acquire({
      id: 'waiting',
      kind: 'inference',
      priority: 'visible',
      estimatedBytes: 180_000_000,
    });
    // 250 + 180 exceeds the placeholder, so it waits for bytes rather than for
    // a slot. Measurement must release it without any caller action.
    expect(gate.snapshot()).toMatchObject({ active: 1, pending: 1 });

    await initializeDerivedWorkBudget();

    const lease = await waiting;
    expect(lease.id).toBe('waiting');
    expect(gate.snapshot().maxReservedBytes).toBe(6 * GIB);
    lease.release();
    holder.release();
  });

  it('keeps an owner-selected reference profile instead of overwriting it', async () => {
    setDerivedWorkMemoryProfile('reference-8gb');
    await initializeDerivedWorkBudget();
    expect(getDerivedWorkAdmission().snapshot()).toMatchObject({
      maxReservedBytes: 600_000_000,
      budgetSource: 'reference-profile',
    });
  });

  it('restores the lazily-measured singleton after a test override is removed', async () => {
    setDerivedWorkAdmissionForTest(new DerivedWorkAdmission({ maxReservedBytes: 1234 }));
    expect(getDerivedWorkAdmission().snapshot().maxReservedBytes).toBe(1234);

    setDerivedWorkAdmissionForTest(null);
    resetDerivedWorkBudgetInitialization();
    await initializeDerivedWorkBudget();

    expect(getDerivedWorkAdmission().snapshot()).toMatchObject({
      maxReservedBytes: 6 * GIB,
      budgetSource: 'host-measured',
    });
  });

  it('keeps the conservative floor when the probe finds nothing', async () => {
    probe.mockResolvedValue({ availableBytes: null, source: 'unavailable' });
    await initializeDerivedWorkBudget();
    expect(getDerivedWorkAdmission().snapshot()).toMatchObject({
      maxReservedBytes: 400_000_000,
      budgetSource: 'conservative-default',
    });
  });
});
