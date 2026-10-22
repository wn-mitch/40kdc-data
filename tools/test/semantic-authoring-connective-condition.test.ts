import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { lowerConditionOf, type ConnectiveContext } from "../src/semantic-authoring/compile-connective-lower.js";
import { planConditionOf } from "../src/semantic-authoring/compile-connective-plan.js";
import { annotated, placed, type Item } from "./semantic-authoring-connective-fixture.js";

type Node = Record<string, any>;

const IF_IT_DOES = [{ surface: "If it does" }];
const mechanicsOf = (text: string, leaves: CompileLeaf[]) => {
  const result = compileLeaves(leaves, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as { effect: Node; trigger: Node | null; behavior: string };
};
const refusal = (text: string, leaves: CompileLeaf[]) => {
  const result = compileLeaves(leaves, text);
  return result.ok ? null : result.errors.join("; ");
};
/** Every node of a tree whose `type` is `type`, depth-first. */
const nodesOf = (tree: unknown, type: string): Node[] => {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodesOf(item, type));
  if (tree === null || typeof tree !== "object") return [];
  const node = tree as Node;
  return [...(node.type === type ? [node] : []), ...Object.values(node).flatMap((value) => nodesOf(value, type))];
};
const typesOf = (node: Node): string[] => node.type === "sequence" ? node.steps.map((step: Node) => step.type) : [node.type];

const fires: Item = ["After the squad fires", "event", { kind: "after-shooting" }];
const relocate: Item = ["it can relocate 5 inches", "make-move", { subject: "this-unit", move_type: "normal", distance: 5 }];
const rite: Item = ["it can perform its rite", "ability-activate", { subject: "this-unit", ability: "fixture-rite" }];
const untilTurnEnds: Item = ["until the turn ends", "duration", { endpoint: "end-of-turn" }];
const barred: Item = ["the squad is barred from charging", "eligibility-permission", { subject: "this-unit", activity: "declare-charge", allow: false }];
const saves: Item = ["The squad has +1 to saves", "characteristic-modifier", { subject: "this-unit", characteristics: ["Sv"], operation: "improve", value: 1, weapon_type: "all" }];
const shaken: Item = ["the squad is shaken", "battle-shock-state", { recipient: "this-unit", set: true }];

