import { describe, expect, it } from "vitest";

import { bindAntecedents } from "../src/round5c/compile-antecedent.js";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

/** Every node of a compiled tree whose `type` is `type`, in order. */
function nodesOf(node: unknown, type: string): Record<string, any>[] {
  if (node === null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => nodesOf(child, type));
  const record = node as Record<string, any>;
  return [...(record.type === type ? [record] : []), ...Object.values(record).flatMap((child) => nodesOf(child, type))];
}

const SHOOTING_OR_FIGHT = "In your Shooting phase and the Fight phase, add 1 to the Hit roll for this unit.";

describe("Round 5C phase windows joined by 'and' as alternatives", () => {
  it("folds two different phases into one either-phase condition, keeping the turn on the first", () => {
    const result = compileLeaves(placed(SHOOTING_OR_FIGHT,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["the Fight phase", "phase-window", { phase: "fight" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), SHOOTING_OR_FIGHT);
    expect(result.ok).toBe(true);
    const condition = (result.ok ? result.mechanics : {}) as Record<string, any>;
    expect(condition.effect.condition).toEqual({
      operator: "or",
      operands: [
        { operator: "and", operands: [{ type: "phase-is", parameters: { phase: "shooting" } }, { type: "player-turn-is", parameters: { turn: "your-turn" } }] },
        { type: "phase-is", parameters: { phase: "fight" } },
      ],
    });
  });

  it("does not fold two windows of the same phase, which stay one conjunction", () => {
    const text = "In your Shooting phase and your Shooting phase, add 1 to the Hit roll for this unit.";
    const result = compileLeaves(placed(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["your Shooting phase", "phase-window", { phase: "shooting" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), text);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.ok ? result.mechanics : {})).not.toContain('"operator":"or"');
  });
});

describe("Round 5C weapon-scoped change on an attached leader's own model", () => {
  const TEXT = "While this model is leading a unit, add 1 to the Attacks and Strength characteristics of Psychic weapons equipped by this model.";
  const ITEMS: Item[] = [
    ["While this model is leading a unit", "leading-unit", { attachment: "led", subject: "this-model" }],
    ["add 1 to the Attacks and Strength characteristics of Psychic weapons equipped by this model", "characteristic-modifier",
      { subject: "this-model", characteristics: ["A", "S"], operation: "add", value: 1, weapon_type: "all", weapon_keyword: "Psychic" }],
  ];

  it("keeps the bearer model as the target so the Psychic scope stays on its own weapons", () => {
    const result = compileLeaves(placed(TEXT, ...ITEMS), TEXT);
    expect(result.ok).toBe(true);
    const steps = nodesOf(result.ok ? result.mechanics : {}, "stat-modifier");
    expect(steps.map((step) => step.target)).toEqual(["this-model", "this-model"]);
    expect(steps.every((step) => step.modifier.weapon_keyword === "Psychic")).toBe(true);
  });

  it("still widens a non-weapon change on the attached leader to its unit", () => {
    const text = "While this model is leading a unit, add 1 to the Wounds characteristic of this model.";
    const result = compileLeaves(placed(text,
      ["While this model is leading a unit", "leading-unit", { attachment: "led", subject: "this-model" }],
      ["add 1 to the Wounds characteristic of this model", "characteristic-modifier", { subject: "this-model", characteristics: ["W"], operation: "add", value: 1 }]), text);
    expect(result.ok).toBe(true);
    expect(nodesOf(result.ok ? result.mechanics : {}, "stat-modifier").map((step) => step.target)).toEqual(["this-unit"]);
  });
});

describe("Round 5C selection whose effect sits on a later moment", () => {
  const TEXT = "Each time a friendly Psyker model is destroyed, select one of those models with this ability. When that selected model attempts a Ritual, it has +1 to the test.";
  const SELECTION: Item[] = [
    ["Each time a friendly Psyker model is destroyed", "event", { kind: "model-destroyed" }],
    ["select one", "select-unit", { distance: "any", visible: false }],
    ["of those models", "unit-filter", { side: "friendly", keywords: ["PSYKER"], level: "model" }],
  ];
  const RITUAL: Item = ["When that selected model attempts a Ritual", "event", { kind: "used", activity: "ritual" }];
  const EFFECT: Item = ["it has +1 to the test", "roll-modifier", { roll: "psychic", operation: "add", value: 1, subject: "selected-unit" }];

  it("refuses a selected unit's effect that follows a later event instead of placing it at the selection", () => {
    const result = compileLeaves(placed(TEXT, ...SELECTION, RITUAL, EFFECT), TEXT);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("later moment");
  });

  it("does not refuse the selected unit's own attacks, which are the designation's duration", () => {
    const text = "At the start of the Fight phase, select one enemy unit. Until the end of the phase, each time a model in that unit makes an attack, subtract 1 from the Hit roll.";
    const result = compileLeaves(placed(text,
      ["At the start of the Fight phase", "event", { kind: "phase-start", phase: "fight", turn: "either" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["each time a model in that unit makes an attack", "attack", { direction: "makes", unit: "that-unit", attack_type: "any" }],
      ["subtract 1 from the Hit roll", "roll-modifier", { roll: "hit", operation: "subtract", value: 1, subject: "selected-unit" }]), text);
    expect(result.ok ? "" : result.errors.join(" ")).not.toContain("later moment");
  });

  it("compiles the same selection when its effect follows no later event", () => {
    const text = "When a friendly Psyker model is destroyed, select one of those models. It has +1 to the test.";
    const result = compileLeaves(placed(text,
      ["When a friendly Psyker model is destroyed", "event", { kind: "model-destroyed" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["of those models", "unit-filter", { side: "friendly", keywords: ["PSYKER"], level: "model" }],
      ["It has +1 to the test", "roll-modifier", { roll: "psychic", operation: "add", value: 1, subject: "selected-unit" }]), text);
    expect(result.ok).toBe(true);
  });
});

describe("Round 5C antecedent 'of' after an attack the record makes", () => {
  const TEXT = "Once per turn, when an enemy unit makes a ranged attack that targets a friendly NECRONS unit within 3\" of a model with this ability, select one model with this ability that is within 3\" of that target can shoot.";
  const LEAVES = (): CompileLeaf[] => placed(TEXT,
    ["Once per turn", "usage-scope", { per: "unit" }],
    ["when an enemy unit makes a ranged attack", "attack", { direction: "makes", unit: "enemy-unit", attack_type: "ranged" }],
    ["friendly NECRONS unit", "unit-filter", { side: "friendly", keywords: ["NECRONS"] }],
    ["select one", "select-unit", { distance: "any", visible: false }],
    ["within 3\" of that target", "unit-position", { kind: "within", inches: 3, of: "antecedent", subject: "selected-unit", negated: false }],
    ["can shoot", "eligibility-permission", { subject: "antecedent", activity: "shoot", allow: true, as_if: "shooting-phase" }]);

  it("binds the 'of' of that target to the attacked unit, and the permission's subject to the selection", () => {
    const bound = bindAntecedents(LEAVES());
    expect(bound.find((leaf) => leaf.family_id === "unit-position")?.parameters.of).toBe("target");
    expect(bound.find((leaf) => leaf.family_id === "eligibility-permission")?.parameters.subject).toBe("selected-unit");
  });

  it("leaves 'of' bound to the selection when no attack precedes it", () => {
    const leaves = LEAVES().filter((leaf) => leaf.family_id !== "attack");
    const position = bindAntecedents(leaves).find((leaf) => leaf.family_id === "unit-position");
    expect(position?.parameters.of).toBe("selected-unit");
  });
});

describe("Round 5C selection shapes of the model-selection rows", () => {
  it("binds a model-level membership to the ability's own unit as a same-unit eligibility", () => {
    const text = "Each time that unit is selected, select one Bodyguard model in that unit; that model is destroyed.";
    const result = compileLeaves(placed(text,
      ["Each time that unit is selected", "event", { kind: "selected", to: "shoot", subject: "this-unit" }],
      ["select one", "select-unit", { distance: "any", visible: false, bind_as: "bodyguard" }],
      ["Bodyguard model", "unit-filter", { side: "friendly", any_keywords: ["BODYGUARD"], level: "model" }],
      ["in that unit", "membership", { relation: "in", of: "this-unit" }],
      ["that model is destroyed", "destroy-models", { recipient: "selected-unit" }]), text);
    expect(result.ok).toBe(true);
    const selector = nodesOf(result.ok ? result.mechanics : {}, "select-units")[0]!.selector;
    expect(selector.eligibility.operands).toContainEqual({ type: "same-unit", parameters: { as: "ability-unit" } });
  });

  it("binds an enemy selection within range of and visible to the first selection's model", () => {
    const text = "In your Shooting phase, select one friendly EXPLOSIVES model in your unit. Select one unengaged enemy unit within 8\" of and visible to that model. The selected unit suffers 1 mortal wound.";
    const result = compileLeaves(placed(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["select one friendly", "select-unit", { distance: "any", visible: false, bind_as: "shooter" }],
      ["EXPLOSIVES model", "unit-filter", { side: "friendly", any_keywords: ["EXPLOSIVES"], level: "model" }],
      ["Select one unengaged", "select-unit", { distance: "within", inches: 8, visible: true, within_of: "shooter", visible_to: "shooter" }],
      ["enemy unit", "unit-filter", { side: "enemy", states: ["unengaged"] }],
      ["suffers 1 mortal wound", "mortal-wounds", { amount: 1, recipient: "selected-unit" }]), text);
    expect(result.ok).toBe(true);
    const enemy = nodesOf(result.ok ? result.mechanics : {}, "select-units").find((node) => node.selector.owner === "enemy")!.selector;
    expect(enemy).toMatchObject({
      within_inches: 8, visibility_required: true, within_inches_from: { selection_var: "shooter" }, visible_to: { selection_var: "shooter" },
    });
  });

  it("compiles a model selection by its own ability as selector structure only, bound to the record id", () => {
    const text = "When a friendly Psyker model is destroyed, select one of those models with this ability within 9\" of it. It has +1 to the test.";
    const result = compileLeaves(placed(text,
      ["When a friendly Psyker model is destroyed", "event", { kind: "model-destroyed" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["of those models", "unit-filter", { side: "friendly", level: "model" }],
      ["with this ability", "unit-has-ability", { subject: "selected-unit", own: true, negated: false }],
      ["within 9\" of it", "unit-position", { kind: "within", inches: 9, of: "event-object", subject: "selected-unit", negated: false }],
      ["It has +1 to the test", "roll-modifier", { roll: "psychic", operation: "add", value: 1, subject: "selected-unit" }]), text,
    { abilityId: "spirit-snare-zadophon-the-soul-eater-thousand-sons" });
    expect(result.ok).toBe(true);
    const selector = nodesOf(result.ok ? result.mechanics : {}, "select-units")[0]!.selector;
    expect(selector.eligibility.operands).toEqual(expect.arrayContaining([
      { type: "within", parameters: { subject: "selected-unit", of: "event-object", range: { inches: 9 } } },
      { type: "has-ability", parameters: { subject: "selected-unit", ability: "spirit-snare-zadophon-the-soul-eater-thousand-sons" } },
    ]));
  });
});
