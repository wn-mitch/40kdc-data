import { CompileError, type CompileLeaf } from "./compile-fragments.js";

/** Wording that names a phase hypothetically: "as if it were your Charge phase". */
const HYPOTHETICAL = /^\W*(?:as\s+)?if\s+it\s+(?:were|was)\b/iu;

/** The DSL move's as_if values: a move made as if it were your Movement phase. */
const MOVE_AS_IF_BY_PHASE: Record<string, string> = { movement: "movement-phase" };

/** The DSL permission's as_if values, by the phase a hypothetical phase-window names. */
const AS_IF_BY_PHASE: Record<string, string> = {
  shooting: "shooting-phase", fight: "fight-phase", movement: "movement-phase", charge: "charge-phase", command: "command-phase",
};

/** The phase in which each eligible activity is tested. */
const ELIGIBLE_PHASE: Record<string, string> = { "declare-charge": "charge", shoot: "shooting", fight: "fight" };

const wording = (leaf: CompileLeaf, bytes: Buffer) => bytes.subarray(leaf.start_byte, leaf.end_byte).toString("utf8");

/**
 * "Your unit can declare a charge as if it were your Charge phase": the phase-window there says in
 * which phase's terms the permitted activity happens, not when the ability applies. It folds into
 * the permission or move before it in its sentence as `as_if` ("it can make a Normal move of up to
 * 6" as if it were your Movement phase"). Where the DSL has no as_if value for that
 * phase, or no permission precedes it, the record refuses rather than gating on a real phase.
 */
export function foldAsIfPhases(leaves: readonly CompileLeaf[], sourceText: string | undefined): CompileLeaf[] {
  if (sourceText === undefined) return [...leaves];
  const bytes = Buffer.from(sourceText, "utf8");
  const list = [...leaves];
  const drop = new Set<number>();
  list.forEach((leaf, index) => {
    if (leaf.family_id !== "phase-window" || !HYPOTHETICAL.test(wording(leaf, bytes))) return;
    const phase = String(leaf.parameters.phase);
    const at = list.slice(0, index).map((other, position) => ({ other, position })).reverse()
      .find(({ other }) => (other.family_id === "eligibility-permission" || other.family_id === "make-move") && (other.fragment ?? null) === (leaf.fragment ?? null)
        && !/[.!?](?:\s|$)/u.test(bytes.subarray(other.end_byte, leaf.start_byte).toString("utf8")))?.position;
    if (at === undefined) {
      // "would be eligible to declare a charge … if it were your Charge phase": the eligible test is itself the
      // hypothetical one, so a phase that matches its activity is redundant and the window drops out.
      const test = list.slice(0, index).reverse()
        .find((other) => other.family_id === "eligible" && (other.fragment ?? null) === (leaf.fragment ?? null)
          && !/[.!?](?:\s|$)/u.test(bytes.subarray(other.end_byte, leaf.start_byte).toString("utf8")));
      if (test !== undefined) {
        if (leaf.parameters.turn !== "your") throw new CompileError(`"${wording(leaf, bytes)}" names the ${String(leaf.parameters.turn ?? "unspecified")} turn hypothetically; an eligible condition is tested in your own turn, so only turn: your folds.`);
        if (test.parameters.negated === true || test.parameters.at !== undefined) throw new CompileError(`"${wording(leaf, bytes)}" names a phase hypothetically for an eligible condition that is negated or timed; only a plain eligible condition takes it.`);
        if (ELIGIBLE_PHASE[String(test.parameters.to)] !== phase) throw new CompileError(`"${wording(leaf, bytes)}" names the ${phase} phase, but the eligible condition before it is about ${String(test.parameters.to)}.`);
        drop.add(index);
        return;
      }
      throw new CompileError(`"${wording(leaf, bytes)}" names a phase hypothetically, but no permission before it in its sentence takes it.`);
    }
    const permission = list[at]!;
    const table = permission.family_id === "make-move" ? MOVE_AS_IF_BY_PHASE : AS_IF_BY_PHASE;
    const asIf = table[phase];
    if (asIf === undefined) throw new CompileError(`DSL_GAP: a ${permission.family_id === "make-move" ? "move" : "permission"} cannot act as if it were the ${phase} phase; the DSL as_if has only ${Object.values(table).join(", ")}.`);
    if (permission.parameters.as_if !== undefined && permission.parameters.as_if !== asIf) {
      throw new CompileError(`The permission already acts as if ${String(permission.parameters.as_if)}; "${wording(leaf, bytes)}" says otherwise.`);
    }
    list[at] = { ...permission, parameters: { ...permission.parameters, as_if: asIf } };
    drop.add(index);
  });
  return list.filter((_, index) => !drop.has(index));
}