describe("a reviewed condition-of after a bare permission", () => {
  const TEXT = "After the squad fires, it can relocate 5 inches. If it does, until the turn ends, the squad is barred from charging.";
  const leaves = () => placed(TEXT, fires, relocate, untilTurnEnds, barred);

  it("makes the moment the player's choice, as an optional-use would", () => {
    const { trigger, effect } = mechanicsOf(TEXT, annotated(TEXT, leaves(), IF_IT_DOES));
    expect(trigger).toMatchObject({ event: "attacks-resolved", optional: true });
    expect(typesOf(effect)).toEqual(["move", "permission"]);
  });

  it("changes nothing without the annotation, or with a relation the compiler does not consume", () => {
    const bare = mechanicsOf(TEXT, leaves());
    expect(bare.trigger?.optional).toBeUndefined();
    expect(mechanicsOf(TEXT, annotated(TEXT, leaves(), [{ surface: "If it does", relation: "coexists-with" }]))).toEqual(bare);
  });

  it("marks the shape signature, so an approval of the ungated shape does not carry over", () => {
    const signature = (list: CompileLeaf[]) => compileLeaves(list, TEXT).signature;
    expect(signature(annotated(TEXT, leaves(), IF_IT_DOES))).toContain("IF(condition-of) · DURATION(duration)");
    expect(signature(leaves())).not.toContain("IF(");
  });

  it("refers back to the nearest permission, not an earlier one in another sentence", () => {
    const text = "After the squad fires, it can relocate 5 inches. Then it can perform its rite. If it does, until the turn ends, the squad is barred from charging.";
    const { trigger, effect } = mechanicsOf(text, annotated(text, placed(text, fires, relocate, rite, untilTurnEnds, barred), IF_IT_DOES));
    expect(trigger?.optional).toBeUndefined();
    const [part] = nodesOf(effect, "ability-part");
    expect(part).toMatchObject({ optional: true });
    expect(typesOf(part!.effect)).toEqual(["ability-activate", "permission"]);
    // The move is not under the choice, and the gated effects appear only inside it.
    expect(typesOf(effect)).toEqual(["move", "ability-part"]);
  });

  it("holds a later sentence out of the choice", () => {
    const text = "After the squad fires, it can relocate 5 inches. If it does, the squad is barred from charging. The squad has +1 to saves.";
    const { trigger, effect } = mechanicsOf(text, annotated(text, placed(text, fires, relocate, barred, saves), IF_IT_DOES));
    expect(trigger?.optional).toBeUndefined();
    const [part] = nodesOf(effect, "ability-part");
    expect(typesOf(part!.effect)).toEqual(["move", "permission"]);
    expect(JSON.stringify(part)).not.toContain('"Sv"');
    expect(typesOf(effect)).toEqual(["ability-part", "stat-modifier"]);
  });

  it("keeps a clause after 'but' in the choice, since it is the same sentence", () => {
    const text = "After the squad fires, it can perform its rite. If it does, it can be set down anywhere, but until the turn ends, the squad is barred from charging. The squad has +1 to saves.";
    const setDown: Item = ["it can be set down anywhere", "set-up", { subject: "this-unit", to: "battlefield", min_enemy_distance: 6 }];
    const { effect } = mechanicsOf(text, annotated(text, placed(text, fires, rite, setDown, untilTurnEnds, barred, saves), IF_IT_DOES));
    const [part] = nodesOf(effect, "ability-part");
    expect(typesOf(part!.effect)).toEqual(["ability-activate", "set-up", "permission"]);
    expect(JSON.stringify(part)).not.toContain('"Sv"');
    expect(typesOf(effect)).toEqual(["ability-part", "stat-modifier"]);
  });

  it("makes only the later part optional when the permission follows a second moment", () => {
    const text = "When the fight phase begins, the squad is shaken. Each time the squad is picked to fight, it can perform its rite. If it does, until the phase ends, its wounds are critical on a 5+.";
    const leavesOf = () => placed(text,
      ["When the fight phase begins", "event", { kind: "phase-start", phase: "fight", turn: "either" }], shaken,
      ["Each time the squad is picked to fight", "event", { kind: "selected", to: "fight" }], rite,
      ["until the phase ends", "duration", { endpoint: "end-of-phase" }],
      ["its wounds are critical on a 5+", "critical-hit-threshold", { roll: "wound", value: 5 }]);
    const { effect, trigger } = mechanicsOf(text, annotated(text, leavesOf(), IF_IT_DOES));
    const tree = JSON.stringify({ effect, trigger });
    const parts = nodesOf({ effect, trigger }, "ability-part");
    const picked = parts.find((part) => part.trigger?.event === "selected");
    expect(picked).toBeDefined();
    expect(picked!.optional === true || picked!.trigger.optional === true).toBe(true);
    // The first moment stays mandatory.
    const started = [...parts.map((part) => part.trigger), trigger].find((moment) => moment?.event === "phase-started");
    expect(started).toBeDefined();
    expect(started!.optional).toBeUndefined();
    expect(tree.match(/"optional":true/gu)).toHaveLength(1);
    // Without the annotation nothing is optional.
    expect(JSON.stringify(mechanicsOf(text, leavesOf()))).not.toContain('"optional"');
  });
});

describe("a reviewed condition-of in a Stratagem", () => {
  const TEXT = "WHEN: Your shooting phase. TARGET: One squad from your army. EFFECT: Your squad can relocate 5 inches. If it does, until the turn ends, the squad is barred from charging.";
  const leaves = () => placed(TEXT,
    ["Your shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"],
    ["One", "stratagem-target", { count: "one" }, "TARGET"], ["squad from your army", "unit-filter", { side: "friendly" }, "TARGET"],
    ["Your squad can relocate 5 inches", "make-move", { subject: "this-unit", move_type: "normal", distance: 5 }, "EFFECT"],
    [...untilTurnEnds, "EFFECT"] as Item, [...barred, "EFFECT"] as Item);

  it("nests the permission and its consequents in one optional part", () => {
    const { effect } = mechanicsOf(TEXT, annotated(TEXT, leaves(), [{ surface: "If it does", fragment: "EFFECT" }]));
    expect(effect).toMatchObject({ type: "ability-part", optional: true });
    expect(typesOf(effect.effect)).toEqual(["move", "permission"]);
    expect(nodesOf(mechanicsOf(TEXT, leaves()).effect, "ability-part")).toHaveLength(0);
  });
});

