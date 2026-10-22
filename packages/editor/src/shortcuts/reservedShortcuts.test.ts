import { describe, expect, it } from 'vitest';
import {
  getReservedShortcutsForTarget,
  isBrowserReservedBinding,
  isTauriRuntime,
} from './reservedShortcuts';

describe('reservedShortcuts', () => {
  it('returns browser reserved shortcuts outside Tauri', () => {
    expect(isTauriRuntime()).toBe(false);
    const info = getReservedShortcutsForTarget();
    expect(info.target).toBe('browser');
    expect(info.shortcuts.length).toBeGreaterThan(0);
    expect(info.shortcuts.some((s) => s.keys.includes('Ctrl/Cmd+W'))).toBe(true);
    expect(info.shortcuts.some((s) => s.keys === 'Ctrl/Cmd+Shift+H')).toBe(true);
    expect(info.shortcuts.some((s) => s.keys === 'Ctrl/Cmd+Shift+O')).toBe(true);
  });

  it('recognizes browser-reserved history and bookmark chords without blocking the replacement chords', () => {
    expect(isBrowserReservedBinding({ key: 'h', ctrl: true, shift: true })).toBe(true);
    expect(isBrowserReservedBinding({ key: 'o', ctrl: true, shift: true })).toBe(true);
    expect(isBrowserReservedBinding({ key: 'h', ctrl: true, alt: true, shift: true })).toBe(false);
  });
});
