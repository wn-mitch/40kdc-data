import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { groupMembership } from "../src/semantic-authoring/compile-model-level.js";
import { sentenceSegments } from "../src/semantic-authoring/compile-segments.js";
import { dslUnitFilter } from "../src/semantic-authoring/compile-unit-filter-dsl.js";
import { resolveNames, type WeaponNameContext } from "../src/semantic-authoring/compile-weapon-names.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

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

/** The byte span of `wording`'s first occurrence in `text`. */
function spanOf(text: string, wording: string): [number, number] {
  const start = Buffer.byteLength(text.slice(0, text.indexOf(wording)), "utf8");
  return [start, start + Buffer.byteLength(wording, "utf8")];
}

/** One leaf of a family at its current version, on its wording. */
function leaf(family: string, parameters: Record<string, unknown>, start: number, end: number, fragment = "RAW_TEXT", role?: CompileLeaf["role"]): CompileLeaf {
  const version = currentFamilyVersion(family);
  return { role: role ?? familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: end, fragment };
}

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

const ROLL_ADD_HIT: [string, string, Record<string, unknown>] = ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }];
const ROLL_ADD_WOUND: [string, string, Record<string, unknown>] = ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }];

describe("T7 colon lists end at a new moment or a labelled line (SS-E)", () => {
  it("a colon list ends at a moment that opens a new part, which the attack frame does not gate", () => {
    // Fabricated shape of a melee-attack list whose last item is a destruction moment with a unit-filter.
    const text = "These attacks can: Re-roll hit rolls. When this unit destroys a Character model, you gain 1CP.";
    const list = placed(text,
      ["These attacks", "attack", { direction: "makes", unit: "this-model", attack_type: "melee" }],
      ["Re-roll hit rolls", "reroll", { roll: "hit", subset: "all", weapon_type: "melee" }],
      ["When this unit destroys a", "event", { kind: "model-destroyed", by: "this-unit" }],
      ["Character model", "unit-filter", { side: "enemy", keywords: ["CHARACTER"], level: "model" }],
      ["you gain 1CP", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }]);
    expect(sentenceSegments(list, text)?.length).toBe(2);
    const mechanics = mechanicsOf(list, text);
    const steps = mechanics.effect.steps as Array<Record<string, any>>;
    // The destruction part is its own ability-part: its trigger names the destroyed model, and its gain
    // is not gated by the melee attack frame the list's re-roll is.
    const destruction = steps.find((step) => step.type === "ability-part" && step.trigger?.event === "model-destroyed");
    expect(destruction?.trigger.object).toEqual({ owner: "enemy", level: "model", all_of: ["CHARACTER"] });
    expect(destruction?.effect.type).toBe("cp-gain");
  });

  it("a bullet-marked moment stays in the colon list (bullet guard)", () => {
    const text = "While this unit is near a beacon:\n■ Its models add 1 to the Hit roll.\n■ When this unit fights, add 1 to the Wound roll.";
    const list = placed(text, ROLL_ADD_HIT, ROLL_ADD_WOUND);
    expect(sentenceSegments(list, text)).toBeNull();
  });

  it("a label that opens its own line ends the list and starts a part", () => {
    const text = "While this unit is near a beacon:\n- Its models add 1 to the Hit roll.\nBestial Forms: add 1 to the Wound roll.";
    const list = placed(text, ROLL_ADD_HIT, ROLL_ADD_WOUND);
    const parts = sentenceSegments(list, text);
    expect(parts?.length).toBe(2);
    expect(parts?.[1]?.[0]?.parameters).toEqual(ROLL_ADD_WOUND[2]);
  });

  it("a labelled part is not gated by the list's header (the header gates the list only)", () => {
    const text = "While this unit is near a beacon:\nIts models add 1 to the Hit roll.\nBestial Forms: add 1 to the Wound roll.";
    const list = placed(text,
      ["near a beacon", "unit-keyword", { keywords: ["INFANTRY"], subject: "this-unit", negated: false }],
      ROLL_ADD_HIT,
      ROLL_ADD_WOUND);
    const parts = sentenceSegments(list, text);
    expect(parts?.length).toBe(2);
    expect(parts?.[0]?.some((item) => item.family_id === "unit-keyword")).toBe(true);
    expect(parts?.[1]?.some((item) => item.family_id === "unit-keyword")).toBe(false);
  });

  it("a label in the middle of a line does not end the list (regression pin)", () => {
    const text = "While this unit is near a beacon: add 1 to the Hit roll. Bestial Forms: add 1 to the Wound roll.";
    const list = placed(text, ROLL_ADD_HIT, ROLL_ADD_WOUND);
    expect(sentenceSegments(list, text)).toBeNull();
  });
});

