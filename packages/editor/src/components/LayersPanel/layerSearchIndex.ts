import type { Document, NodeId, SceneNode } from '@varve/scene';

/**
 * Search index for layer names and properties.
 * Built incrementally on document mutation for O(1) lookup.
 */
export interface LayerSearchIndex {
  /** Map of lowercase word -> matching node IDs */
  wordIndex: Map<string, Set<NodeId>>;
  /**
   * Map of node ID -> the NFC-lowercased full authored name.
   *
   * The word split removes punctuation (`icon/24px` → `icon`, `24px`), so a
   * query containing punctuation has to match the raw name. Keeping it out of
   * `wordIndex` is deliberate: a layer literally named `kind:text` must never
   * satisfy the reserved `kind:` metadata query for its own name.
   */
  fullNames: Map<NodeId, string>;
  /** Map of node ID -> all words in the node's name */
  nodeWords: Map<NodeId, string[]>;
  /** Map of node ID -> node kind */
  nodeKinds: Map<NodeId, SceneNode['kind']>;
}

export function createSearchIndex(doc: Document): LayerSearchIndex {
  const wordIndex = new Map<string, Set<NodeId>>();
  const fullNames = new Map<NodeId, string>();
  const nodeWords = new Map<NodeId, string[]>();
  const nodeKinds = new Map<NodeId, SceneNode['kind']>();

  for (const [id, node] of Object.entries(doc.nodes)) {
    indexNode(id as NodeId, node, wordIndex, fullNames, nodeWords, nodeKinds);
  }

  return { wordIndex, fullNames, nodeWords, nodeKinds };
}

function indexNode(
  id: NodeId,
  node: SceneNode,
  wordIndex: Map<string, Set<NodeId>>,
  fullNames: Map<NodeId, string>,
  nodeWords: Map<NodeId, string[]>,
  nodeKinds: Map<NodeId, SceneNode['kind']>,
): void {
  const words = extractWords(node.name);
  nodeWords.set(id, words);
  nodeKinds.set(id, node.kind);
  fullNames.set(id, node.name.normalize('NFC').toLowerCase());

  for (const word of words) {
    if (!wordIndex.has(word)) wordIndex.set(word, new Set());
    wordIndex.get(word)?.add(id);
  }

  const kindWord = `kind:${node.kind}`;
  if (!wordIndex.has(kindWord)) wordIndex.set(kindWord, new Set());
  wordIndex.get(kindWord)?.add(id);
}

/**
 * Split a layer name into searchable words.
 *
 * Unicode-aware on purpose: the previous ASCII-only cleanup stripped every
 * non-Latin word to an empty string, so a document named entirely in Chinese,
 * Arabic or Cyrillic could not be found at all. `\p{L}`/`\p{N}` keep letters
 * and digits from any script; punctuation and separators still split words.
 *
 * CJK runs stay together as one word. Substring matching (below) is what lets
 * a query like `按钮` find `设计按钮` without inventing a dictionary.
 *
 * Punctuation-bearing names (`icon/24px`) are matched against the full name
 * in `LayerSearchIndex.fullNames`, not through this split — the words here
 * must stay colon-free so they can never collide with reserved `kind:` keys.
 */
function extractWords(name: string): string[] {
  const normalized = name.normalize('NFC');
  const words = normalized.split(/[^\p{L}\p{N}\p{M}]+/u);
  const result = new Set<string>();

  for (const word of words) {
    if (word.length === 0) continue;
    result.add(word.toLowerCase());
    // camelCase / PascalCase boundaries only exist for cased scripts, so this
    // pass is deliberately additive: it never removes the full word.
    const camelParts = word.split(/(?<=[a-z0-9])(?=[A-Z])/);
    for (const part of camelParts) {
      if (part.length > 0) result.add(part.toLowerCase());
    }
  }

  return [...result];
}

/**
 * One search contract for both the index-backed tree projection and direct
 * predicate evaluation (filter-bar counts, Select matches).
 *
 * Both paths used to disagree: the tree AND-matched word *prefixes*, while
 * the count ran `name.toLowerCase().includes(query)`. Searching
 * `primary button` therefore rendered `Primary Large Button` in the tree and
 * simultaneously reported `0 of N layers`, disabling Select matches. Every
 * term must now appear as a substring of some word in the name — or, for a
 * term containing punctuation the word split removes, of the full name.
 */
export function layerSearchTerms(query: string): string[] {
  return query.normalize('NFC').toLowerCase().split(/\s+/u).filter(Boolean);
}

