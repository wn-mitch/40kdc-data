import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { lowerHistoryMoments, type HistoryPlan } from "../src/semantic-authoring/compile-connective-history.js";
import { planConditionOf } from "../src/semantic-authoring/compile-connective-plan.js";
import { annotated, placed, type Item } from "./semantic-authoring-connective-fixture.js";

type Node = Record<string, any>;

/** A reviewed condition-of "if" before a moment is a condition on what happened (fabricated wording, not rules text). */

const mechanicsOf = (text: string, leaves: CompileLeaf[]) => {
  const result = compileLeaves(leaves, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as { effect: Node; trigger: Node | Node[] | null; behavior: string };
};
const refusal = (text: string, leaves: CompileLeaf[]) => {
  const result = compileLeaves(leaves, text);
  return result.ok ? null : result.errors.join("; ");
};
const nodesOf = (tree: unknown, type: string): Node[] => {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodesOf(item, type));
  if (tree === null || typeof tree !== "object") return [];
  const node = tree as Node;
  return [...(node.type === type ? [node] : []), ...Object.values(node).flatMap((value) => nodesOf(value, type))];
};
/** The text's leaves with a reviewed "if" on the first `surface` at or after `after`. */
const withIf = (text: string, leaves: CompileLeaf[], surface = "if", after?: string) => annotated(text, leaves, [{ surface, ...(after ? { after } : {}) }]);