describe("T7 destroyed model's unit keywords (SS-D)", () => {
  it("a model-level unit-filter after a model-destroyed event folds into the event's object", () => {
    // Covered by the trigger test above; this pins the object's owner and keywords on their own.
    const text = "When this unit destroys a Character model, you gain 1CP.";
    const list = placed(text,
      ["When this unit destroys a", "event", { kind: "model-destroyed", by: "this-unit" }],
      ["Character model", "unit-filter", { side: "enemy", keywords: ["CHARACTER"], level: "model" }],
      ["you gain 1CP", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }]);
    const mechanics = mechanicsOf(list, text);
    expect(mechanics.trigger).toMatchObject({ event: "model-destroyed", object: { owner: "enemy", level: "model", all_of: ["CHARACTER"] } });
  });

  it("refuses a destroyed model's filter when the event already names an object", () => {
    const text = "When this unit destroys a Character model, you gain 1CP.";
    const list = placed(text,
      ["When this unit destroys a", "event", { kind: "model-destroyed", by: "this-unit", object_owner: "enemy" }],
      ["Character model", "unit-filter", { side: "enemy", keywords: ["CHARACTER"], level: "model" }],
      ["you gain 1CP", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }]);
    expect(compileLeaves(list, text).ok).toBe(false);
  });

  it("event object_keywords: accepted on model-destroyed with an owner, and refused elsewhere (family)", () => {
    const version = currentFamilyVersion("event");
    const base = { kind: "model-destroyed", object_owner: "enemy" };
    expect(normalizeFingerprintParameters("event", { ...base, object_keywords: ["CHARACTER"] }, version)).toMatchObject({ object_keywords: ["CHARACTER"] });
    // A value the previous version accepted keeps its meaning.
    expect(normalizeFingerprintParameters("event", base, version)).toMatchObject({ kind: "model-destroyed", object_owner: "enemy" });
    expect(() => normalizeFingerprintParameters("event", { kind: "model-destroyed", object_keywords: ["CHARACTER"] }, version)).toThrow(/object_owner/);
    expect(() => normalizeFingerprintParameters("event", { kind: "unit-destroyed", object_owner: "enemy", object_keywords: ["CHARACTER"] }, version)).toThrow(/model-destroyed/);
  });

  it("unit-activity keywords: on the destroyed models only, and one leaf may name both destruction activities (family)", () => {
    const version = currentFamilyVersion("unit-activity");
    const shared = { named: "after", container: "none", destroyer: "this-unit", negated: false };
    const models = normalizeFingerprintParameters("unit-activity", { ...shared, activities: ["destroyed-models-by-triggering-attacks"], keywords: ["CHARACTER"] }, version);
    expect(models).toMatchObject({ keywords: ["CHARACTER"], activities: ["destroyed-models-by-triggering-attacks"] });
    // A value the previous version accepted keeps its meaning.
    expect(normalizeFingerprintParameters("unit-activity", { ...shared, activities: ["destroyed-units-by-triggering-attacks"] }, version))
      .toMatchObject({ activities: ["destroyed-units-by-triggering-attacks"] });
    const pair = normalizeFingerprintParameters("unit-activity", { ...shared, activities: ["destroyed-models-by-triggering-attacks", "destroyed-units-by-triggering-attacks"], keywords: ["CHARACTER"] }, version);
    expect(pair.activities).toEqual(["destroyed-units-by-triggering-attacks", "destroyed-models-by-triggering-attacks"]);
    expect(pair.keywords).toEqual(["CHARACTER"]);
    expect(() => normalizeFingerprintParameters("unit-activity", { ...shared, activities: ["destroyed-units-by-triggering-attacks"], keywords: ["CHARACTER"] }, version)).toThrow(/keywords/);
  });

  it("one destruction leaf naming a destroyed unit or a destroyed model is an either-of two happened conditions", () => {
    // Fabricated shape of "if those attacks destroyed an enemy unit or an enemy Character model, …".
    const text = "If those attacks destroyed an enemy unit or an enemy Character model, you gain 1CP.";
    const at = (wording: string) => spanOf(text, wording);
    const list = [
      leaf("event", { kind: "attacks-resolved", action_kind: "attack" }, ...at("If those attacks")),
      leaf("unit-activity", { activities: ["destroyed-units-by-triggering-attacks", "destroyed-models-by-triggering-attacks"], named: "after", container: "none", destroyer: "this-unit", keywords: ["CHARACTER"] }, ...at("destroyed an enemy unit or an enemy Character model")),
      leaf("unit-filter", { side: "enemy" }, ...at("an enemy unit"), "RAW_TEXT", "CONDITION"),
      leaf("resource-action", { resource: "command-point", operation: "gain", amount: 1 }, ...at("you gain 1CP")),
    ];
    const mechanics = mechanicsOf(list, text);
    const condition = mechanics.effect.condition as { operator: string; operands: Array<{ type: string; parameters: Record<string, any> }> };
    expect(condition.operator).toBe("or");
    expect(condition.operands.map((operand) => operand.parameters.event)).toEqual(["destroyed", "model-destroyed"]);
    expect(condition.operands[1]!.parameters.object).toEqual({ owner: "enemy", level: "model", all_of: ["CHARACTER"] });
  });
});

