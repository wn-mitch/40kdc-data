import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { antecedentVersion } from "../src/round5c/antecedent-families.js";
import { describeCondition } from "../src/translate/condition.js";
import { describeEffect } from "../src/translate/effect.js";
import { familyExtension } from "../src/round5c/family-extensions.js";
import { FAMILY_EXTENSIONS_20_ANTECEDENT_SUBJECT_BINDING } from "../src/round5c/family-extensions-20-antecedent-subject-binding.js";

// Fabricated wording only. Each test names the defect it hunts; the compile tests fail on the tree before the change.

type Item = [string, string, Record<string, unknown>, string?];

/** Leaves placed by their wording in `text`, in order, normalized as the current family version reads them. */
function compileItems(text: string, items: Item[]) {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  const leaves: CompileLeaf[] = items.map(([wording, family, parameters, fragment]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: fragment ?? "RAW_TEXT" };
  });
  return compileLeaves(leaves, text);
}

function mechanicsOf(text: string, items: Item[]): Record<string, any> {
  const result = compileItems(text, items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(text: string, items: Item[]): string[] {
  const result = compileItems(text, items);
  return result.ok ? [] : result.errors;
}

/** The version just before this extension's version of `family`; later extensions may sit above it. */
const PREVIOUS = (family: string) => {
  for (let version = currentFamilyVersion(family); version > 1; version -= 1) {
    const extension = familyExtension(family, version);
    if (extension !== undefined && FAMILY_EXTENSIONS_20_ANTECEDENT_SUBJECT_BINDING.includes(extension)) return version - 1;
  }
  throw new Error(`The antecedent-subject-binding extensions do not extend ${family}.`);
};

const json = (value: unknown) => JSON.stringify(value);

describe("ability-modifier antecedent (SS-B)", () => {
  const text = "Friendly DEMO units. Add 3\" to that unit's Reach range, to a maximum of 12\".";
  const items = (subject: string): Item[] => [
    ["Friendly DEMO units", "unit-filter", { side: "friendly", keywords: ["DEMO"] }],
    ["Add 3\" to that unit's Reach range, to a maximum of 12\"", "ability-modifier", { subject, ability: "reach-demo", aspect: "range", operation: "add", value: 3, cap: 12 }],
  ];

  it("lowers the filtered units as the modifier's target, with its cap", () => {
    const mechanics = mechanicsOf(text, items("antecedent"));
    expect(json(mechanics)).toContain(json({ owner: "friendly", all_of: ["DEMO"] }));
    expect(json(mechanics)).toContain("\"cap\":12");
    expect(json(mechanics)).not.toContain("\"target\":\"this-unit\"");
  });

  it("accepts antecedent at the current version and not at the one before; this-unit still passes both", () => {
    const leaf = { subject: "antecedent", ability: "reach-demo", aspect: "range", operation: "add", value: 3 };
    const version = currentFamilyVersion("ability-modifier");
    const first = antecedentVersion("ability-modifier")!;
    expect(first).toBeDefined();
    for (const at of [first, version]) expect(normalizeFingerprintParameters("ability-modifier", leaf, at)).toEqual(leaf);
    expect(() => normalizeFingerprintParameters("ability-modifier", leaf, first - 1)).toThrow();
    for (const subject of ["this-unit", "this-model"]) {
      const old = { ...leaf, subject };
      for (const at of [first - 1, first, version]) expect(normalizeFingerprintParameters("ability-modifier", old, at)).toEqual(old);
    }
  });

  it("does not claim an unrelated later unit-filter as the postfix filter of a this-unit modifier", () => {
    const own = "Add 3\" to this unit's Reach range. Friendly DEMO units within 6\" of it.";
    const result = compileItems(own, [
      ["Add 3\" to this unit's Reach range", "ability-modifier", { subject: "this-unit", ability: "reach-demo", aspect: "range", operation: "add", value: 3 }],
      ["Friendly DEMO units", "unit-filter", { side: "friendly", keywords: ["DEMO"] }],
    ]);
    // The filter stays unclaimed: it is refused as a bare filter, never folded into the modifier's target.
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/unit-filter/u);
  });
});

describe("per-recipient condition is decided in its own sentence (SS-C)", () => {
  const text = "Friendly DEMO units' melee attacks have [HAZARDOUS]. Friendly SAMPLE units that charged this turn: their melee attacks have [PRECISION].";
  const second: Item[] = [
    ["Friendly SAMPLE units", "unit-filter", { side: "friendly", keywords: ["SAMPLE"] }],
    ["that charged this turn", "unit-activity", { activities: ["charged-this-turn"], subject: "antecedent", negated: false }],
    ["melee attacks have", "weapon-property-scope", { subject: "antecedent", weapon_type: "melee" }],
    ["PRECISION", "weapon-ability-keyword", { keyword: "Precision" }],
  ];
  const first: Item[] = [
    ["Friendly DEMO units'", "unit-filter", { side: "friendly", keywords: ["DEMO"] }],
    ["melee attacks have", "weapon-property-scope", { subject: "antecedent", weapon_type: "melee" }],
    ["HAZARDOUS", "weapon-ability-keyword", { keyword: "Hazardous" }],
  ];

  it("compiles both grants and gates only the second on the charge", () => {
    const steps = mechanicsOf(text, [...first, ...second]).effect.steps;
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ type: "weapon-ability-grant", target: { owner: "friendly", all_of: ["DEMO"] } });
    expect(steps[1]).toMatchObject({
      type: "conditional",
      condition: { type: "happened", parameters: { subject: "recipient", event: "move-ended", filter: { move_types: ["charge"] } } },
      effect: { type: "weapon-ability-grant", target: { owner: "friendly", all_of: ["SAMPLE"] } },
    });
  });

  it("keeps a condition per recipient when the antecedent that follows is in its own sentence", () => {
    const same = "Friendly SAMPLE units that charged this turn have their melee attacks gain [PRECISION].";
    const steps = mechanicsOf(same, [
      ["Friendly SAMPLE units", "unit-filter", { side: "friendly", keywords: ["SAMPLE"] }],
      ["that charged this turn", "unit-activity", { activities: ["charged-this-turn"], subject: "antecedent", negated: false }],
      ["melee attacks gain", "weapon-property-scope", { subject: "antecedent", weapon_type: "melee" }],
      ["PRECISION", "weapon-ability-keyword", { keyword: "Precision" }],
    ]);
    expect(json(steps)).toContain("\"subject\":\"recipient\"");
  });
});

