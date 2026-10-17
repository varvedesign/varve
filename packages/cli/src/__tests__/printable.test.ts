/**
 * Text that came out of a document must not be able to drive the terminal.
 *
 * A layer name, a text node's content or a document's name is data an author
 * (or whoever authored an imported file) chose. Printed raw to a terminal, an
 * escape sequence in it can clear the screen, retitle the window, or draw over
 * lines that said something else. The output is escaped instead, in a form that
 * is also valid inside JSON, so machine output keeps its meaning.
 */
import { describe, expect, it } from 'vitest';
import { printable } from '../run/printable';

describe('printable', () => {
  it('escapes the escape character so a control sequence is shown, not run', () => {
    expect(printable('\u001b[2J\u001b[31mred')).toBe('\\u001b[2J\\u001b[31mred');
  });

  it('escapes carriage returns, bells, backspaces and DEL', () => {
    expect(printable('a\rb\u0007c\u0008d\u007fe')).toBe('a\\u000db\\u0007c\\u0008d\\u007fe');
  });

  it('escapes C1 controls, which some terminals honour as 8-bit escapes', () => {
    expect(printable('x\u009by')).toBe('x\\u009by');
  });

  it('escapes bidirectional overrides that make text read as something else', () => {
    expect(printable('invoice‮gnp.exe')).toBe('invoice\\u202egnp.exe');
    expect(printable('a⁦b⁩')).toBe('a\\u2066b\\u2069');
  });

  it('leaves newlines, tabs and ordinary text, including other scripts, alone', () => {
    const text = 'Line one\n\tLine two  日本語  é';
    expect(printable(text)).toBe(text);
  });

  it('keeps JSON valid and the decoded value identical', () => {
    // JSON.stringify leaves bidi controls raw; the escape is the JSON escape.
    const value = { name: 'a‮b' };
    const line = printable(JSON.stringify(value));
    expect(line).not.toContain('‮');
    expect(JSON.parse(line)).toEqual(value);
  });
});