describe("refusals", () => {
  it("R1: nothing before the connective says what the player does", () => {
    const text = "If it does, the squad is barred from charging.";
    expect(refusal(text, annotated(text, placed(text, barred), IF_IT_DOES))).toMatch(/no leaf before it in its fragment/u);
  });

  it("R2: the antecedent is not something the player can decline", () => {
    const text = "After the squad fires, the squad is shaken. If it does, the squad is barred from charging.";
    expect(refusal(text, annotated(text, placed(text, fires, shaken, barred), IF_IT_DOES))).toMatch(/battle-shock-state, which the player cannot decline/u);
  });

  it("R3: the consequence is written as a condition, not an effect", () => {
    const text = "After the squad fires, it can relocate 5 inches. If it does, until the turn ends, the squad cannot charge.";
    const leaves = placed(text, fires, relocate, untilTurnEnds, ["the squad cannot charge", "eligible", { subject: "this-unit", to: "declare-charge", negated: true }]);
    expect(refusal(text, annotated(text, leaves, IF_IT_DOES))).toMatch(/\(eligible\) must be reviewed as an effect/u);
    // Unannotated, the leaves keep compiling as they did.
    expect(refusal(text, leaves)).toBeNull();
  });

  it("R4: a moment among the consequents", () => {
    const text = "After the squad fires, it can perform its rite. If it does, each time the squad is picked to fight, the squad is shaken.";
    const leaves = placed(text, fires, rite, ["each time the squad is picked to fight", "event", { kind: "selected", to: "fight" }], shaken);
    expect(refusal(text, annotated(text, leaves, IF_IT_DOES))).toMatch(/followed by a moment in its sentence/u);
  });

  it("R5: a consequent under a roll result the permission does not share", () => {
    const text = "After the squad fires, it can relocate 5 inches. If it does, roll one D6: on a 1, the squad is shaken. The squad has +1 to saves.";
    const leaves = placed(text, fires, relocate, ["roll one D6", "dice-roll", { dice: "D6" }], ["on a 1", "roll-result", { from: 1, to: 1 }], shaken, saves);
    expect(refusal(text, annotated(text, leaves, IF_IT_DOES))).toMatch(/roll result the permission does not share/u);
  });

  it("R6: one permission's consequent is the next one's permission", () => {
    const text = "After the squad fires, it can relocate 5 inches. If it does, it can perform its rite. If it does, the squad is barred from charging.";
    const leaves = placed(text, fires, relocate, rite, barred);
    const both = annotated(text, leaves, [{ surface: "If it does" }, { surface: "If it does", after: "its rite" }]);
    expect(refusal(text, both)).toMatch(/ranges overlap/u);
  });

  const context = (list: CompileLeaf[], overrides: Partial<ConnectiveContext> = {}): ConnectiveContext => ({
    list, planned: [], partOf: () => 0, partMoments: [[]], rawOf: list.map(() => 0), stratagem: false, optional: false, optionalSentence: -1,
    optionalSpend: false, aura: false, splitWindow: false, consumed: new Set(), designationOptional: new Set(), optionalTarget: () => false, held: new Set(), ...overrides,
  });

  it("R7: the permission was folded away before lowering", () => {
    const text = "After the squad fires, it can relocate 5 inches. If it does, the squad is barred from charging.";
    const leaves = annotated(text, placed(text, fires, relocate, barred), IF_IT_DOES);
    const plans = planConditionOf(leaves, text);
    const folded = leaves.filter((leaf) => leaf.family_id !== "make-move");
    expect(() => lowerConditionOf(plans, context(folded))).toThrow(/was folded into another leaf/u);
  });

  it("R8: an optional-use that 'if you do' restates must offer the use", () => {
    const text = "At the start of the fight phase, you can use this. If you do, the squad is shaken.";
    const leaves = annotated(text, placed(text,
      ["At the start of the fight phase", "event", { kind: "phase-start", phase: "fight", turn: "either" }],
      ["you can use this", "optional-use", { who: "you" }], shaken), [{ surface: "If you do" }]);
    const plans = planConditionOf(leaves, text);
    expect(plans).toMatchObject([{ kind: "use" }]);
    expect(() => lowerConditionOf(plans, context(leaves))).toThrow(/offers nothing the compiler makes optional/u);
    expect(() => lowerConditionOf(plans, context(leaves, { optional: true }))).not.toThrow();
  });
});