describe("family versions (unit-filter, weapon-property-scope, battle-shock-state, unit-activity)", () => {
  it("unit-filter accepts attached_to this-unit on a friendly unit filter, and not at the version before", () => {
    const leaf = { side: "friendly", attached_to: "this-unit" };
    expect(normalizeFingerprintParameters("unit-filter", leaf, currentFamilyVersion("unit-filter"))).toEqual(leaf);
    expect(() => normalizeFingerprintParameters("unit-filter", leaf, PREVIOUS("unit-filter"))).toThrow();
    const keyed = { side: "friendly", keywords: ["INQUISITOR"], attached_to: "this-unit" };
    expect(normalizeFingerprintParameters("unit-filter", keyed, currentFamilyVersion("unit-filter"))).toEqual(keyed);
  });

  it("unit-filter refuses attached_to on a model level, an enemy side, among, a held state, other, and an unknown value", () => {
    const at = currentFamilyVersion("unit-filter");
    for (const bad of [
      { side: "friendly", level: "model", attached_to: "this-unit" },
      { side: "enemy", attached_to: "this-unit" },
      { side: "any", attached_to: "this-unit" },
      { side: "friendly", among: "stratagem-targets", targets: "one", attached_to: "this-unit" },
      { side: "friendly", held_in: "strategic-reserves", attached_to: "this-unit" },
      { side: "friendly", other: true, attached_to: "this-unit" },
      { side: "friendly", designated: "marked", designated_by: "this-unit", attached_to: "this-unit" },
      { side: "friendly", attached_to: "selected-unit" },
    ]) expect(() => normalizeFingerprintParameters("unit-filter", bad, at)).toThrow();
  });

  it("unit-filter still accepts what the version before accepted", () => {
    const at = currentFamilyVersion("unit-filter");
    for (const leaf of [{ side: "friendly" }, { side: "enemy", keywords: ["ALPHA"], states: ["engaged"] }, { side: "friendly", level: "model", keywords: ["ALPHA"] }, { side: "any", other: true }]) {
      expect(normalizeFingerprintParameters("unit-filter", leaf, at)).toEqual(leaf);
    }
  });

  it("weapon-property-scope accepts subject event-subject, and keeps every earlier subject", () => {
    const at = currentFamilyVersion("weapon-property-scope");
    const leaf = { subject: "event-subject", weapon_type: "all" };
    expect(normalizeFingerprintParameters("weapon-property-scope", leaf, at)).toEqual(leaf);
    expect(() => normalizeFingerprintParameters("weapon-property-scope", leaf, PREVIOUS("weapon-property-scope"))).toThrow();
    for (const subject of ["this-unit", "this-model", "selected-unit", "antecedent"]) {
      expect(normalizeFingerprintParameters("weapon-property-scope", { subject, weapon_type: "melee" }, at)).toEqual({ subject, weapon_type: "melee" });
    }
    expect(normalizeFingerprintParameters("weapon-property-scope", { subject: "event-subject", weapon_type: "ranged", weapon_keyword: "Psychic" }, at)).toMatchObject({ weapon_keyword: "Psychic" });
    expect(() => normalizeFingerprintParameters("weapon-property-scope", { subject: "bogus", weapon_type: "all" }, at)).toThrow();
  });

  it("battle-shock-state accepts recipient event-subject, and keeps every earlier recipient", () => {
    const at = currentFamilyVersion("battle-shock-state");
    const leaf = { recipient: "event-subject", set: true };
    expect(normalizeFingerprintParameters("battle-shock-state", leaf, at)).toEqual(leaf);
    expect(() => normalizeFingerprintParameters("battle-shock-state", leaf, PREVIOUS("battle-shock-state"))).toThrow();
    for (const recipient of ["this-unit", "defender", "selected-unit"]) {
      expect(normalizeFingerprintParameters("battle-shock-state", { recipient, set: false }, at)).toEqual({ recipient, set: false });
    }
    expect(() => normalizeFingerprintParameters("battle-shock-state", { recipient: "bogus", set: true }, at)).toThrow();
  });

  it("unit-activity accepts destroyed-stratagem-target, alone and beside an earlier activity, and keeps the earlier ones", () => {
    const at = currentFamilyVersion("unit-activity");
    const leaf = { activities: ["destroyed-stratagem-target"], subject: "target", negated: false };
    expect(normalizeFingerprintParameters("unit-activity", leaf, at)).toEqual(leaf);
    expect(() => normalizeFingerprintParameters("unit-activity", leaf, PREVIOUS("unit-activity"))).toThrow();
    const both = { activities: ["charged-this-turn", "destroyed-stratagem-target"], subject: "target", negated: false };
    expect(normalizeFingerprintParameters("unit-activity", both, at)).toMatchObject({ activities: ["charged-this-turn", "destroyed-stratagem-target"] });
    for (const activity of ["charged-this-turn", "destroyed-enemy-unit-this-phase", "lost-models-to-triggering-attacks"]) {
      expect(normalizeFingerprintParameters("unit-activity", { activities: [activity], subject: "this-unit", negated: false }, at)).toMatchObject({ activities: [activity] });
    }
    expect(() => normalizeFingerprintParameters("unit-activity", { activities: ["destroyed-stratagem-target", "destroyed-stratagem-target"], subject: "target", negated: false }, at)).toThrow();
  });
});

