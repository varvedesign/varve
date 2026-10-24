/**
 * PaddleOCR character dictionary loader + cache.
 *
 * The recognition model outputs class indices 1..N (0 = CTC blank). To turn
 * those indices into text we need the dictionary the model was trained with:
 * dict[i] corresponds to class index i+1.
 *
 * Dictionaries are plain text files, one character/line. We fetch, parse,
 * cache in memory (and expose the raw text), and bound the result to guard
 * against a corrupt or truncated file silently producing garbage output.
 *
 * The dictionary is acquired by ModelLoader with the recognition model. This
 * reader fetches its installed asset/blob URL and caches the parsed vocabulary.
 * It surfaces a clear error if unavailable — because
 * decoding without the exact dictionary the model expects produces
 * plausible-looking but wrong text, which is worse than a visible failure.
 */

const dictCache = new Map<string, string[]>();

/**
 * Load and cache a character dictionary by URL (or model id).
 *
 * @param url        Resolved dictionary asset/blob URL.
 * @param expectedLines  Sanity-check line count (0 = skip check).
 * @param signal     AbortSignal for cancellation.
 */
export async function loadOcrDictionary(
  url: string,
  expectedLines = 0,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  if (signal?.aborted) throw new Error('cancelled');
  const cached = dictCache.get(url);
  if (cached) {
    validateSize(cached, expectedLines);
    return cached;
  }

  let text: string;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    if (signal?.aborted) throw new Error('cancelled');
    throw new Error(
      `Failed to load OCR dictionary from ${url}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (signal?.aborted) throw new Error('cancelled');

  // Parse: one char per line. Trim the trailing empty line from the file.
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l, i, arr) => !(i === arr.length - 1 && l === ''));

  validateSize(lines, expectedLines);

  dictCache.set(url, lines);
  return lines;
}

function validateSize(lines: readonly string[], expectedLines: number): void {
  if (expectedLines > 0 && lines.length !== expectedLines) {
    throw new Error(`OCR dictionary has ${lines.length} entries, expected ${expectedLines}`);
  }
}

/** Synchronous cache lookup (returns undefined if not yet loaded). */
export function getCachedDictionary(url: string): readonly string[] | undefined {
  return dictCache.get(url);
}

/** Clear the dictionary cache (e.g. on model-unload or memory pressure). */
export function clearDictionaryCache(): void {
  dictCache.clear();
}