describe("connectives that already say nothing new", () => {
  const same = (text: string, leaves: CompileLeaf[], connectives: Parameters<typeof annotated>[2]) => {
    const plain = compileLeaves(leaves, text);
    const marked = compileLeaves(annotated(text, leaves, connectives), text);
    expect(plain.ok).toBe(true);
    expect(marked.ok).toBe(true);
    if (plain.ok && marked.ok) expect(marked.mechanics).toEqual(plain.mechanics);
    return { plain, marked };
  };

  it("a bare 'while' before its condition leaf", () => {
    const text = "While the squad is led, it can re-roll Hit rolls of 1.";
    const leaves = placed(text, ["the squad is led", "leading-unit", { subject: "this-model", attachment: "leading" }],
      ["it can re-roll Hit rolls of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }]);
    const { plain, marked } = same(text, leaves, [{ surface: "While" }]);
    expect(marked.signature).toBe(plain.signature);
  });

  it("the tall-terrain rider, whose connective sits inside its own condition leaf", () => {
    const text = "Each time the walker moves, it can also cross tall ruins, but if it does, after it has moved, roll one D6: on a 1, the walker is shaken.";
    const leaves = placed(text,
      ["Each time the walker moves", "event", { kind: "move-ended", move_types: ["normal"], subject: "this-model" }],
      ["it can also cross tall ruins", "move-through", { subject: "antecedent", passthrough: "tall-terrain" }],
      ["but if it does", "move-passthrough-used", { passthrough: "tall-terrain" }],
      ["after it has moved", "event", { kind: "move-ended", subject: "antecedent" }],
      ["roll one D6", "dice-roll", { dice: "D6" }], ["on a 1", "roll-result", { from: 1, to: 1 }],
      ["the walker is shaken", "battle-shock-state", { recipient: "this-unit", set: true }]);
    const { plain, marked } = same(text, leaves, [{ surface: "if it does" }]);
    expect(marked.signature).toBe(plain.signature);
  });

  it("'if you do' restating an optional-use", () => {
    const text = "At the start of the fight phase, you can use this. If you do, until the phase ends, the squad has +1 to saves.";
    same(text, placed(text,
      ["At the start of the fight phase", "event", { kind: "phase-start", phase: "fight", turn: "either" }],
      ["you can use this", "optional-use", { who: "you" }], ["until the phase ends", "duration", { endpoint: "end-of-phase" }],
      ["the squad has +1 to saves", "characteristic-modifier", { subject: "this-unit", characteristics: ["Sv"], operation: "improve", value: 1, weapon_type: "all" }]), [{ surface: "If you do" }]);
  });

  it("'if you do' after a roll the optional-use offers, with its result bands", () => {
    const text = "In your movement phase, you can roll one D6. If you do, on a 1, the squad is shaken; on a 2+, the squad has +1 to saves.";
    same(text, placed(text,
      ["In your movement phase", "phase-window", { phase: "movement", turn: "your" }],
      ["you can", "optional-use", { who: "you" }], ["roll one D6", "dice-roll", { dice: "D6" }],
      ["on a 1", "roll-result", { from: 1, to: 1 }], shaken, ["on a 2+", "roll-result", { from: 2 }],
      ["the squad has +1 to saves", "characteristic-modifier", { subject: "this-unit", characteristics: ["Sv"], operation: "improve", value: 1, weapon_type: "all" }]), [{ surface: "If you do" }]);
  });
});

describe("a granted body", () => {
  const TEXT = "Friendly GLOOM WARDENS units have the following ability:\n**Fade Step:** After the squad fires, it can relocate 5 inches. If it does, until the turn ends, the squad is barred from charging.";
  const leaves = () => placed(TEXT,
    ["Friendly GLOOM WARDENS units", "unit-filter", { side: "friendly", keywords: ["GLOOM WARDENS"] }],
    ["have the following ability", "ability-record-grant", { subject: "antecedent", printed: "one" }],
    ["Fade Step", "granted-ability-name", { label: "Fade Step" }], fires, relocate, untilTurnEnds, barred);

  it("carries the annotation into the body it prints, which compiles as its holder's own", () => {
    const definitionOf = (list: CompileLeaf[]) => (nodesOf(mechanicsOf(TEXT, list).effect, "ability-grant")[0]!.modifier.definition as Node);
    const marked = definitionOf(annotated(TEXT, leaves(), IF_IT_DOES));
    expect(JSON.stringify(marked)).toContain('"optional":true');
    expect(JSON.stringify(definitionOf(leaves()))).not.toContain('"optional"');
  });
});