describe("attached Leader units (SS-A)", () => {
  const text = "During the Declare Battle Formations step, if this unit has a Leader unit attached to it, that Leader unit gains the Scouts 7\" ability.";
  const items = (filter: Record<string, unknown> = { side: "friendly", attached_to: "this-unit" }): Item[] => [
    ["During the Declare Battle Formations step", "event", { kind: "battle-formations-declared" }],
    ["this unit has a Leader unit attached to it", "leading-unit", { subject: "this-unit", attachment: "led" }],
    ["that Leader unit", "unit-filter", filter],
    ["gains the Scouts 7\" ability", "core-ability-grant", { subject: "antecedent", ability: "scouts", value: 7 }],
  ];

  it("grants the ability to the units attached to this unit as Leaders", () => {
    const mechanics = mechanicsOf(text, items());
    expect(json(mechanics.effect)).toContain(json({ owner: "friendly", member_of: "this-unit", has_ability: ["leader"] }));
    expect(json(mechanics.effect)).toContain("scouts");
    expect(json(mechanics)).toContain("battle-formations-declared");
    expect(json(mechanics)).toContain(json({ type: "attachment", parameters: { role: "led" } }));
  });

  it("carries a keyword on the same filter into the target", () => {
    const mechanics = mechanicsOf(text, items({ side: "friendly", keywords: ["INQUISITOR"], attached_to: "this-unit" }));
    expect(json(mechanics.effect)).toContain(json({ owner: "friendly", all_of: ["INQUISITOR"], member_of: "this-unit", has_ability: ["leader"] }));
  });

  it("merges a stacked keyword filter without dropping the attachment", () => {
    const mechanics = mechanicsOf(text.replace("that Leader unit", "that Leader unit (an INQUISITOR unit)"), [
      ...items().slice(0, 2),
      ["that Leader unit", "unit-filter", { side: "friendly", attached_to: "this-unit" }],
      ["an INQUISITOR unit", "unit-filter", { side: "friendly", keywords: ["INQUISITOR"] }],
      ["gains the Scouts 7\" ability", "core-ability-grant", { subject: "antecedent", ability: "scouts", value: 7 }],
    ]);
    expect(json(mechanics.effect)).toContain("\"has_ability\":[\"leader\"]");
    expect(json(mechanics.effect)).toContain("\"all_of\":[\"INQUISITOR\"]");
  });

  it("refuses the attached filter as a selection, an aura or a Stratagem target", () => {
    const selection = "Select one Leader unit attached to this unit. It gains the Scouts 7\" ability.";
    const errors = errorsOf(selection, [
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["Leader unit attached to this unit", "unit-filter", { side: "friendly", attached_to: "this-unit" }],
      ["It gains the Scouts 7\" ability", "core-ability-grant", { subject: "antecedent", ability: "scouts", value: 7 }],
    ]);
    expect(errors.join(" ")).toMatch(/attached Leaders has no selection, aura or Stratagem target shape/u);
  });
});

