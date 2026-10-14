import type { CutoverContext, Node } from "./vocab-cutover-types.js";

const object = (value: unknown): value is Node => value !== null && typeof value === "object" && !Array.isArray(value);
const durations: Record<string, string> = { "until-end-of-phase": "phase", "until-end-of-turn": "turn", "phase-end": "phase", "turn-end": "turn", "battle-round-end": "battle-round", "battle-end": "battle", never: "permanent", "attack-resolution": "resolution", immediate: "resolution" };
const comparisons: Record<string, string> = { "greater-than": "gt", "greater-than-or-equal": "gte", "greater-than-or-equal-to": "gte", "less-than": "lt", "less-than-or-equal": "lte", "less-than-or-equal-to": "lte", equal: "eq", equals: "eq", "equal-to": "eq", "at-least": "gte", "at-most": "lte" };

// Owner-bound RepoProse inspection: all three tests name the unit of their selection event.
// These keys intentionally do not generalize the ambiguous legacy "target"/"unit" aliases.
const eventTestBindings: Record<string, true> = {
  "grey-knights/channelled-force-grey-knights/effect": true,
  "emperors-children/daemon-primarch-of-slaanesh-emperors-children/effect/effect/options/2/effect": true,
  "world-eaters/wrathful-presence-world-eaters/effect/effect/options/1/effect": true,
};

/** A selection edge is timing, not lifetime. Phase availability deliberately has no trigger. */
export function selectionTiming(value: unknown): { trigger?: Node | Node[]; condition?: Node } | undefined {
  if (value === "army-selection") return { trigger: { event: "army-selected" } };
  if (value === "start-of-battle") return { trigger: { event: "battle-started" } };
  if (value === "on-unit-destroyed") return { trigger: { event: "destroyed", object: "this-unit" } };
  if (value === "start-of-battle-round") return { trigger: { event: "round-started" } };
  if (value === "start-of-first-battle-round") return { trigger: { event: "round-started", condition: { type: "battle-round", parameters: { min: 1, max: 1 } } } };
  if (value === "command-phase") return { condition: { type: "phase-is", parameters: { phase: "command" } } };
  if (value === "start-of-command-phase" || value === "start-of-opponent-command-phase") return { trigger: { event: "phase-started", condition: { operator: "and", operands: [{ type: "phase-is", parameters: { phase: "command" } }, { type: "player-turn-is", parameters: { turn: value === "start-of-opponent-command-phase" ? "opponent-turn" : "your-turn" } }] } } };
  if (value === "shooting-phase") return { condition: { type: "phase-is", parameters: { phase: "shooting" } } };
  if (value === "your-shooting-phase") return { condition: { operator: "and", operands: [{ type: "phase-is", parameters: { phase: "shooting" } }, { type: "player-turn-is", parameters: { turn: "your-turn" } }] } };
  if (value === "shooting-or-fight-phase") return { condition: { operator: "or", operands: [{ type: "phase-is", parameters: { phase: "shooting" } }, { type: "phase-is", parameters: { phase: "fight" } }] } };
  if (value === "start-of-movement-phase" || value === "start-of-shooting-phase") return { trigger: { event: "phase-started", condition: { type: "phase-is", parameters: { phase: value === "start-of-movement-phase" ? "movement" : "shooting" } } } };
  if (value === "start-of-your-shooting-phase") return { trigger: { event: "phase-started", condition: selectionTiming("your-shooting-phase")!.condition } };
  if (value === "after-this-unit-shoots" || value === "after-this-unit-resolves-shooting-attacks") return { trigger: { event: "attacks-resolved", subject: "this-unit", filter: { kind: "shoot" } } };
  if (value === "after-this-unit-attacks" || value === "after-unit-resolves-attacks") return { trigger: { event: "attacks-resolved", subject: "this-unit" } };
  if (value === "when-selected-to-shoot" || value === "when-this-unit-selected-to-shoot") return { trigger: { event: "selected", subject: "this-unit", filter: { to: "shoot" } } };
  if (value === "end-of-normal-move") return { trigger: { event: "move-ended", subject: "this-unit", filter: { move_types: ["normal"] } } };
  if (value === "this-model-starts-or-ends-a-move") return { trigger: [{ event: "move-started", subject: "this-model" }, { event: "move-ended", subject: "this-model" }] };
  if (value === "after-friendly-war-dog-within-9-shoots") return { trigger: { event: "attacks-resolved", subject: { owner: "friendly", all_of: ["WAR DOG"] }, filter: { kind: "shoot" }, proximity: { range: { inches: 9 }, of: "this-model" } } };
  return undefined;
}

export function transformTiming(node: Node, ctx: CutoverContext): Node {
  if (node.at === "opponents-previous-turn-end") node.at = "opponent-previous-turn-end";
  for (const key of ["duration", "expires", "expiry", "clears_on"]) {
    const value = node[key];
    if (typeof value === "string" && durations[value]) node[key] = durations[value];
  }
  for (const key of ["comparison", "compare"]) {
    const value = node[key];
    if (typeof value === "string" && comparisons[value]) node[key] = comparisons[value];
  }
  if (node.period === "round") node.period = "battle-round";
  if (node.move === "normal-move") node.move = "normal";
  if (node.kind === "normal-move") node.kind = "normal";
  for (const key of ["dice", "count", "value", "wounds_remaining"]) {
    if (typeof node[key] === "string" && /^\d*d\d+(?:[+-]\d+)?$/i.test(node[key])) node[key] = node[key].toUpperCase();
  }
  for (const key of ["count", "value", "amount", "min", "max", "threshold", "wounds_remaining"]) {
    const value = node[key];
    if (typeof value === "string" && /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value))) node[key] = Number(value);
  }
  if (node.type === "stance-select") {
    if (node.scope !== undefined) {
      if (node.scope === "unit" || node.scope === "army") delete node.scope;
      else ctx.report("unknown stance scope cannot be removed", node.scope);
    }
    if (node.select !== undefined) {
      const timing = selectionTiming(node.select);
      if (!timing) ctx.report("unrecognized stance selection timing", node.select);
      else {
        delete node.select;
        if (timing.trigger) return { type: "ability-part", trigger: timing.trigger, effect: node };
        return { type: "conditional", condition: timing.condition, effect: node };
      }
    }
  }
  if ((node.type === "designate-target" || node.type === "persistent-designation") && object(node.select) && node.select.timing !== undefined) {
    const timing = selectionTiming(node.select.timing);
    if (!timing) ctx.report("designation timing needs an explicit source-backed trigger", node.select.timing, `${ctx.pointer}/select/timing`);
    else {
      delete node.select.timing;
      return timing.trigger ? { type: "ability-part", trigger: timing.trigger, effect: node } : { type: "conditional", condition: timing.condition, effect: node };
    }
  }
  if (node.type === "dice-gated" && object(node.test) && ["unit", "self", "target"].includes(String(node.test.subject))) {
    const branches = [node.on_success, node.on_fail].filter(object);
    const targets = branches.map((branch) => branch.target).filter((target): target is string => typeof target === "string");
    if (eventTestBindings[`${ctx.faction}/${ctx.record}${ctx.pointer}`]) node.test.subject = "event-subject";
    else if (node.test.subject === "target" && targets.length && targets.every((target) => target === targets[0])) node.test.subject = targets[0];
    else if (node.test.subject === "self" && targets.includes("this-model")) node.test.subject = "this-model";
    else ctx.report("dice test subject requires an explicit source-backed unit binding", node.test);
  }
  return node;
}