describe("T7 stat phrase before named weapons (SS-K)", () => {
  const catalog = { faction: [{ name: "Fidelis", type: "ranged" }, { name: "Lance of Illumination", type: "melee" }] };
  const ctx: WeaponNameContext = { faction_id: "fabricated", source_type: "", catalog };
  const span = "add 3 to the Attacks characteristic of Fidelis and the Lance of Illumination";

  it("names the weapons after a stat phrase, whose words are not weapon words", () => {
    expect(resolveNames(["Fidelis", "Lance of Illumination"], { weapon_type: "all", subject: "this-model", span, authored: true, statPrefix: true }, ctx, undefined))
      .toEqual(["Fidelis", "Lance of Illumination"]);
  });

  it("still refuses the same wording without the stat phrase flag (regression pin)", () => {
    expect(() => resolveNames(["Fidelis", "Lance of Illumination"], { weapon_type: "all", subject: "this-model", span, authored: true }, ctx, undefined))
      .toThrow(/not weapons/);
  });

  it("refuses a non-weapon word between the names even after the stat phrase", () => {
    const stray = "add 3 to the Attacks characteristic of Fidelis and quickly the Lance of Illumination";
    expect(() => resolveNames(["Fidelis", "Lance of Illumination"], { weapon_type: "all", subject: "this-model", span: stray, authored: true, statPrefix: true }, ctx, undefined))
      .toThrow(/quickly/);
  });
});