export function matchesLayerSearch(name: string, query: string, kind?: SceneNode['kind']): boolean {
  const terms = layerSearchTerms(query);
  if (terms.length === 0) return false;
  const words = extractWords(name);
  const fullName = name.normalize('NFC').toLowerCase();
  return terms.every((term) =>
    term.startsWith('kind:')
      ? // Reserved metadata syntax: compare the real node kind, never the
        // authored name, so a layer named `kind:text` cannot impersonate it.
        term === `kind:${kind}`
      : words.some((word) => word.includes(term)) || fullName.includes(term),
  );
}

/** Search the index — returns matching node IDs ordered by relevance */
export function searchIndex(index: LayerSearchIndex, query: string): NodeId[] {
  const terms = layerSearchTerms(query);
  if (terms.length === 0) return [];

  let resultSet: Set<NodeId> | null = null;

  for (const term of terms) {
    const combined = new Set<NodeId>();

    // `kind:` entries are filter syntax, not layer-name text. Substring
    // matching would otherwise make the query "shape" match every shape
    // through `kind:shape` while the name predicate (and therefore the
    // result count) matched only names containing "shape".
    if (term.startsWith('kind:')) {
      for (const id of index.wordIndex.get(term) ?? []) combined.add(id);
      if (resultSet === null) resultSet = combined;
      else {
        const intersection = new Set<NodeId>();
        for (const id of resultSet) if (combined.has(id)) intersection.add(id);
        resultSet = intersection;
      }
      continue;
    }

    // Substring-of-a-word, not prefix-of-a-word: this is the same rule
    // `matchesLayerSearch` applies to a single name, so the tree, the count
    // and Select matches cannot disagree.
    for (const [word, ids] of index.wordIndex) {
      if (word.startsWith('kind:') || !word.includes(term)) continue;
      for (const id of ids) combined.add(id);
    }
    // Punctuation-bearing terms (`icon/24`) survive only in the full name;
    // the word split removed the separators. Checked separately so authored
    // names can never satisfy the reserved `kind:` namespace.
    for (const [id, fullName] of index.fullNames) {
      if (fullName.includes(term)) combined.add(id);
    }

    if (resultSet === null) {
      resultSet = combined;
    } else {
      const intersection = new Set<NodeId>();
      for (const id of resultSet) {
        if (combined.has(id)) intersection.add(id);
      }
      resultSet = intersection;
    }
  }

  if (!resultSet) return [];

  const resultIds = [...resultSet];

  // Order by relevance: whole-word matches first, then partial-word matches
  const exactMatches = new Set<NodeId>();
  for (const term of terms) {
    const exact = index.wordIndex.get(term);
    if (exact) for (const id of exact) exactMatches.add(id);
  }

  const sorted = resultIds.sort((a, b) => {
    const aExact = exactMatches.has(a) ? 1 : 0;
    const bExact = exactMatches.has(b) ? 1 : 0;
    return bExact - aExact;
  });

  return sorted;
}

/** Incrementally update index when a node changes */
export function updateIndex(index: LayerSearchIndex, id: NodeId, node: SceneNode): void {
  const previousKind = index.nodeKinds.get(id);
  if (previousKind) index.wordIndex.get(`kind:${previousKind}`)?.delete(id);
  const oldWords = index.nodeWords.get(id);
  if (oldWords) {
    for (const word of oldWords) {
      const set = index.wordIndex.get(word);
      if (set) {
        set.delete(id);
        if (set.size === 0) index.wordIndex.delete(word);
      }
    }
  }

  index.nodeWords.delete(id);
  index.nodeKinds.delete(id);
  index.fullNames.delete(id);
  indexNode(id, node, index.wordIndex, index.fullNames, index.nodeWords, index.nodeKinds);
}

/** Remove node from index */
export function removeFromIndex(index: LayerSearchIndex, id: NodeId): void {
  const previousKind = index.nodeKinds.get(id);
  if (previousKind) index.wordIndex.get(`kind:${previousKind}`)?.delete(id);
  const oldWords = index.nodeWords.get(id);
  if (oldWords) {
    for (const word of oldWords) {
      const set = index.wordIndex.get(word);
      if (set) {
        set.delete(id);
        if (set.size === 0) index.wordIndex.delete(word);
      }
    }
  }
  index.nodeWords.delete(id);
  index.nodeKinds.delete(id);
  index.fullNames.delete(id);
}
