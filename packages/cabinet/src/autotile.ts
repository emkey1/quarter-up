/**
 * 8-neighbour "blob" autotiling.
 *
 * This is the plumbing, not the art: it reduces the 256 possible neighbour
 * configurations to the 47 distinct *appearances* a blob tileset needs, which is what
 * lets a theme be ~12 hand-drawn source pieces instead of 47 (DESIGN.md §14, art risk).
 *
 * Extracted at M6, byte-identical in the two games that use it. Double Bubble does not:
 * a gravity platformer has no autotiled terrain, and that is the expected outcome rather
 * than a gap — shared does not mean universal.
 */

export const NB = {
  N: 1,
  NE: 2,
  E: 4,
  SE: 8,
  S: 16,
  SW: 32,
  W: 64,
  NW: 128,
} as const;

/**
 * A diagonal neighbour only affects appearance if both of its adjacent cardinals are
 * also filled — otherwise the corner is already an outside corner and the diagonal is
 * invisible. Collapsing that is what takes 256 cases down to 47.
 */
export function reduceMask(m: number): number {
  let r = m & (NB.N | NB.E | NB.S | NB.W);
  if (m & NB.NE && m & NB.N && m & NB.E) r |= NB.NE;
  if (m & NB.SE && m & NB.S && m & NB.E) r |= NB.SE;
  if (m & NB.SW && m & NB.S && m & NB.W) r |= NB.SW;
  if (m & NB.NW && m & NB.N && m & NB.W) r |= NB.NW;
  return r;
}

/** reduced mask -> dense index 0..46, built once by enumeration rather than hardcoded. */
export const BLOB_INDEX: ReadonlyMap<number, number> = (() => {
  const distinct = new Set<number>();
  for (let m = 0; m < 256; m++) distinct.add(reduceMask(m));
  const sorted = [...distinct].sort((a, b) => a - b);
  const map = new Map<number, number>();
  sorted.forEach((v, i) => map.set(v, i));
  return map;
})();

export const BLOB_COUNT = BLOB_INDEX.size; // 47

export function blobIndex(mask: number): number {
  return BLOB_INDEX.get(reduceMask(mask)) ?? 0;
}

/** Build the neighbour mask for a cell, given a predicate for "same family as me". */
export function neighbourMask(
  cx: number,
  cy: number,
  same: (x: number, y: number) => boolean,
): number {
  let m = 0;
  if (same(cx, cy - 1)) m |= NB.N;
  if (same(cx + 1, cy - 1)) m |= NB.NE;
  if (same(cx + 1, cy)) m |= NB.E;
  if (same(cx + 1, cy + 1)) m |= NB.SE;
  if (same(cx, cy + 1)) m |= NB.S;
  if (same(cx - 1, cy + 1)) m |= NB.SW;
  if (same(cx - 1, cy)) m |= NB.W;
  if (same(cx - 1, cy - 1)) m |= NB.NW;
  return m;
}
