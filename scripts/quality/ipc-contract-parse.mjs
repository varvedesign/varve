#!/usr/bin/env node
/**
 * IPC contract audit — source discovery and Rust command parsing.
 *
 * Shared by audit-ipc-contract.mjs. Regex-based on purpose: the audit must run
 * without a Rust/TypeScript parser dependency, and the attributes and call
 * shapes it accepts are enumerated in the audit header and docs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

export const RUST_SOURCE_DIR = 'apps/desktop/src-tauri/src';
const TS_SCAN_ROOTS = ['packages', 'apps'];
const TS_EXTENSIONS = new Set(['.ts', '.tsx']);
export const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'dist-pages',
  'target',
  '.git',
  'test-results',
  'coverage',
  '.worktrees',
]);
const TEST_FILE_PATTERN = /(?:\.test\.|\.spec\.|[/\\]__tests__[/\\]|[/\\]__mocks__[/\\])/;
export const COMMAND_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Normalize a git path to forward slashes for stable cross-platform output. */
export function normalizePath(path) {
  return path.split(sep).join('/');
}

export function lineAt(text, index) {
  let line = 1;
  for (let offset = 0; offset < index; offset += 1) {
    if (text.charCodeAt(offset) === 10) line += 1;
  }
  return line;
}

export function walk(directory, predicate, output) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      walk(absolute, predicate, output);
    } else if (predicate(entry.name)) {
      output.push(normalizePath(absolute));
    }
  }
}

function isTestFile(path) {
  return TEST_FILE_PATTERN.test(path);
}

/** True when the occurrence sits inside a line/block comment (line-level heuristic). */
export function isCommentOccurrence(text, index) {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  const prefix = text.slice(lineStart, index);
  const trimmed = prefix.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
    return true;
  }
  const comment = prefix.lastIndexOf('//');
  if (comment < 0) return false;
  // A URL such as https:// inside a string is not a comment.
  return prefix[comment - 1] !== ':';
}

/** Find the closing ']' of an attribute starting at its '['. */
function findAttributeEnd(text, bracketIndex) {
  let depth = 0;
  for (let index = bracketIndex; index < text.length; index += 1) {
    const character = text[index];
    if (character === '[') {
      depth += 1;
    } else if (character === ']') {
      depth -= 1;
      if (depth === 0) return index;
    } else if (character === '"') {
      index = skipQuoted(text, index);
    }
  }
  return -1;
}

export function skipQuoted(text, quoteIndex) {
  const quote = text[quoteIndex];
  let index = quoteIndex + 1;
  while (index < text.length) {
    const character = text[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === quote) return index;
    index += 1;
  }
  return text.length;
}

/**
 * After a tauri::command attribute, walk past attributes/visibility/qualifiers
 * to the function name. Returns null when the attribute is not attached to a fn
 * (for example when it is mentioned in a doc comment or quoted in prose).
 */
function scanFnName(text, start) {
  let cursor = start;
  for (let guard = 0; guard < 40; guard += 1) {
    const rest = text.slice(cursor, cursor + 512);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      cursor += whitespace[0].length;
      continue;
    }
    if (rest.startsWith('//')) {
      const newline = text.indexOf('\n', cursor);
      if (newline < 0) return null;
      cursor = newline + 1;
      continue;
    }
    if (rest.startsWith('/*')) {
      const close = text.indexOf('*/', cursor + 2);
      if (close < 0) return null;
      cursor = close + 2;
      continue;
    }
    if (rest.startsWith('#[')) {
      const close = findAttributeEnd(text, cursor + 1);
      if (close < 0) return null;
      cursor = close + 1;
      continue;
    }
    const visibility = /^pub(?:\s*\([^)]*\))?\s+/.exec(rest);
    if (visibility) {
      cursor += visibility[0].length;
      continue;
    }
    const qualifier = /^(?:async|unsafe|const)\s+/.exec(rest);
    if (qualifier) {
      cursor += qualifier[0].length;
      continue;
    }
    const fn = /^fn\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
    return fn ? fn[1] : null;
  }
  return null;
}

/**
 * Parse #[tauri::command] function definitions from one Rust source file.
 * @returns {{ commands: {name: string, file: string, line: number}[], skipped: number }}
 */
export function parseRustCommands(text, file) {
  const commands = [];
  const marker = '#[tauri::command';
  let skipped = 0;
  let searchFrom = 0;
  while (true) {
    const index = text.indexOf(marker, searchFrom);
    if (index < 0) break;
    searchFrom = index + marker.length;
    if (isCommentOccurrence(text, index)) continue;
    const close = findAttributeEnd(text, index + 1);
    if (close < 0) {
      skipped += 1;
      continue;
    }
    const name = scanFnName(text, close + 1);
    if (name === null) {
      skipped += 1;
      continue;
    }
    commands.push({ name, file, line: lineAt(text, index) });
  }
  return { commands, skipped };
}

export function collectFiles(root, relativeDirectory, predicate) {
  const output = [];
  walk(join(root, relativeDirectory), predicate, output);
  return output.sort();
}

export function readRustSources(root) {
  const files = collectFiles(root, RUST_SOURCE_DIR, (name) => name.endsWith('.rs'));
  return files.map((absolute) => ({
    file: normalizePath(absolute.slice(root.length + 1)),
    text: readFileSync(absolute, 'utf8'),
  }));
}

export function readTsSources(root) {
  const files = [];
  for (const relativeRoot of TS_SCAN_ROOTS) {
    for (const absolute of collectFiles(root, relativeRoot, (name) => {
      const dot = name.lastIndexOf('.');
      return dot >= 0 && TS_EXTENSIONS.has(name.slice(dot));
    })) {
      const file = normalizePath(absolute.slice(root.length + 1));
      if (isTestFile(file)) continue;
      files.push({ file, absolute });
    }
  }
  return files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/**
 * Parse every generate_handler![...] registration list in the Rust sources.
 * Returns null when the tree has no Tauri registration list (fixtures).
 */
export function parseRegisteredCommands(sources) {
  const registered = new Set();
  let seen = false;
  const pattern = /generate_handler!\s*\[([\s\S]*?)\]/g;
  for (const source of sources) {
    let match;
    while ((match = pattern.exec(source.text))) {
      seen = true;
      const body = match[1].replace(/\/\/[^\n]*/g, '');
      for (const raw of body.split(',')) {
        const entry = raw.trim();
        if (entry.length === 0) continue;
        const name = entry.split('::').pop().trim();
        if (COMMAND_NAME_PATTERN.test(name)) registered.add(name);
      }
    }
  }
  return seen ? registered : null;
}
