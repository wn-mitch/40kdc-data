import type { Compiled } from "./compile.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { joinSegments } from "./compile-segments.js";
import type { CoreCheck } from "./core-checks.js";
import type { Mechanics } from "./entries.js";
import { PSYCHIC_COST_FAMILY } from "./psychic-families.js";

/**
 * Psychic abilities in one record. Each bold heading "**Name (psychic level N)**" starts one
 * psychic ability, and it runs to the next such heading (or the end of the text). The heading's
 * `psychic level N` span is the cost leaf; the ability's own leaves are the ones inside its span.
 * Each ability compiles as one ability-part whose `cost` is a spend of N from the psychic-level
 * pool: the part applies only once that cost is paid, and the spend comes before its effect.
 */

export const PSYCHIC_POOL = "psychic-level";

/** One psychic ability: its heading's cost leaf and the leaves that belong to it. */
export type PsychicSegment = { cost: CompileLeaf; leaves: CompileLeaf[] };

type Heading = { start: number; end: number; level: number };

const HEADING = /\*\*[^*\n]*\(psychic level (\d+)\)\*\*/gu;

/** A psychic ability's roll: the psychic test (a dice roll whose result is named psychic). */
const isPsychicRoll = (leaf: CompileLeaf) => leaf.family_id === "dice-roll" && leaf.parameters.roll_var === "psychic";

/**
 * The record's psychic abilities, or null when no leaf is a psychic-level cost. A cost that does not
 * sit in a psychic heading naming the same level, a leaf outside every heading, a heading without its
 * cost, two costs in one ability, and an ability without its psychic roll are each refused.
 */
export function psychicSegments(leaves: readonly CompileLeaf[], sourceText: string | undefined): PsychicSegment[] | null {
  const costs = leaves.filter((leaf) => leaf.family_id === PSYCHIC_COST_FAMILY);
  if (costs.length === 0) return null;
  if (sourceText === undefined) throw new CompileError("A psychic-level cost needs the record's source text, to find its heading.");
  const bytes = Buffer.from(sourceText, "utf8");
  const headings: Heading[] = [...sourceText.matchAll(HEADING)].map((match) => {
    const start = Buffer.byteLength(sourceText.slice(0, match.index));
    return { start, end: start + Buffer.byteLength(match[0]), level: Number(match[1]) };
  });
  const segments = headings.map((heading, index) => ({
    heading, end: headings[index + 1]?.start ?? bytes.length, cost: undefined as CompileLeaf | undefined, leaves: [] as CompileLeaf[],
  }));
  for (const cost of costs) {
    const costEnd = cost.end_byte ?? cost.start_byte;
    const at = segments.findIndex((segment) => segment.heading.start <= cost.start_byte && costEnd <= segment.heading.end);
    if (at < 0) throw new CompileError("A psychic-level cost names no psychic ability heading.");
    const { level } = cost.parameters;
    const span = bytes.subarray(cost.start_byte, costEnd).toString("utf8");
    if (span !== `psychic level ${String(level)}` || segments[at]!.heading.level !== level) {
      throw new CompileError(`The psychic-level cost ${String(level)} does not match the heading it sits in.`);
    }
    if (segments[at]!.cost) throw new CompileError("A psychic ability has two psychic-level costs.");
    segments[at]!.cost = cost;
  }
  for (const leaf of leaves) {
    if (leaf.family_id === PSYCHIC_COST_FAMILY) continue;
    const segment = segments.find((item) => item.heading.start <= leaf.start_byte && leaf.start_byte < item.end);
    if (!segment) throw new CompileError("A leaf sits outside every psychic ability heading; a record with psychic-level costs holds only psychic abilities.");
    segment.leaves.push(leaf);
  }
  return segments.map((segment) => {
    if (!segment.cost) throw new CompileError("A psychic ability heading has no psychic-level cost leaf.");
    if (!segment.leaves.some(isPsychicRoll)) throw new CompileError("A psychic ability's cost needs its psychic roll in the same ability.");
    return { cost: segment.cost, leaves: segment.leaves };
  });
}

/** The spend that pays a psychic ability's cost from its unit's pool. */
function costNode(cost: CompileLeaf): Record<string, unknown> {
  return { type: "resource-spend", target: "this-unit", modifier: { pool: PSYCHIC_POOL, amount: cost.parameters.level, label: "Psychic Level" } };
}

/**
 * Compile each psychic ability as one ability-part with its cost. `compilePart` compiles one
 * ability's leaves (the caller passes compile.ts's per-part compiler, so this module does not import it).
 */
export function lowerPsychicRecord(segments: readonly PsychicSegment[], signature: string, compilePart: (leaves: CompileLeaf[]) => Compiled): Compiled {
  const parts: Array<{ mechanics: Mechanics; checks: CoreCheck[] }> = [];
  for (const segment of segments) {
    const result = compilePart(segment.leaves);
    if (!result.ok) return { ok: false, signature, errors: result.errors };
    if (result.core) return { ok: false, signature, errors: ["A psychic ability cannot be a Stratagem's target restriction."] };
    const node = result.mechanics as unknown as Record<string, unknown> & { scope?: { duration?: string } };
    const duration = node.scope?.duration;
    const carried = {
      ...(node.trigger != null ? { trigger: node.trigger } : {}),
      ...(node.usage != null ? { usage: node.usage } : {}),
      ...(duration !== undefined && duration !== "permanent" ? { duration } : {}),
    };
    const part = { type: "ability-part", ...carried, cost: costNode(segment.cost), effect: node.effect };
    parts.push({ mechanics: { effect: part, scope: { duration: "permanent" }, behavior: node.behavior, trigger: null } as unknown as Mechanics, checks: result.checks });
  }
  const joined = joinSegments(parts);
  if (joined.errors.length) return { ok: false, signature, errors: joined.errors };
  const effect = joined.mechanics.effect as unknown as { steps: unknown[] };
  // A record with one psychic ability is that ability's part, not a sequence of one.
  const mechanics = { ...joined.mechanics, effect: effect.steps.length === 1 ? effect.steps[0] : joined.mechanics.effect } as unknown as Mechanics;
  return { ok: true, signature, mechanics, checks: joined.checks };
}
