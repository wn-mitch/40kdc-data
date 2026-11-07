import type { UncoveredInterval } from "./coverage.js";

/**
 * How many sources a pending spelling would finish: sources whose every untiled run lies inside
 * that spelling's own spans there. Edge punctuation and spaces of a run do not need covering.
 */

type Span = { ability_version_id: number; fragment: string; start_byte: number; end_byte: number };

const EDGE_START = /^[\s\p{P}]+/u;
const EDGE_END = /[\s\p{P}]+$/u;

/** A run's bytes without its edge punctuation and spaces: what a leaf would have to cover. */
function core(run: UncoveredInterval): { start: number; end: number } {
  const lead = Buffer.byteLength(EDGE_START.exec(run.text)?.[0] ?? "");
  const trail = Buffer.byteLength(EDGE_END.exec(run.text)?.[0] ?? "");
  return { start: run.start_byte + lead, end: Math.max(run.start_byte + lead, run.end_byte - trail) };
}

export function sourcesClosed(runsBySource: ReadonlyMap<number, UncoveredInterval[]>, spans: readonly Span[]): number {
  const bySource = new Map<number, Span[]>();
  for (const span of spans) bySource.set(span.ability_version_id, [...(bySource.get(span.ability_version_id) ?? []), span]);
  let closed = 0;
  for (const [id, own] of bySource) {
    const runs = runsBySource.get(id);
    if (!runs?.length) continue;
    if (runs.every((run) => {
      const need = core(run);
      return own.some((span) => span.fragment === run.fragment && span.start_byte <= need.start && span.end_byte >= need.end);
    })) closed += 1;
  }
  return closed;
}
