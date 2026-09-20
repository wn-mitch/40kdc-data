/**
 * Pure half-open byte-interval algebra for source coverage. Every function here takes and
 * returns sorted, disjoint intervals (see `normalized`) so each operation is a linear merge.
 */

/** A half-open `[start, end)` UTF-8 byte interval. */
export type Interval = { start: number; end: number };

/** Sort, drop empty intervals, and merge overlapping or touching intervals. */
export function normalized(intervals: readonly Interval[]): Interval[] {
  const ordered = intervals
    .filter((interval) => interval.end > interval.start)
    .slice()
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const result: Interval[] = [];
  for (const interval of ordered) {
    const previous = result.at(-1);
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      result.push({ ...interval });
    }
  }
  return result;
}

/** Total bytes in normalized intervals. */
export function totalLength(intervals: readonly Interval[]): number {
  return intervals.reduce((total, interval) => total + interval.end - interval.start, 0);
}

/** Bytes of `base` that also lie in `covered`; both must be normalized. */
export function overlapLength(base: readonly Interval[], covered: readonly Interval[]): number {
  return totalLength(intersectIntervals(base, covered));
}

/** `base ∩ other`; both must be normalized. */
export function intersectIntervals(base: readonly Interval[], other: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  let left = 0;
  let right = 0;
  while (left < base.length && right < other.length) {
    const a = base[left]!;
    const b = other[right]!;
    const start = Math.max(a.start, b.start);
    const end = Math.min(a.end, b.end);
    if (end > start) result.push({ start, end });
    if (a.end <= b.end) left += 1;
    else right += 1;
  }
  return result;
}

/** `base − exclusions`; both must be normalized. */
export function subtractIntervals(base: readonly Interval[], exclusions: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  let exclusionIndex = 0;
  for (const interval of base) {
    while (exclusionIndex < exclusions.length && exclusions[exclusionIndex]!.end <= interval.start) exclusionIndex += 1;
    let cursor = interval.start;
    for (let index = exclusionIndex; index < exclusions.length && exclusions[index]!.start < interval.end; index += 1) {
      const exclusion = exclusions[index]!;
      if (exclusion.start > cursor) result.push({ start: cursor, end: Math.min(exclusion.start, interval.end) });
      cursor = Math.max(cursor, exclusion.end);
      if (cursor >= interval.end) break;
    }
    if (cursor < interval.end) result.push({ start: cursor, end: interval.end });
  }
  return result;
}

/**
 * Layers of the exclusive byte partition, highest priority first. A meaningful byte belongs to
 * the first layer that claims it; bytes no layer claims are `residue`.
 */
export const PARTITION_LAYERS = ["leaf", "structural", "connective", "pending", "unresolved"] as const;
export type PartitionLayer = typeof PARTITION_LAYERS[number];
export type ExclusivePartition = Record<PartitionLayer | "residue", Interval[]>;

/**
 * Assign every meaningful byte to exactly one layer, in `PARTITION_LAYERS` order. The byte
 * totals of the returned layers always sum to the byte total of `meaningful`.
 */
export function partitionExclusive(
  meaningful: readonly Interval[],
  layers: Readonly<Record<PartitionLayer, readonly Interval[]>>,
): ExclusivePartition {
  let remaining = normalized(meaningful);
  const partition = {} as ExclusivePartition;
  for (const layer of PARTITION_LAYERS) {
    const claim = normalized(layers[layer]);
    partition[layer] = intersectIntervals(remaining, claim);
    remaining = subtractIntervals(remaining, claim);
  }
  partition.residue = remaining;
  return partition;
}

/** One raw interval that belongs to an overlap-tracked layer. */
export type TaggedInterval = Interval & { id: number; sanctioned_by?: ReadonlySet<number> };

/** An overlap between two authoritative intervals and whether review explicitly allowed it. */
export type OverlapDiagnostic = {
  kind: "leaf-structural" | "leaf-connective" | "structural-connective" | "structural-structural" | "connective-connective";
  left_id: number;
  right_id: number;
  bytes: number;
  sanctioned: boolean;
};

function pairwise(
  kind: OverlapDiagnostic["kind"],
  left: readonly TaggedInterval[],
  right: readonly TaggedInterval[],
  same: boolean,
): OverlapDiagnostic[] {
  const diagnostics: OverlapDiagnostic[] = [];
  for (const [leftIndex, a] of left.entries()) {
    for (const [rightIndex, b] of right.entries()) {
      if (same && rightIndex <= leftIndex) continue;
      const bytes = Math.min(a.end, b.end) - Math.max(a.start, b.start);
      if (bytes <= 0) continue;
      const sanctioned = kind === "leaf-structural" && (b.sanctioned_by?.has(a.id) ?? false)
        && b.start >= a.start && b.end <= a.end;
      diagnostics.push({ kind, left_id: a.id, right_id: b.id, bytes, sanctioned });
    }
  }
  return diagnostics;
}

/**
 * Report every overlap among authoritative layers. Leaf/structural overlap is sanctioned only
 * when the structural interval is wholly inside a leaf annotation listed in its `sanctioned_by`
 * (the reviewed containment link). Semantic/semantic overlap is governed by the annotation
 * review path and is not repeated here.
 */
export function overlapDiagnostics(layers: {
  leaf: readonly TaggedInterval[];
  structural: readonly TaggedInterval[];
  connective: readonly TaggedInterval[];
}): OverlapDiagnostic[] {
  return [
    ...pairwise("leaf-structural", layers.leaf, layers.structural, false),
    ...pairwise("leaf-connective", layers.leaf, layers.connective, false),
    ...pairwise("structural-connective", layers.structural, layers.connective, false),
    ...pairwise("structural-structural", layers.structural, layers.structural, true),
    ...pairwise("connective-connective", layers.connective, layers.connective, true),
  ];
}
