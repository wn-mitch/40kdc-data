/**
 * Nearest neighbours over unit-length sentence vectors: the labelled neighbours that vote on a
 * wording's leaf, and mutual-kNN clusters of the wording still without one. Brute force; the
 * corpus has a few thousand wordings.
 */

export type Neighbour = { index: number; sim: number };

export function dot(left: Float32Array, right: Float32Array): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += left[index]! * right[index]!;
  return total;
}

/** The `k` most similar pool entries, most similar first; equal similarity keeps pool order. */
export function topK(query: Float32Array, pool: readonly Float32Array[], k: number, skip = -1): Neighbour[] {
  const best: Neighbour[] = [];
  pool.forEach((vector, index) => {
    if (index === skip) return;
    const sim = dot(query, vector);
    if (best.length === k && sim <= best[k - 1]!.sim) return;
    let at = best.length;
    while (at > 0 && best[at - 1]!.sim < sim) at -= 1;
    best.splice(at, 0, { index, sim });
    if (best.length > k) best.pop();
  });
  return best;
}

export type Vote<L> = {
  label: string;
  /** The winner's share of the similarity-weighted vote, 0–1. */
  share: number;
  /** The most similar neighbour carrying the winning label: its parameters are the proposal's. */
  best: Neighbour & { item: L };
};

/**
 * Similarity-weighted vote over labelled neighbours. Ties go to the label whose best neighbour is
 * closer, then to the label first seen, so the result never depends on map order.
 */
export function vote<L>(neighbours: readonly Neighbour[], items: readonly L[], labelOf: (item: L) => string): Vote<L> | null {
  const weights = new Map<string, { weight: number; best: Neighbour }>();
  let total = 0;
  for (const neighbour of neighbours) {
    const weight = Math.max(0, neighbour.sim);
    total += weight;
    const label = labelOf(items[neighbour.index]!);
    const entry = weights.get(label);
    if (!entry) weights.set(label, { weight, best: neighbour });
    else {
      entry.weight += weight;
      if (neighbour.sim > entry.best.sim) entry.best = neighbour;
    }
  }
  let winner: [string, { weight: number; best: Neighbour }] | null = null;
  for (const entry of weights) {
    if (!winner || entry[1].weight > winner[1].weight || (entry[1].weight === winner[1].weight && entry[1].best.sim > winner[1].best.sim)) winner = entry;
  }
  if (!winner || total <= 0) return null;
  return { label: winner[0], share: winner[1].weight / total, best: { ...winner[1].best, item: items[winner[1].best.index]! } };
}

export type Cluster = { members: number[]; medoid: number };

/**
 * Connected components of the mutual-kNN graph: two wordings are linked only when each is among
 * the other's `k` nearest and they are at least `minSim` alike. A chain a–b–c needs both links to
 * be mutual, so a loose "bridge" wording cannot pull two groups together the way single linkage does.
 * Singletons are clusters of one. Clusters come largest first; members in index order.
 */
export function mutualKnnClusters(vectors: readonly Float32Array[], k: number, minSim: number): Cluster[] {
  const near = vectors.map((vector, index) => new Set(topK(vector, vectors, k, index).filter((item) => item.sim >= minSim).map((item) => item.index)));
  const parent = vectors.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) index = parent[index] = parent[parent[index]!]!;
    return index;
  };
  near.forEach((set, index) => {
    for (const other of set) if (near[other]!.has(index)) parent[find(index)] = find(other);
  });
  const groups = new Map<number, number[]>();
  vectors.forEach((_, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), index]);
  });
  return [...groups.values()].map((members) => {
    let medoid = members[0]!;
    let bestMean = -Infinity;
    for (const member of members) {
      const mean = members.reduce((total, other) => total + (other === member ? 0 : dot(vectors[member]!, vectors[other]!)), 0) / Math.max(1, members.length - 1);
      if (mean > bestMean) { bestMean = mean; medoid = member; }
    }
    return { members, medoid };
  }).sort((left, right) => right.members.length - left.members.length || left.members[0]! - right.members[0]!);
}