describe("T7 Warlord designation on an attack's target (SS-L)", () => {
  it("compiles a Warlord target of an attack as the defender's designation", () => {
    const text = "Each time this unit makes an attack that targets the enemy WARLORD, you gain 1CP.";
    const list = placed(text,
      ["this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["the enemy WARLORD", "unit-filter", { side: "enemy", subject: "target", designated: "warlord" }],
      ["you gain 1CP", "resource-action", { resource: "command-point", operation: "gain", amount: 1 }]);
    const mechanics = mechanicsOf(list, text);
    expect(mechanics.effect.condition).toEqual({ type: "matches", parameters: { subject: "defender", filter: { owner: "enemy", designated: "warlord" } } });
  });

  it("refuses a Warlord designation outside a Warlord test and an attack's target (regression pin)", () => {
    const filter = leaf("unit-filter", { side: "enemy", designated: "warlord" }, 0, 10, "RAW_TEXT", "CONDITION");
    expect(() => dslUnitFilter(filter)).toThrow(/Warlord/);
    expect(dslUnitFilter(filter, { warlordTarget: true })).toMatchObject({ owner: "enemy", designated: "warlord" });
  });
});

describe("T7 membership in a reference's model (SS-M)", () => {
  const text = "within 12\" of a CRYPTEK model in your unit";

  function referenceFor(subject: string): CompileLeaf[] {
    return placed(text,
      ["within 12\" of", "unit-position", { kind: "within", inches: 12, of: "following-filter", subject, negated: false }],
      ["a CRYPTEK model", "unit-filter", { side: "friendly", keywords: ["CRYPTEK"], level: "model" }],
      ["in your unit", "membership", { relation: "in", of: "this-unit" }]);
  }

  it("names the selected unit when the reference measures from the selected unit", () => {
    const folded = groupMembership(referenceFor("selected-unit"));
    const filter = folded.find((item) => item.family_id === "unit-filter")!;
    expect(filter.parameters.member_of).toBe("selected-unit");
    expect(folded.some((item) => item.family_id === "membership")).toBe(false);
  });

  it("names this unit when the reference measures from this unit", () => {
    const folded = groupMembership(referenceFor("this-unit"));
    expect(folded.find((item) => item.family_id === "unit-filter")!.parameters.member_of).toBe("this-unit");
  });

  it("keeps refusing a membership that is not being a model of its unit (regression pin)", () => {
    const list = placed(text,
      ["within 12\" of", "unit-position", { kind: "within", inches: 12, of: "following-filter", subject: "selected-unit", negated: false }],
      ["a CRYPTEK model", "unit-filter", { side: "friendly", keywords: ["CRYPTEK"], level: "model" }],
      ["in your unit", "membership", { relation: "within", of: "this-unit" }]);
    expect(() => groupMembership(list)).toThrow(/membership/);
  });
});

describe("T7 comma-listed menus and bearer-filtered grants (SS-J)", () => {
  it("a colon-introduced comma list is one option per item", () => {
    const text = "Select one of the following: +1 to hit rolls, -1 to wound rolls, or +1 to save rolls.";
    const list = placed(text,
      ["Select one of the following", "choice-open", { min_choices: 1, max_choices: 1 }],
      ["+1 to hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1, subject: "this-unit" }],
      ["-1 to wound rolls", "roll-modifier", { roll: "wound", operation: "subtract", value: 1, subject: "this-unit" }],
      ["+1 to save rolls", "roll-modifier", { roll: "save", operation: "add", value: 1, subject: "this-unit" }]);
    const mechanics = mechanicsOf(list, text);
    expect(mechanics.effect.type).toBe("choice");
    expect(mechanics.effect.options).toHaveLength(3);
  });

  it("refuses a colon-introduced list with one item (regression pin)", () => {
    const text = "Select one of the following: +1 to hit rolls.";
    const list = placed(text,
      ["Select one of the following", "choice-open", { min_choices: 1, max_choices: 1 }],
      ["+1 to hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1, subject: "this-unit" }]);
    const result = compileLeaves(list, text);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/at least two options/);
  });

  it("a model-level unit-filter after an equipped-weapon scope names the grant's bearers (regression pin)", () => {
    const text = "Ranged weapons equipped by CRYPTEK models from your army have the ASSAULT ability.";
    const list = placed(text,
      ["Ranged weapons equipped by", "weapon-property-scope", { subject: "antecedent", weapon_type: "ranged" }],
      ["CRYPTEK models from your army", "unit-filter", { side: "friendly", keywords: ["CRYPTEK"], level: "model" }],
      ["ASSAULT", "weapon-ability-keyword", { keyword: "ASSAULT" }]);
    const mechanics = mechanicsOf(list, text);
    expect(mechanics.effect.type).toBe("weapon-ability-grant");
    expect(mechanics.effect.target).toEqual({ owner: "friendly", all_of: ["CRYPTEK"], level: "model" });
  });
});

describe("T7 bearer-named grants with no bearer filter (SS-J)", () => {
  it("refuses an equipped-by scope with no bearer filter, not the scope's own unit (fails before)", () => {
    // Fabricated wording: the drafter gave the scope this unit, but the text names CRYPTEK models.
    const text = "Ranged weapons equipped by CRYPTEK models from your army have the ASSAULT ability.";
    const result = compileLeaves(placed(text,
      ["Ranged weapons equipped by", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged" }],
      ["ASSAULT", "weapon-ability-keyword", { keyword: "ASSAULT" }]), text);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/names its bearers/);
  });

  it("keeps an equipped-by scope naming this unit's own models without a filter (regression pin)", () => {
    const text = "Until the end of the phase, ranged weapons equipped by your models have the ASSAULT ability.";
    const mechanics = mechanicsOf(placed(text,
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["ranged weapons equipped by your models", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged" }],
      ["ASSAULT", "weapon-ability-keyword", { keyword: "ASSAULT" }]), text);
    expect(mechanics.effect.target).toBe("this-unit");
  });

  it("refuses a grant with no subject and no filter (regression pin)", () => {
    const text = "Ranged weapons equipped by models in this unit have the ASSAULT ability.";
    const result = compileLeaves(placed(text,
      ["Ranged weapons", "weapon-ability-grant", { weapon_type: "ranged" }],
      ["ASSAULT", "weapon-ability-keyword", { keyword: "ASSAULT" }]), text);
    expect(result.ok).toBe(false);
  });

  it("a comma menu of five keywords under a keyword-less frame is one option per keyword (regression pin)", () => {
    const text = "■ In your Shooting phase, each time a CRYPTEK unit from your army is selected to shoot, select one of the following abilities: ANTI-INFANTRY 3+, ANTI-MOUNTED 4+, ASSAULT, HEAVY, IGNORES COVER. Until the end of the phase, ranged weapons equipped by models in that unit have that ability.";
    const list = placed(text,
      ["In your Shooting phase, each time a CRYPTEK unit from your army is selected to shoot", "event", { kind: "selected", to: "shoot" }],
      ["select one of the following abilities", "choice-open", { min_choices: 1, max_choices: 1 }],
      ["ANTI-INFANTRY 3+", "weapon-ability-keyword", { keyword: "ANTI-INFANTRY 3+" }],
      ["ANTI-MOUNTED 4+", "weapon-ability-keyword", { keyword: "ANTI-MOUNTED 4+" }],
      ["ASSAULT", "weapon-ability-keyword", { keyword: "ASSAULT" }],
      ["HEAVY", "weapon-ability-keyword", { keyword: "HEAVY" }],
      ["IGNORES COVER", "weapon-ability-keyword", { keyword: "IGNORES COVER" }],
      ["ranged weapons equipped by models in that unit have that ability", "weapon-ability-grant", { subject: "this-unit", weapon_type: "ranged" }]);
    const mechanics = mechanicsOf(list, text);
    expect(mechanics.effect.type).toBe("choice");
    expect(mechanics.effect.options).toHaveLength(5);
  });
});

describe("T7 option boundaries in a weapon scope (SS-G)", () => {
  it("an option's attack frame and incoming roll compile as the second option (regression pin)", () => {
    const text = "Select one of the following: ■ This unit's melee attacks have +1 to hit rolls. ■ Or: Attacks that target this unit have -1 to hit rolls.";
    const list = placed(text,
      ["Select one of the following", "choice-open", { min_choices: 1, max_choices: 1 }],
      ["This unit's melee attacks", "weapon-property-scope", { subject: "this-unit", weapon_type: "melee" }],
      ["+1 to hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
      ["Attacks that target this unit", "attack", { direction: "targeted", unit: "this-unit" }],
      ["-1 to hit rolls", "roll-modifier", { roll: "hit", operation: "subtract", value: 1, incoming: true }]);
    const mechanics = mechanicsOf(list, text);
    expect(mechanics.effect.options[0].modifier).toMatchObject({ roll: "hit", weapons: { type: "melee" } });
    expect(mechanics.effect.options[1].target).toBe("attacker");
    expect(mechanics.effect.options[1].modifier.weapons).toBeUndefined();
  });

  it("refuses a bound run followed by an option after an Or: (regression pin)", () => {
    // Without the boundary stop the second option's roll is kept by the scope; the second option's own
    // recipient is not a reason to compile it as a second effect beside the first.
    const text = "Your unit's melee weapons: Have +1 to hit rolls ■ Or: This unit has -1 to hit rolls.";
    const result = compileLeaves(placed(text,
      ["Your unit's melee weapons:", "weapon-property-scope", { subject: "this-unit", weapon_type: "melee" }],
      ["Have +1 to hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
      ["This unit has -1 to hit rolls.", "roll-modifier", { roll: "hit", operation: "subtract", value: 1, subject: "this-unit" }]), text);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("explicit composition relation");
  });

  it("refuses a weapon scope whose own option is empty, an Or: straight after it (fails before)", () => {
    // Before the fix the first property folded across "Or:" and the choice was silently dropped.
    const text = "Your unit's melee weapons: Or: Have +1 to hit rolls.";
    const result = compileLeaves(placed(text,
      ["Your unit's melee weapons:", "weapon-property-scope", { subject: "this-unit", weapon_type: "melee" }],
      ["Have +1 to hit rolls.", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), text);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/needs a following weapon property/);
  });

  it("an option's own subject roll does not take the earlier option's weapon type (regression pin)", () => {
    const text = "Select one of the following: ■ This unit's melee attacks have +1 to hit rolls. ■ Or: This unit has -1 to hit rolls.";
    const list = [
      ...placed(text,
        ["Select one of the following", "choice-open", { min_choices: 1, max_choices: 1 }],
        ["This unit's melee attacks", "weapon-property-scope", { subject: "this-unit", weapon_type: "melee" }],
        ["+1 to hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]),
      leaf("roll-modifier", { roll: "hit", operation: "subtract", value: 1, subject: "this-unit" }, text.indexOf("-1 to hit"), text.indexOf("-1 to hit") + 9),
    ];
    const mechanics = mechanicsOf(list, text);
    expect(mechanics.effect.options[1].modifier.weapons).toBeUndefined();
  });
});
