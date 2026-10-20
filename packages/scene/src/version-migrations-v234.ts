/** v2.33 → v2.34 additive text-frame appearance; legacy text stays unstyled. */
export function migrateV233ToV234(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, formatVersion: '2.34' };
}
