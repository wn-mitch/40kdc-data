import { allOf, condition, duration, matchingUnit } from "./compile-conditions.js";
import { dslUnitFilter } from "./compile-unit-filters.js";
import { trigger } from "./compile-triggers.js";
import type { CompileLeaf } from "./compile-fragments.js";
import type { Compiled } from "./compile.js";
import { shapeSignature } from "./compile-placement.js";

type Node = Record<string, unknown>;
function rebind(value: unknown, from: string, to: unknown): unknown {
  if (value === from) return structuredClone(to);
  if (Array.isArray(value)) return value.map((item) => rebind(item, from, to));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rebind(item, from, to)]));
}
const change = (leaf: CompileLeaf, parameters: Node): CompileLeaf => ({ ...leaf, parameters: { ...leaf.parameters, ...parameters } });
const success = (leaves: readonly CompileLeaf[], effect: Node, moment: Node, checks: Extract<Compiled, { ok: true }>["checks"] = []): Compiled => ({
  ok: true, signature: shapeSignature(leaves), mechanics: { effect, trigger: moment, behavior: "reactive", scope: { duration: "resolution" } }, checks,
});

/** Bind an event's friendly recipient separately from its enemy actor, then nest follow-on moments. */
export function compileRecipientReaction(leaves: readonly CompileLeaf[], compile: (leaves: readonly CompileLeaf[]) => Compiled): Compiled | null {
  const moments = leaves.filter((leaf) => leaf.family_id === "event");
  const first = moments[0];
  if (!first) return null;
  const optional = leaves.some((leaf) => leaf.family_id === "optional-use");
  if (first.parameters.kind === "move-ended" && moments.length === 1) {
    const relation = leaves.find((leaf) => leaf.family_id === "unit-position" && leaf.parameters.of === "matching-unit" && leaf.parameters.subject === "event-subject");
    if (!relation) return null;
    const effects = leaves.filter((leaf) => leaf.role === "EFFECT");
    if (!effects.length || effects.some((leaf) => leaf.parameters.subject !== "antecedent")) return null;
    const qualifiers = leaves.filter((leaf) => leaf.role === "CONDITION" && leaf !== relation && leaf.family_id !== "unit-filter");
    if (qualifiers.some((leaf) => leaf.parameters.subject !== "antecedent")) return null;
    const actor = leaves.find((leaf) => leaf.family_id === "unit-filter" && leaf.start_byte < first.start_byte);
    const inner = compile(effects.map((leaf) => change(leaf, { subject: "this-unit" })));
    if (!inner.ok) return inner;
    const pool = matchingUnit(relation, "event-subject");
    const eligibility = allOf([
      condition(change(relation, { subject: "this-unit", of: "event-subject", of_keywords: undefined, of_side: undefined })),
      ...qualifiers.map((leaf) => condition(change(leaf, { subject: "this-unit" }))),
    ]);
    return success(leaves, {
      type: "select-units", selector: { filter: pool, count: { min: 1, max: 1 }, ...(eligibility ? { eligibility } : {}) },
      effect: rebind(inner.mechanics.effect, "this-unit", "selected-unit"),
    }, { ...trigger(first), ...(actor ? { subject: dslUnitFilter(actor) } : {}), ...(optional ? { optional: true } : {}) }, inner.checks);
  }
  if (first.parameters.kind !== "targets-selected" || moments.length !== 2) return null;
  const filter = leaves.find((leaf) => leaf.family_id === "unit-filter" && leaf.start_byte < first.start_byte);
  const reach = leaves.find((leaf) => leaf.family_id === "aura-range" && leaf.start_byte < first.start_byte);
  if (!filter || !reach) return null;
  const next = moments[1]!;
  if (next.parameters.kind !== "model-destroyed" && next.parameters.kind !== "attacks-resolved") return null;
  const phase = leaves.filter((leaf) => leaf.family_id === "phase-window");
  const lifetime = leaves.find((leaf) => leaf.role === "DURATION");
  const variable = "reaction-recipient";
  const recipient = { event_var: variable };
  const destroyed = next.parameters.kind === "model-destroyed";
  const enemy = { selection_var: "reaction-enemy" };
  const bodyLeaves = leaves.filter((leaf) => leaf.start_byte > next.start_byte && leaf.role !== "DURATION" && leaf.family_id !== "optional-use")
    .map((leaf) => change(leaf, Object.fromEntries(Object.entries(leaf.parameters).map(([key, value]) => [
      key, value === "antecedent" || value === "event-subject"
        ? destroyed && leaf.role === "CONDITION" ? "event-object" : "this-unit"
        : value,
    ]))));
  // The same-target restriction names the enemy actor, not the friendly unit whose permission is granted.
  for (let at = 0; at < bodyLeaves.length; at += 1) {
    if (bodyLeaves[at]!.family_id === "targeting-restriction") bodyLeaves[at] = change(bodyLeaves[at]!, { target: "event-subject" });
  }
  const inner = compile(bodyLeaves);
  if (!inner.ok) return inner;
  const boundBody = rebind(inner.mechanics.effect, "this-unit", destroyed ? "event-object" : recipient) as Node;
  const follow: Node = {
    type: "ability-part", trigger: {
      ...trigger(next), ...(destroyed ? { object: { level: "model", member_of: recipient } } : { subject: enemy }),
    }, effect: boundBody,
    duration: lifetime ? duration(lifetime) : "resolution",
  };
  const effect: Node = destroyed ? follow : {
    type: "select-units", selector: { filter: { owner: "enemy" }, count: { min: 1, max: 1 }, bind_as: "reaction-enemy",
      eligibility: { type: "same-unit", parameters: { subject: "this-unit", as: "event-subject" } } }, effect: follow,
  };
  const gate = allOf(phase.map(condition));
  return success(leaves, effect, {
    ...trigger(first), object: { ...dslUnitFilter(filter), within: { range: { inches: reach.parameters.inches }, of: reach.parameters.of ?? "this-model" } },
    binds_event_variable: variable, ...(gate ? { condition: gate } : {}), ...(optional ? { optional: true } : {}),
  }, inner.checks);
}
