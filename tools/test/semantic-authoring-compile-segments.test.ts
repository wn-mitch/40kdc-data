import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { sentenceSegments } from "../src/semantic-authoring/compile-segments.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";
import { isOutsideDamagePath } from "../src/semantic-authoring/pipeline-8b-gates.js";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
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

/** Two effect sentences, the second opening with `second`; returns how many parts the split makes. */
function partsFor(first: string, second: string): number {
  const text = `${first} add 1 to the Hit roll. ${second} add 1 to the Wound roll.`;
  const list = placed(text,
    ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }]);
  return sentenceSegments(list, text)?.length ?? 1;
}

function mechanicsOf(list: CompileLeaf[], text: string) {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

describe("Semantic authoring independent sentences", () => {
  it("opens a part at a new moment or \"In addition\", but not at a sentence tied back to the one before", () => {
    expect(partsFor("Each time this unit shoots,", "Each time this unit fights,")).toBe(2);
    expect(partsFor("Each time this unit shoots,", "In addition,")).toBe(2);
    expect(partsFor("Each time this unit shoots,", "Once per battle, after this unit fights,")).toBe(2);
    expect(partsFor("Each time this unit shoots,", "At the end of the phase,")).toBe(2);
    expect(partsFor("Each time this unit shoots,", "When doing so,")).toBe(1);
    expect(partsFor("Each time this unit shoots,", "Each time you do,")).toBe(1);
    expect(partsFor("Each time this unit shoots,", "If it does,")).toBe(1);
    expect(partsFor("Each time this unit shoots,", "In addition, each time a model in that unit attacks,")).toBe(1);
    // Later in the sentence, "that unit" is the sentence's own subject.
    expect(partsFor("Each time this unit shoots,", "Each time an enemy unit is destroyed, if that unit was")).toBe(2);
    // A plain follow-on sentence keeps today's binding.
    expect(partsFor("Each time this unit shoots,", "Then")).toBe(1);
  });

  it("keeps a colon's bullets in the part that introduces them", () => {
    const text = "While this unit is near a beacon:\n- Its models add 1 to the Hit roll.\n- Each time it fights, add 1 to the Wound roll.";
    const list = placed(text,
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }]);
    expect(sentenceSegments(list, text)).toBeNull();
  });

  it("gives a listed item with its own phase and selection a part of its own, under the header's condition", () => {
    const text = "While this model is within 3\" of a friendly ALPHA unit:This model has **Stealth**. In your Shooting phase, you can select one friendly ALPHA unit. That unit's attacks can re-roll Hit rolls of 1.";
    const list = placed(text,
      ["this model is within 3\" of a friendly ALPHA unit", "unit-position", { kind: "within", inches: 3, of: "matching-unit", subject: "this-model", negated: false, of_keywords: ["ALPHA"], of_side: "friendly" }],
      ["This model has **Stealth", "core-ability-grant", { subject: "this-model", ability: "stealth" }],
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["you can", "optional-use", { who: "you" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["That unit's attacks can re-roll Hit rolls of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all", subject: "antecedent" }]);
    const steps = mechanicsOf(list, text).effect.steps;
    expect(steps).toHaveLength(2);
    // The grant holds under the header's condition alone; the selection does not reach it.
    expect(steps[0]).toMatchObject({ type: "conditional", condition: { type: "matches" }, effect: { type: "ability-grant", target: "this-model" } });
    expect(JSON.stringify(steps[1])).toContain("\"type\":\"matches\"");
    expect(JSON.stringify(steps[1])).not.toContain("ability-grant");
    expect(JSON.stringify(steps[1])).toContain("\"type\":\"select-units\"");
  });

  it("does not split an ability whose header holds a moment or a usage limit", () => {
    const text = "Once per battle. Each time this unit shoots, add 1 to the Hit roll. Each time this unit fights, add 1 to the Wound roll.";
    const list = placed(text,
      ["Once per battle", "usage-limit", { frequency: "once-per-battle" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }]);
    expect(sentenceSegments(list, text)).toBeNull();
  });

  it("gives each part its own duration instead of failing on conflicting ones, and keeps the header on both", () => {
    const text = "Your Movement phase. One ALPHA unit from your army. Until the end of the turn, ranged weapons equipped by models in your unit have the [ASSAULT] ability. In addition, until the end of the phase, you can re-roll Advance rolls made for your unit.";
    const list = placed(text,
      ["Your Movement phase", "use-window", { your_phases: ["movement"], opponent_phases: [], either_phases: [] }],
      ["One", "stratagem-target", { count: "one" }],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }],
      ["ranged weapons equipped by models in your unit have the", "weapon-ability-grant", { subject: "this-unit", weapon_type: "ranged" }],
      ["ASSAULT", "weapon-ability-keyword", { keyword: "Assault" }],
      ["until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["you can", "optional-use", { who: "you" }],
      ["re-roll Advance rolls made for your unit", "reroll", { roll: "advance", subset: "all", weapon_type: "all" }]);
    const result = compileLeaves(list, text);
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (!result.ok) return;
    const steps = (result.mechanics as unknown as Record<string, any>).effect.steps as Array<Record<string, any>>;
    expect(steps.map((step) => [step.type, step.duration])).toEqual([["ability-part", "turn"], ["ability-part", "phase"]]);
    expect(result.core?.target_restrictions).toBeDefined();
    expect(result.checks.filter((check) => check.kind === "use-window")).toHaveLength(1);
  });

  it("keeps an earlier sentence's condition off a later moment", () => {
    const text = "Each time this model makes an attack that targets a unit that is Below Half-strength, add 1 to the Hit roll. Each time an enemy unit is destroyed as the result of this model's attacks, this model regains up to D3 lost wounds.";
    const list = placed(text,
      ["Each time this model makes an attack", "attack", { direction: "makes", unit: "this-model", attack_type: "any" }],
      ["that targets a unit that is Below Half-strength", "unit-state", { states: ["below-half-strength"], subject: "target", negated: false }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["is destroyed as the result of this model's attacks", "event", { kind: "unit-destroyed", by: "this-model" }],
      ["this model regains up to D3 lost wounds", "regain-wounds", { subject: "this-model", amount: "D3" }]);
    const mechanics = mechanicsOf(list, text);
    const steps = mechanics.effect.steps as Array<Record<string, any>>;
    expect(steps).toHaveLength(2);
    expect(JSON.stringify(steps[0])).toContain('"below":"half"');
    const destroyed = steps[1]!;
    expect(destroyed.type).toBe("ability-part");
    expect(destroyed.trigger).toBeDefined();
    expect(JSON.stringify(destroyed)).not.toContain('"below":"half"');
    expect(mechanics.trigger).toBeNull();
  });

  it("lowers an army-construction sentence outside an earlier sentence's phase gate", () => {
    const text = "In the Fight phase, add 1 to the Hit roll for this unit. Restrictions: Your army can include GAMMA units.";
    const list = placed(text,
      ["In the Fight phase", "phase-window", { phase: "fight" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
      ["Your army can include GAMMA units", "army-construction", { rule: "composition", with_keywords: ["GAMMA"] }]);
    const steps = mechanicsOf(list, text).effect.steps as Array<Record<string, any>>;
    expect(steps).toHaveLength(2);
    expect(JSON.stringify(steps[0])).toContain('"phase-is"');
    expect(JSON.stringify(steps[1])).not.toContain('"phase-is"');
    expect(JSON.stringify(steps[1])).toContain("GAMMA");
  });

  it("compiles as one part when a later sentence cannot stand alone", () => {
    // "instead" replaces the first sentence's effect, so the moment sentence stays tied to it.
    const text = "This model has the Feel No Pain 5+ ability. At the start of any turn, if this model has lost wounds, until the end of the battle, it has the Feel No Pain 4+ ability instead.";
    const list = placed(text,
      ["This model has the Feel No Pain 5+ ability", "feel-no-pain", { subject: "this-model", threshold: 5, against: "all" }],
      ["At the start of any turn", "turn-start", { turn: "player-turn" }],
      ["this model has lost wounds", "wounds-state", { subject: "this-model", kind: "lost", negated: false }],
      ["until the end of the battle", "duration", { endpoint: "end-of-battle" }],
      ["it has the Feel No Pain 4+", "feel-no-pain", { subject: "this-model", threshold: 4, against: "all" }],
      ["instead", "instead", {}]);
    expect(sentenceSegments(list, text)).toHaveLength(2);
    const result = compileLeaves(list, text);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });
});

describe("Semantic authoring moments in a row within a later part", () => {
  const opening = "Each time this unit is selected to move, it can use this ability. If it does, until the end of the turn, models in it have a Move characteristic of 20.";
  const head = (text: string) => placed(text,
    ["Each time this unit is selected to move", "event", { kind: "selected", to: "move" }],
    ["it can use this ability", "optional-use", { who: "this-unit" }],
    ["until the end of the turn", "duration", { endpoint: "end-of-turn" }],
    ["models in it have a Move characteristic of 20", "characteristic-set", { subject: "this-unit", characteristic: "M", value: 20 }]);
  const wound = ["this unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }] as [string, string, Record<string, unknown>];

  it("refuses a moment nested in another, which a trigger list would fire on either", () => {
    const text = `${opening} Each time this unit uses this ability, at the end of the phase, this unit suffers 1 mortal wound.`;
    const list = [...head(text), ...placed(text,
      ["Each time this unit uses this ability", "event", { kind: "used", activity: "ability" }],
      ["at the end of the phase", "event", { kind: "phase-end", phase: "any", turn: "either" }], wound)];
    const result = compileLeaves(list, text);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join("; ")).toMatch(/moment nested in another/u);
  });

  it("keeps moments joined by \"or\", or listed with a final \"or\", as alternatives", () => {
    const text = `${opening} Each time this unit shoots, fights, or charges, this unit suffers 1 mortal wound.`;
    const list = [...head(text), ...placed(text,
      ["shoots", "event", { kind: "selected", to: "shoot" }],
      ["fights", "event", { kind: "selected", to: "fight" }],
      ["charges", "event", { kind: "targets-selected", action_kind: "charge" }], wound)];
    const parts = mechanicsOf(list, text).effect.steps;
    expect(parts.at(-1).trigger).toHaveLength(3);
    const near = `${opening} Each time this unit shoots, fights, this unit suffers 1 mortal wound.`;
    const loose = [...head(near), ...placed(near,
      ["shoots", "event", { kind: "selected", to: "shoot" }],
      ["fights", "event", { kind: "selected", to: "fight" }], wound)];
    expect(compileLeaves(loose, near).ok).toBe(false);
  });
});

describe("Semantic authoring crunch gate: effects off the damage path", () => {
  const unsupported = (effect: Record<string, unknown>) =>
    effectToBuffs(effect, { kind: "ability", abilityId: "fixture", abilityKind: "unit" }, {}).unsupported;

  it("does not count a Stratagem cost or a use-count lift as an unrecognised shape", () => {
    const cost = unsupported({ type: "cost-modifier", target: "this-unit", modifier: { of: "stratagem", operation: "decrease", amount: 1 } });
    const uses = unsupported({ type: "ability-modifier", target: "this-unit", modifier: { ability: "heroic-intervention", aspect: "uses", operation: "lift-limit", value: 1 } });
    expect(cost.length).toBeGreaterThan(0);
    expect(uses.length).toBeGreaterThan(0);
    expect([...cost, ...uses].every(isOutsideDamagePath)).toBe(true);
  });

  it("counts a reminder token as off the damage path, but not a weapon it travels with", () => {
    const token = unsupported({ type: "marker", target: "this-model", modifier: { label: "Fixture token", operation: "place" } });
    expect(token.length).toBeGreaterThan(0);
    expect(token.every(isOutsideDamagePath)).toBe(true);
    const mixed = unsupported({ type: "sequence", steps: [
      { type: "marker", target: "this-model", modifier: { label: "Fixture token", operation: "place" } },
      { type: "rule-state", target: "this-unit", modifier: {} },
    ] });
    expect(mixed.every(isOutsideDamagePath)).toBe(false);
  });

  it("counts an aura range lift as off the damage path, and offers an extra selection as a cap-raising lever", () => {
    const range = unsupported({ type: "ability-modifier", target: "this-unit", modifier: { ability: "some-aura", aspect: "range", operation: "add", value: 3 } });
    expect(range.length).toBeGreaterThan(0);
    expect(range.every(isOutsideDamagePath)).toBe(true);
    const selections = effectToBuffs({ type: "stance-selection-capacity", target: "this-unit", modifier: { ability_id: "some-menu", allocation: "choose-one-option", additional_selections: 1 } }, { kind: "ability", abilityId: "fixture", abilityKind: "unit" }, {});
    expect(selections.unsupported).toEqual([]);
    expect(selections.activatable.map((lever) => lever.capRaise)).toEqual([{ ability: "some-menu", by: 1, allocation: "choose-one-option" }]);
  });
});
