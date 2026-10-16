/**
 * Longest common subsequence over comparable sequences (cluster arrays).
 *
 * Adapted from @varve/history's `lcsIndices` (same algorithm and memory
 * bound) so the wire/collaboration package stays dependency-light. The
 * parity property against brute force is covered in lcs.test.ts, and the
 * history package's own suite covers the shared usage in capture merging.
 *
 * Returns matched index pairs [baseIndex, currentIndex] in order.
 */

/**
 * Largest DP table (cells) the exact quadratic LCS may allocate: 64 MiB of
 * Uint32. Larger inputs fall back to the linear-in-n log variant below.
 */
const MAX_LCS_TABLE_CELLS = 16 * 1024 * 1024;

export function lcsIndices(
  base: readonly string[],
  target: readonly string[],
): Array<[number, number]> {
  const n = base.length;
  const m = target.length;
  if (n === 0 || m === 0) return [];
  // The backtrack below matches equal leading elements greedily, so a common
  // prefix is always paired index-for-index; trimming it yields the same pairs
  // while shrinking the table to the region that actually changed.
  let prefix = 0;
  while (prefix < n && prefix < m && base[prefix] === target[prefix]) prefix++;
  const pairs: Array<[number, number]> = [];
  for (let k = 0; k < prefix; k++) pairs.push([k, k]);
  if (prefix === n || prefix === m) return pairs;
  const restBase = base.slice(prefix);
  const restTarget = target.slice(prefix);
  const rest =
    (restBase.length + 1) * (restTarget.length + 1) <= MAX_LCS_TABLE_CELLS
      ? lcsQuadratic(restBase, restTarget)
      : lcsBounded(restBase, restTarget);
  for (const [i, j] of rest) pairs.push([i + prefix, j + prefix]);
  return pairs;
}

function lcsQuadratic(base: readonly string[], target: readonly string[]): Array<[number, number]> {
  const n = base.length;
  const m = target.length;
  const dp: Uint32Array = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = i * (m + 1);
    const nextRow = (i + 1) * (m + 1);
    for (let j = m - 1; j >= 0; j--) {
      const baseItem = base[i]!;
      const targetItem = target[j]!;
      dp[row + j] =
        baseItem === targetItem
          ? (dp[nextRow + j + 1] as number) + 1
          : Math.max(dp[row + j + 1] as number, dp[nextRow + j] as number);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const baseItem = base[i];
    const targetItem = target[j];
    if (baseItem !== undefined && baseItem === targetItem) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if ((dp[(i + 1) * (m + 1) + j] as number) >= (dp[i * (m + 1) + j + 1] as number)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

/**
 * LCS for inputs whose quadratic table exceeds the memory cap. Sequences
 * are treated as duplicate-free (text clusters may repeat; keeping only the
 * first occurrence as a match candidate still yields a valid common
 * subsequence, and callers content-verify every applied splice).
 */
function lcsBounded(base: readonly string[], target: readonly string[]): Array<[number, number]> {
  const targetIndex = new Map<string, number>();
  for (let j = 0; j < target.length; j++) {
    if (!targetIndex.has(target[j]!)) targetIndex.set(target[j]!, j);
  }
  const seenBase = new Set<string>();
  const candidates: Array<[number, number]> = [];
  for (let i = 0; i < base.length; i++) {
    const id = base[i]!;
    if (seenBase.has(id)) continue;
    seenBase.add(id);
    const j = targetIndex.get(id);
    if (j !== undefined) candidates.push([i, j]);
  }
  // Patience sorting over target indices; `tails[k]` is the candidate index
  // ending the best increasing run of length k + 1.
  const tails: number[] = [];
  const previous = new Int32Array(candidates.length).fill(-1);
  for (let c = 0; c < candidates.length; c++) {
    const j = candidates[c]![1];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (candidates[tails[mid]!]![1] < j) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[c] = tails[lo - 1]!;
    tails[lo] = c;
  }
  const pairs: Array<[number, number]> = [];
  let cursor = tails.length > 0 ? tails[tails.length - 1]! : -1;
  while (cursor >= 0) {
    pairs.push(candidates[cursor]!);
    cursor = previous[cursor]!;
  }
  return pairs.reverse();
}
