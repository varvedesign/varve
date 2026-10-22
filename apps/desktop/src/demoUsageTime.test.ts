import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('demo usage-time tracker', () => {
  it('stays removed so /try does not send time buckets', () => {
    expect(existsSync(new URL('./demoUsageTime.ts', import.meta.url))).toBe(false);
  });
});
