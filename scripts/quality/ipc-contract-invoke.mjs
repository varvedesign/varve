#!/usr/bin/env node
/**
 * IPC contract audit — TypeScript invoke() call-site parsing.
 *
 * Literal first arguments are command names. Dynamic first arguments are a
 * reviewed transport and must be allowlisted. Interface method declarations are
 * not call sites and are skipped structurally.
 */
import { isCommentOccurrence, lineAt, skipQuoted } from './ipc-contract-parse.mjs';

function readQuoted(text, quoteIndex) {
  return skipQuoted(text, quoteIndex) + 1;
}

function findCallClose(text, openIndex) {
  let depth = 0;
  let index = openIndex;
  while (index < text.length) {
    const character = text[index];
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    } else if (character === "'" || character === '"' || character === '\u0060') {
      index = readQuoted(text, index);
      continue;
    }
    index += 1;
  }
  return -1;
}

function nextNonSpace(text, index) {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return text[cursor];
}

/**
 * A dynamic-shaped occurrence is a declaration when the call opens a typed
 * signature: the next token after ')' is a type annotation, and the member
 * starts the line, follows '{', or follows 'function'.
 */
function isMethodDeclaration(text, invokeIndex, closeIndex) {
  const afterClose = nextNonSpace(text, closeIndex + 1);
  if (afterClose !== ':') return false;
  const lineStart = text.lastIndexOf('\n', invokeIndex - 1) + 1;
  const before = text.slice(lineStart, invokeIndex);
  return /^[ \t]*$/.test(before) || /\bfunction\s*$/.test(before) || /\{\s*$/.test(before);
}

/**
 * Parse invoke call sites from one TS/TSX source file.
 * @returns {{
 *   literals: {name: string, file: string, line: number}[],
 *   plugins: {name: string, file: string, line: number}[],
 *   dynamics: {file: string, line: number, snippet: string}[],
 *   declarations: {file: string, line: number}[],
 * }}
 */
export function parseInvokeSites(text, file) {
  const literals = [];
  const plugins = [];
  const dynamics = [];
  const declarations = [];
  const pattern = /\binvoke\b\s*(?:<[^()]*?>)?\s*\(/g;
  let match;
  while ((match = pattern.exec(text))) {
    const invokeIndex = match.index;
    if (isCommentOccurrence(text, invokeIndex)) continue;
    const openIndex = invokeIndex + match[0].length - 1;
    const line = lineAt(text, invokeIndex);
    let cursor = openIndex + 1;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
    const first = text[cursor];
    if (first === "'" || first === '"') {
      const end = readQuoted(text, cursor);
      const raw = text.slice(cursor + 1, end - 1);
      const name = raw.replaceAll("\\'", "'").replaceAll('\\"', '"');
      if (name.includes(':')) {
        plugins.push({ name, file, line });
      } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        literals.push({ name, file, line });
      } else {
        dynamics.push({ file, line, snippet: raw.slice(0, 80) });
      }
      continue;
    }
    const snippet = text
      .slice(cursor, cursor + 80)
      .split('\n')[0]
      .trim();
    const close = findCallClose(text, openIndex);
    if (close >= 0 && isMethodDeclaration(text, invokeIndex, close)) {
      declarations.push({ file, line });
      continue;
    }
    dynamics.push({ file, line, snippet });
  }
  return { literals, plugins, dynamics, declarations };
}