describe("the triggering unit named explicitly (SS-D)", () => {
  const WHEN: Item[] = [
    ["Opponent's Shooting phase", "use-window", { your_phases: [], opponent_phases: ["shooting"], either_phases: [] }, "WHEN"],
    ["just after an enemy unit has selected its targets", "event", { kind: "enemy-selected-targets" }, "WHEN"],
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
    ["from your army", "unit-owner", { owner: "friendly" }, "TARGET"],
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
  ];
  const head = "Opponent's Shooting phase, just after an enemy unit has selected its targets. One ALPHA unit from your army. Until the end of the phase, ";

  it("a weapon scope on the attacking unit's weapons grants to event-subject", () => {
    const mechanics = mechanicsOf(`${head}weapons equipped by models in the attacking unit have [HAZARDOUS].`, [
      ...WHEN,
      ["weapons equipped by models in the attacking unit have", "weapon-property-scope", { subject: "event-subject", weapon_type: "all" }, "EFFECT"],
      ["HAZARDOUS", "weapon-ability-keyword", { keyword: "Hazardous" }, "EFFECT"],
    ]);
    expect(json(mechanics.effect)).toContain("\"target\":\"event-subject\"");
    expect(json(mechanics.effect)).toContain("Hazardous");
    expect(json(mechanics.effect)).not.toContain("\"target\":\"this-unit\"");
  });

  it("carries a weapon keyword on the scope", () => {
    const mechanics = mechanicsOf(`${head}weapons equipped by models in the attacking unit have [HAZARDOUS].`, [
      ...WHEN,
      ["weapons equipped by models in the attacking unit have", "weapon-property-scope", { subject: "event-subject", weapon_type: "all", weapon_keyword: "Psychic" }, "EFFECT"],
      ["HAZARDOUS", "weapon-ability-keyword", { keyword: "Hazardous" }, "EFFECT"],
    ]);
    expect(json(mechanics.effect)).toContain("Psychic");
  });

  it("refuses event-subject when no moment in the record names a unit", () => {
    const text = "Until the end of the phase, weapons equipped by models in the attacking unit have [HAZARDOUS].";
    const errors = errorsOf(text, [
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["weapons equipped by models in the attacking unit have", "weapon-property-scope", { subject: "event-subject", weapon_type: "all" }],
      ["HAZARDOUS", "weapon-ability-keyword", { keyword: "Hazardous" }],
    ]);
    expect(errors.join(" ")).toMatch(/names the triggering unit, but no earlier leaf names a moment's unit/u);
  });

  it("still refuses an 'equipped by' scope with no named bearers when the subject is not event-subject", () => {
    const errors = errorsOf(`${head}weapons equipped by models in the attacking unit have [HAZARDOUS].`, [
      ...WHEN,
      ["weapons equipped by models in the attacking unit have", "weapon-property-scope", { subject: "antecedent", weapon_type: "all" }, "EFFECT"],
      ["HAZARDOUS", "weapon-ability-keyword", { keyword: "Hazardous" }, "EFFECT"],
    ]);
    expect(errors.join(" ")).toMatch(/names its bearers/u);
  });

  it("a Battle-shock state on the triggering unit lowers to event-subject", () => {
    const text = "Opponent's Shooting phase, just after an enemy unit has selected its targets. One ALPHA unit from your army. The attacking unit is Battle-shocked.";
    const mechanics = mechanicsOf(text, [
      ...WHEN.slice(0, 5),
      ["The attacking unit is Battle-shocked", "battle-shock-state", { recipient: "event-subject", set: true }, "EFFECT"],
    ]);
    expect(json(mechanics.effect)).toContain("\"target\":\"event-subject\"");
    expect(json(mechanics.effect)).toContain("battle-shocked");
  });
});

describe("the unit that just destroyed the Stratagem's target (SS-E)", () => {
  const text = "Fight phase, just after your unit is destroyed. One ALPHA unit from your army that was just destroyed. Until the end of the phase, each time a friendly BETA model makes an attack that targets the enemy unit that just destroyed your unit, add 1 to the Wound roll.";
  const items = (activity: Record<string, unknown> = { activities: ["destroyed-stratagem-target"], subject: "target", negated: false }, targetFragment = "TARGET"): Item[] => [
    ["Fight phase", "use-window", { your_phases: [], opponent_phases: [], either_phases: ["fight"] }, "WHEN"],
    ["just after your unit is destroyed", "event", { kind: "unit-destroyed" }, "WHEN"],
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
    ["from your army", "unit-owner", { owner: "friendly" }, "TARGET"],
    ["that was just destroyed", "event", { kind: "unit-destroyed" }, targetFragment],
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
    ["friendly BETA model", "unit-filter", { side: "friendly", keywords: ["BETA"], level: "model" }, "EFFECT"],
    ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }, "EFFECT"],
    ["that targets the enemy unit that just destroyed your unit", "unit-activity", activity, "EFFECT"],
    ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }, "EFFECT"],
  ];

  it("gates the modifier on the defender having destroyed the Stratagem's target", () => {
    const mechanics = mechanicsOf(text, items());
    expect(json(mechanics.effect)).toContain(json({ type: "happened", parameters: { event: "destroyed", object: "stratagem-target", filter: { by: "defender" }, window: "battle" } }));
  });

  it("refuses the activity outside a Stratagem", () => {
    const plain = items().filter((item) => !["WHEN", "TARGET"].includes(item[3]!));
    const errors = errorsOf(text, plain);
    expect(errors.join(" ")).toMatch(/destroyed-stratagem-target.*needs a Stratagem whose target was just destroyed/u);
  });

  it("refuses the activity in a Stratagem whose target is not a destroyed unit", () => {
    const errors = errorsOf(text, items().filter((item) => item[3] !== "TARGET" || item[1] !== "event"));
    expect(errors.join(" ")).toMatch(/needs a Stratagem whose target was just destroyed/u);
  });
});