const fires: Item = ["After the squad fires", "event", { kind: "after-shooting" }];
const lostModel: Item = ["a model in the squad was destroyed", "event", { kind: "model-destroyed" }];
const relocate: Item = ["it can relocate 5 inches", "make-move", { subject: "this-unit", move_type: "normal", distance: 5 }];
const shaken: Item = ["the squad is shaken", "battle-shock-state", { recipient: "this-unit", set: true }];
const attacks: Item = ["each time it makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }];
const sharper: Item = ["improve the Armour Penetration of that attack by 1", "characteristic-modifier", { subject: "attack", characteristics: ["AP"], operation: "improve", value: 1, weapon_type: "all" }];
const pact: Item = ["your squad invokes its pact", "event", { kind: "used", activity: "contract" }];

describe("an earlier moment checks the history over its own event", () => {
  const TEXT = "After the squad fires, if a model in the squad was destroyed by those attacks, it can relocate 5 inches.";
  const leaves = () => placed(TEXT, fires, lostModel, relocate);

  it("keeps the earlier moment as the trigger and gates the effect on what happened during it", () => {
    const { trigger, effect } = mechanicsOf(TEXT, withIf(TEXT, leaves()));
    expect(trigger).toEqual({ event: "attacks-resolved", filter: { kind: "shoot" } });
    expect(effect).toEqual({
      type: "conditional",
      condition: { type: "happened", parameters: { event: "model-destroyed", object: "model-in-this-unit", window: "event" } },
      effect: { type: "move", target: "this-unit", modifier: { move_type: "normal", distance: 5 } },
    });
  });

  it("is a second trigger without the annotation, as it always was", () => {
    const { trigger, effect } = mechanicsOf(TEXT, leaves());
    expect(Array.isArray(trigger) && trigger.map((moment) => moment.event)).toEqual(["attacks-resolved", "model-destroyed"]);
    expect(nodesOf(effect, "conditional")).toHaveLength(0);
  });

  it("takes the window a history-window leaf names", () => {
    const text = "After the squad fires, if a model in the squad was destroyed this turn, it can relocate 5 inches.";
    const list = placed(text, fires, lostModel, ["this turn", "history-window", { window: "turn" }], relocate);
    const [history] = nodesOf(mechanicsOf(text, withIf(text, list)).effect, "happened");
    expect(history!.parameters.window).toBe("turn");
  });

  it("carries the moment's own subject and object into the history", () => {
    const text = "After the squad fires, if an enemy squad was wiped out by the squad, the squad is shaken.";
    const list = placed(text, fires, ["an enemy squad was wiped out by the squad", "event", { kind: "unit-destroyed", by: "this-unit", object_owner: "enemy" }], shaken);
    const [history] = nodesOf(mechanicsOf(text, withIf(text, list)).effect, "happened");
    expect(history!.parameters).toEqual({ event: "destroyed", subject: "this-unit", object: { owner: "enemy" }, window: "event" });
  });
});

describe("with no earlier moment, an attack after it checks the history over the duration before it", () => {
  const TEXT = "WHEN: Your shooting phase. TARGET: One squad from your army. EFFECT: Until the end of the phase, if your squad invokes its pact, each time it makes an attack, improve the Armour Penetration of that attack by 1.";
  const leaves = () => placed(TEXT,
    ["Your shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"],
    ["One", "stratagem-target", { count: "one" }, "TARGET"], ["squad from your army", "unit-filter", { side: "friendly" }, "TARGET"],
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
    [...pact, "EFFECT"] as Item, [...attacks, "EFFECT"] as Item, [...sharper, "EFFECT"] as Item);

  it("is a phase-long modifier gated on the use having happened this phase", () => {
    const annotatedLeaves = annotated(TEXT, leaves(), [{ surface: "if", after: "EFFECT", fragment: "EFFECT" }]);
    const { trigger, effect } = mechanicsOf(TEXT, annotatedLeaves);
    expect(trigger).toBeNull();
    expect(effect).toEqual({
      type: "conditional",
      condition: { type: "happened", parameters: { event: "used", filter: { kind: "contract" }, window: "phase" } },
      effect: { type: "stat-modifier", target: "this-unit", modifier: { stat: "AP", operation: "improve", value: 1 } },
    });
    // Unannotated, the use is the moment the effect starts at.
    expect(mechanicsOf(TEXT, leaves()).trigger).toMatchObject({ event: "used" });
  });
});

describe("refusals", () => {
  it("nothing checks it: the moment is the record's only one and no attack follows it", () => {
    const text = "If a model in the squad was destroyed, the squad is shaken.";
    expect(refusal(text, withIf(text, placed(text, lostModel, shaken), "If"))).toMatch(/nothing that checks what happened: no earlier moment, and no attack after it/u);
  });

  it("nothing checks it: the attack is in an earlier sentence", () => {
    const text = "Until the end of the phase, each time it makes an attack, improve the Armour Penetration of that attack by 1. If a model in the squad was destroyed, the squad is shaken.";
    const list = placed(text, ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }], attacks, sharper, lostModel, shaken);
    expect(refusal(text, withIf(text, list, "If"))).toMatch(/nothing that checks what happened/u);
  });

  it("an attack checks it, but nothing says how far back it looks", () => {
    const text = "If your squad invokes its pact, each time it makes an attack, improve the Armour Penetration of that attack by 1.";
    expect(refusal(text, withIf(text, placed(text, pact, attacks, sharper), "If"))).toMatch(/no duration before it in its sentence and no history-window leaf/u);
  });

  it("several moments before it, with no effect between them", () => {
    const text = "When the squad is picked to fight, after it resolves its attacks, if a model in the squad was destroyed, the squad is shaken.";
    const list = placed(text, ["When the squad is picked to fight", "event", { kind: "selected", to: "fight" }],
      ["after it resolves its attacks", "event", { kind: "attacks-resolved" }], lostModel, shaken);
    expect(refusal(text, withIf(text, list))).toMatch(/follows 2 moments with no effect between them/u);
  });

  it("a game-clock boundary before it, unless a history-window leaf names the window", () => {
    const text = "At the end of the fight phase, if a model in the squad was destroyed, the squad is shaken.";
    const end: Item = ["At the end of the fight phase", "event", { kind: "phase-end", phase: "fight", turn: "either" }];
    expect(refusal(text, withIf(text, placed(text, end, lostModel, shaken)))).toMatch(/looks back from the phase-ended boundary/u);
    const named = "At the end of the fight phase, if a model in the squad was destroyed this phase, the squad is shaken.";
    const list = placed(named, end, lostModel, ["this phase", "history-window", { window: "phase" }], shaken);
    const [history] = nodesOf(mechanicsOf(named, withIf(named, list)).effect, "happened");
    expect(history!.parameters).toEqual({ event: "model-destroyed", object: "model-in-this-unit", window: "phase" });
  });

  it("'while' before a moment says how long, not what happened", () => {
    const text = "Each time the squad is picked to fight, while resolving those attacks, the squad is shaken.";
    const list = placed(text, ["Each time the squad is picked to fight", "event", { kind: "selected", to: "fight" }],
      ["resolving those attacks", "event", { kind: "attacks-resolved" }], shaken);
    expect(refusal(text, withIf(text, list, "while"))).toMatch(/says how long the effects after it last/u);
  });

  it("a spend the player chooses is a cost, not history", () => {
    const text = "After the squad fires, if you spend 1 Fervour point, the squad is shaken.";
    const list = placed(text, fires, ["you spend 1 Fervour point", "event", { kind: "resource-spent", pool: "fervour-pool" }], shaken);
    expect(refusal(text, withIf(text, list))).toMatch(/cost the player chooses to pay/u);
  });

  it("R9: 'if it does' after a moment no optional-use offers", () => {
    const text = "The squad can disembark after it has Advanced. If it does, the squad is barred from charging.";
    const list = placed(text, ["The squad can disembark", "eligibility-permission", { subject: "this-unit", activity: "disembark", allow: true }],
      ["after it has Advanced", "event", { kind: "move-ended", move_types: ["advance"] }],
      ["the squad is barred from charging", "eligibility-permission", { subject: "this-unit", activity: "declare-charge", allow: false }]);
    expect(refusal(text, annotated(text, list, [{ surface: "If it does" }]))).toMatch(/refers back to the move-ended moment/u);
  });

  const planOf = (text: string, list: CompileLeaf[]) => planConditionOf(list, text).filter((plan): plan is HistoryPlan => plan.kind === "history");

  it("a moment whose trigger carries what a history condition cannot", () => {
    const text = "After the squad fires, if the fight phase begins, the squad is shaken.";
    const list = withIf(text, placed(text, fires, ["the fight phase begins", "event", { kind: "phase-start", phase: "fight", turn: "either" }], shaken));
    expect(() => lowerHistoryMoments(list, planOf(text, list))).toThrow(/lowers with condition, which a happened condition does not carry/u);
  });

  it("a moment folded into another leaf", () => {
    const text = "After the squad fires, if a model in the squad was destroyed, the squad is shaken.";
    const list = withIf(text, placed(text, fires, lostModel, shaken));
    const plans = planOf(text, list);
    expect(plans).toHaveLength(1);
    expect(() => lowerHistoryMoments(list.filter((leaf) => leaf.parameters.kind !== "model-destroyed"), plans)).toThrow(/was folded into another leaf/u);
  });
});
