import Prism from 'prismjs';
import 'prismjs/components/prism-css.min.js';
import 'prismjs/components/prism-jsx.min.js';
import 'prismjs/components/prism-dart.min.js';
import 'prismjs/components/prism-swift.min.js';
import 'prismjs/components/prism-kotlin.min.js';
import 'prismjs/components/prism-markup.min.js';

const LANG_MAP: Record<string, string> = {
  // Legacy target keys.
  css: 'css',
  tailwind: 'jsx',
  modules: 'css',
  svg: 'markup',
  flutter: 'dart',
  swiftui: 'swift',
  compose: 'kotlin',
  // File languages (multi-file results highlight per file).
  tsx: 'jsx',
  jsx: 'jsx',
  html: 'markup',
  dart: 'dart',
  swift: 'swift',
  kotlin: 'kotlin',
};

export function highlight(code: string, target: string): string {
  const lang = LANG_MAP[target] ?? 'css';
  const langGrammar = Prism.languages[lang];
  if (!langGrammar) return code;
  return Prism.highlight(code, langGrammar, lang);
}