describe("'That K unit' naming the friendly unit of the WHEN's distance clause (SS-F)", () => {
  const text = "Opponent's Movement phase, just after an enemy unit ends a move within 8\" of a friendly unengaged PIONEERS unit. That PIONEERS unit. Until the end of the phase, your unit's ranged attacks have [PRECISION].";
  const items = (keywords: string[] = ["PIONEERS"], position: Record<string, unknown> | null = { kind: "within", inches: 8, of: "following-filter", subject: "event-subject", negated: false }): Item[] => [
    ["Opponent's Movement phase", "use-window", { your_phases: [], opponent_phases: ["movement"], either_phases: [] }, "WHEN"],
    ["enemy unit", "unit-filter", { side: "enemy" }, "WHEN"],
    ["ends a move", "event", { kind: "move-ended", owner: "enemy" }, "WHEN"],
    ...(position === null ? [] : [
      ["within 8\" of a", "unit-position", position, "WHEN"] as Item,
      ["friendly unengaged PIONEERS unit", "unit-filter", { side: "friendly", keywords: ["PIONEERS"], states: ["unengaged"] }, "WHEN"] as Item,
    ]),
    ["That PIONEERS unit", "triggering-target", { selects: "unit", keywords, match: "all" }, "TARGET"],
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
    ["your unit's ranged attacks have", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged" }, "EFFECT"],
    ["PRECISION", "weapon-ability-keyword", { keyword: "Precision" }, "EFFECT"],
  ];
  const coreOf = (result: ReturnType<typeof compileItems>) => {
    if (!result.ok) throw new Error(result.errors.join("; "));
    return (result as any).core.target_restrictions as Record<string, any>;
  };

  it("targets the friendly unit within the distance of the mover, with no binding to the mover", () => {
    const restrictions = coreOf(compileItems(text, items()));
    expect(restrictions).toEqual({
      count: "one", side: "your-army", selects: "unit", required_keywords: ["PIONEERS"],
      eligibility: { operator: "and", operands: [
        { operator: "not", operands: [{ type: "unit-state", parameters: { state: "engaged" } }] },
        { type: "within", parameters: { of: "event-subject", range: { inches: 8 } } },
      ] },
    });
    expect(restrictions.bound_to).toBeUndefined();
  });

  it("drops the keyword gate that tested a unit the Stratagem does not have", () => {
    const result = compileItems(text, items());
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect((result.mechanics as any).trigger.condition).toBeUndefined();
  });

  it("refuses when the target's keywords differ from the distance clause's", () => {
    const errors = errorsOf(text, items(["OTHER"]));
    expect(errors.join(" ")).toMatch(/names no friendly K unit in the moment/u);
  });

  it("refuses an enemy mover's 'That K unit' with no distance clause naming a friendly unit", () => {
    const errors = errorsOf(text, items(["PIONEERS"], null));
    expect(errors.join(" ")).toMatch(/names no friendly K unit in the moment/u);
  });

  it("keeps the triggering-unit binding when a friendly unit acts", () => {
    const own = "Your Shooting phase, when a friendly PIONEERS unit is selected to shoot. That PIONEERS unit. Until the end of the phase, your unit's ranged attacks have [PRECISION].";
    const result = compileItems(own, [
      ["Your Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"],
      ["friendly PIONEERS unit", "unit-filter", { side: "friendly", keywords: ["PIONEERS"] }, "WHEN"],
      ["selected to shoot", "event", { kind: "selected", to: "shoot" }, "WHEN"],
      ["That PIONEERS unit", "triggering-target", { selects: "unit", keywords: ["PIONEERS"], match: "all" }, "TARGET"],
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
      ["your unit's ranged attacks have", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged" }, "EFFECT"],
      ["PRECISION", "weapon-ability-keyword", { keyword: "Precision" }, "EFFECT"],
    ]);
    expect(coreOf(result).bound_to).toBe("triggering-unit");
  });
});

describe("describers read the lowered shapes without raw ids", () => {
  it("a destruction of the Stratagem's target by the defender", () => {
    const text = describeCondition({ type: "happened", parameters: { event: "destroyed", object: "stratagem-target", filter: { by: "defender" }, window: "battle" } } as never);
    expect(text).toMatch(/destroyed/u);
    expect(text).toMatch(/this battle/u);
    expect(text).not.toMatch(/stratagem-target|defender/u);
  });

  it("a grant to the Leader units attached to this unit", () => {
    const text = describeEffect({ type: "ability-grant", target: { owner: "friendly", all_of: ["INQUISITOR"], member_of: "this-unit", has_ability: ["leader"] }, modifier: { ability: "deep-strike" } } as never);
    expect(text).toMatch(/INQUISITOR/u);
    expect(text).toMatch(/Leader/u);
    expect(text).not.toMatch(/has_ability|member_of/u);
  });

  it("an ability modifier on a filtered target", () => {
    const text = describeEffect({ type: "ability-modifier", target: { owner: "friendly", all_of: ["DEMO"] }, modifier: { ability: "reach-demo", aspect: "range", operation: "add", value: 3, cap: 12 } } as never);
    expect(text).toMatch(/friendly DEMO units/u);
    expect(text).toMatch(/3"/u);
    expect(text).toMatch(/maximum of 12/u);
  });
});

describe("attached Leaders have no target or aura shape (SS-A refusals)", () => {
  it("refuses the filter as a Stratagem target", () => {
    const errors = errorsOf("Opponent's Shooting phase, when an enemy unit is selected to shoot. One Leader unit attached to this unit.", [
      ["Opponent's Shooting phase", "use-window", { your_phases: [], opponent_phases: ["shooting"], either_phases: [] }, "WHEN"],
      ["when an enemy unit is selected to shoot", "event", { kind: "selected", to: "shoot", owner: "enemy" }, "WHEN"],
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["Leader unit attached to this unit", "unit-filter", { side: "friendly", attached_to: "this-unit" }, "TARGET"],
    ]);
    expect(errors.join(" ")).toMatch(/attached Leaders has no selection, aura or Stratagem target shape/u);
  });

  it("refuses the filter as an aura's units", () => {
    const errors = errorsOf("While a Leader unit attached to this unit is within 6\" of this model, that unit gains the Stealth ability.", [
      ["Leader unit attached to this unit", "unit-filter", { side: "friendly", attached_to: "this-unit" }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["that unit gains the Stealth ability", "core-ability-grant", { subject: "antecedent", ability: "stealth" }],
    ]);
    expect(errors.join(" ")).toMatch(/attached Leaders/u);
  });
});
