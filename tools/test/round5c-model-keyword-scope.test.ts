import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { groupMembership } from "../src/round5c/compile-model-level.js";

/**
 * Model-group wave: a model-level unit-filter whose models belong to a membership's unit, a weapon
 * scope printed before its filter, and an attack exclusion. Wording is fabricated; each leaf is
 * placed on its wording's first occurrence after the previous one, as the parser places them.
 */
type Item = [string, string, Record<string, unknown>];

function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return {
      role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version),
      start_byte: start, end_byte: from, fragment: "RAW_TEXT",
    };
  });
}

function resultOf(text: string, ...items: Item[]) {
  return compileLeaves(placed(text, ...items), text);
}

function mechanicsOf(text: string, ...items: Item[]): Record<string, any> {
  const result = resultOf(text, ...items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(text: string, ...items: Item[]): string[] {
  const result = resultOf(text, ...items);
  return result.ok ? [] : result.errors;
}

const FIGHT_WINDOW = { your_phases: [], opponent_phases: [], either_phases: ["fight"] };
const scope = (wording: string, weaponType: string): Item => [wording, "weapon-property-scope", { subject: "antecedent", weapon_type: weaponType }];
const setA = (wording: string, value: number): Item => [wording, "characteristic-set", { characteristic: "A", value }];
const TARGET = { count: "one", side: "your-army", selects: "unit", keywords: [], match: "all", excluded_keywords: [] };
const member = (wording: string, of: string, relation = "in"): Item => [wording, "membership", { relation, of }];

const SCOPE_ERROR = "An attack-property scope needs a following weapon property in its clause.";
const MEMBERSHIP_ONLY = "A selected model's membership is only being a model of its unit.";
const SEVERAL_TARGETS = "A Stratagem with several targets has no decided target for a selected model's membership yet.";
const SIDE_REQUIRED = "A unit-filter whose units receive an effect must say friendly or enemy.";
const NO_MOMENT = "points back to an earlier unit (antecedent), but no earlier leaf selects a unit, targets a Stratagem or names a unit's moment.";
const NEEDS_ATTACK = "An attack exclusion needs an attack frame right before it with no attacker of its own.";

describe("groupMembership: a membership becomes its model-level filter's member_of", () => {
  // Scope, filter, membership, stat: the scope is printed before the models it names.
  const MELEE_TEXT = "Melee weapons equipped by non-CHARACTER models in this unit have an Attacks characteristic of 3.";
  const melee = (): Item[] => [
    scope("Melee weapons equipped by", "melee"),
    ["non-CHARACTER models", "unit-filter", { side: "friendly", excluded_keywords: ["CHARACTER"], level: "model" }],
    member("in this unit", "this-unit"),
    setA("have an Attacks characteristic of 3", 3),
  ];

  it("folds an in-this-unit membership into the filter's units, with no count-scale refusal", () => {
    const mechanics = mechanicsOf(MELEE_TEXT, ...melee());
    const json = JSON.stringify(mechanics);
    expect(json).toContain('"member_of":"this-unit"');
    expect(json).toContain('"none_of":["CHARACTER"]');
    expect(json).toContain('"weapon_type":"melee"');
  });

  it("refuses a membership that is not a model of its unit, with the membership text", () => {
    expect(errorsOf("Your unit's ALPHA models in your army have [LETHAL HITS].",
      ["ALPHA models", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      member("in your army", "this-unit", "embarked-in"),
      ["[LETHAL HITS]", "weapon-ability-keyword", { keyword: "Lethal Hits" }])).toEqual([MEMBERSHIP_ONLY]);
  });

  it("refuses a membership whose filter's units receive an effect with no side", () => {
    expect(errorsOf(MELEE_TEXT, scope("Melee weapons equipped by", "melee"),
      ["non-CHARACTER models", "unit-filter", { side: "any", excluded_keywords: ["CHARACTER"], level: "model" }],
      member("in this unit", "this-unit"),
      setA("have an Attacks characteristic of 3", 3))).toEqual([SIDE_REQUIRED]);
  });

  it("refuses a Stratagem membership with several targets", () => {
    const text = "Fight phase. One friendly unit. One enemy unit. Weapons equipped by CRYPTEK models in your unit have [DEVASTATING WOUNDS].";
    expect(errorsOf(text,
      ["Fight phase", "use-window", FIGHT_WINDOW],
      ["One friendly unit", "stratagem-target", { count: "one" }],
      ["One enemy unit", "stratagem-target", { count: "one" }],
      scope("Weapons equipped by", "all"),
      ["CRYPTEK models", "unit-filter", { side: "friendly", keywords: ["CRYPTEK"], level: "model" }],
      member("in your unit", "stratagem-target"),
      ["[DEVASTATING WOUNDS]", "weapon-ability-keyword", { keyword: "Devastating Wounds" }])).toEqual([SEVERAL_TARGETS]);
  });

  it("refuses an antecedent membership with no earlier moment, and binds nothing to the filter's units", () => {
    const text = "CHARACTER models in that unit have melee attacks with [LETHAL HITS].";
    expect(errorsOf(text,
      ["CHARACTER models", "unit-filter", { side: "friendly", keywords: ["CHARACTER"], level: "model" }],
      member("in that unit", "antecedent"),
      ["have melee attacks with", "weapon-ability-grant", { subject: "antecedent", weapon_type: "melee" }],
      ["[LETHAL HITS]", "weapon-ability-keyword", { keyword: "Lethal Hits" }])[0]).toContain(NO_MOMENT);
  });

  it("is a no-op on a list with no membership", () => {
    const list = placed("Friendly ALPHA units have [LETHAL HITS].",
      ["Friendly ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }]);
    expect(groupMembership(list)).toEqual(list);
  });
});

describe("the moment's unit as a membership (\"that unit's Character models\")", () => {
  const TEXT = "When a friendly ALPHA unit is selected to fight, CHARACTER models in that unit have melee attacks with [LETHAL HITS].";
  const items = (): Item[] => [
    ["When a friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
    ["is selected to fight", "event", { kind: "selected-to-fight" }],
    ["CHARACTER models", "unit-filter", { side: "friendly", keywords: ["CHARACTER"], level: "model" }],
    member("in that unit", "antecedent"),
    ["have melee attacks with", "weapon-ability-grant", { subject: "antecedent", weapon_type: "melee" }],
    ["[LETHAL HITS]", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
  ];

  it("names the selected unit as the models' unit, not the filter's own units", () => {
    const json = JSON.stringify(mechanicsOf(TEXT, ...items()));
    expect(json).toContain('"member_of":"event-subject"');
    expect(json).toContain('"all_of":["CHARACTER"]');
  });
});

describe("a weapon scope printed before its recipient chain, and the stat-first run", () => {
  it("hoists the scope past an in-this-unit membership and lowers a stat with no keyword", () => {
    const mechanics = mechanicsOf("Melee weapons equipped by non-CHARACTER models in this unit have an Attacks characteristic of 3.",
      scope("Melee weapons equipped by", "melee"),
      ["non-CHARACTER models", "unit-filter", { side: "friendly", excluded_keywords: ["CHARACTER"], level: "model" }],
      member("in this unit", "this-unit"),
      setA("have an Attacks characteristic of 3", 3));
    expect(JSON.stringify(mechanics)).toContain('"member_of":"this-unit"');
  });

  it("hoists a stat that has a keyword after it, lowering both with the same recipient", () => {
    const text = "Melee weapons equipped by non-CHARACTER models in this unit have an Attacks characteristic of 4 and the [HAZARDOUS] ability.";
    const json = JSON.stringify(mechanicsOf(text,
      scope("Melee weapons equipped by", "melee"),
      ["non-CHARACTER models", "unit-filter", { side: "friendly", excluded_keywords: ["CHARACTER"], level: "model" }],
      member("in this unit", "this-unit"),
      setA("have an Attacks characteristic of 4", 4),
      ["[HAZARDOUS] ability", "weapon-ability-keyword", { keyword: "Hazardous" }]));
    expect(json).toContain('"member_of":"this-unit"');
    expect(json).toContain("Hazardous");
  });

  it("keeps a bare stat after a chain unhoisted: the chain still refuses", () => {
    const text = "Ranged weapons equipped by KAPPA models from your army add 1 to the Strength characteristic.";
    expect(errorsOf(text,
      scope("Ranged weapons equipped by", "ranged"),
      ["KAPPA models", "unit-filter", { side: "friendly", keywords: ["KAPPA"], level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["add 1 to the Strength characteristic", "characteristic-modifier", { characteristics: ["S"], operation: "add", value: 1 }])).toEqual([SCOPE_ERROR]);
  });

  it("does not hoist a model characteristic setter after a membership", () => {
    const text = "Melee weapons equipped by non-CHARACTER models in this unit have a Move characteristic of 6.";
    expect(errorsOf(text,
      scope("Melee weapons equipped by", "melee"),
      ["non-CHARACTER models", "unit-filter", { side: "friendly", excluded_keywords: ["CHARACTER"], level: "model" }],
      member("in this unit", "this-unit"),
      ["have a Move characteristic of 6", "characteristic-set", { characteristic: "M", value: 6 }])).toEqual([SCOPE_ERROR]);
  });
});

describe("an attack exclusion (excluded_from attacks)", () => {
  it("names the excluded models as the attack's attacker filter, with no target", () => {
    const text = "This unit's ranged attacks (excluding CHARACTER models) have [IGNORES COVER].";
    const json = JSON.stringify(mechanicsOf(text,
      ["This unit's ranged attacks", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged" }],
      ["excluding CHARACTER models", "unit-filter", { side: "friendly", excluded_keywords: ["CHARACTER"], level: "model", excluded_from: "attacks" }],
      ["have [IGNORES COVER]", "weapon-ability-keyword", { keyword: "Ignores Cover" }]));
    expect(json).toContain('"none_of":["CHARACTER"]');
    expect(json).toContain('"member_of":"this-unit"');
    expect(json).toContain('"weapon_type":"ranged"');
    expect(json).not.toContain("unit-filter-target");
  });

  it("refuses with no attack frame before it", () => {
    expect(errorsOf("Friendly models (excluding CHARACTER models) have +1 M.",
      ["Friendly models", "unit-filter", { side: "friendly", excluded_keywords: ["CHARACTER"], level: "model", excluded_from: "attacks" }],
      ["have +1 M", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: 1 }])).toEqual([NEEDS_ATTACK]);
  });
});

describe("a membership filter is not a selection, an aura or a target", () => {
  it("refuses a target with no side that a membership filter follows, rather than taking the filter as the target", () => {
    const text = "Fight phase. One friendly unit. Weapons equipped by CRYPTEK models in your unit have [DEVASTATING WOUNDS].";
    expect(errorsOf(text,
      ["Fight phase", "use-window", FIGHT_WINDOW],
      ["One friendly unit", "stratagem-target", { count: "one" }],
      scope("Weapons equipped by", "all"),
      ["CRYPTEK models", "unit-filter", { side: "friendly", keywords: ["CRYPTEK"], level: "model" }],
      member("in your unit", "stratagem-target"),
      ["[DEVASTATING WOUNDS]", "weapon-ability-keyword", { keyword: "Devastating Wounds" }])).toEqual([
      "A unit-filter whose models belong to a unit has no selection, aura or Stratagem target shape yet.",
    ]);
  });
});

describe("a Stratagem's membership with the scope printed first", () => {
  it("lowers a keyword grant whose recipients are the target's models", () => {
    const text = "Fight phase. One friendly unit. Weapons equipped by CRYPTEK or CANOPTEK models in your unit have [DEVASTATING WOUNDS].";
    const json = JSON.stringify(mechanicsOf(text,
      ["Fight phase", "use-window", FIGHT_WINDOW],
      ["One friendly unit", "stratagem-target", TARGET],
      scope("Weapons equipped by", "all"),
      ["CRYPTEK or CANOPTEK models", "unit-filter", { side: "friendly", any_keywords: ["CRYPTEK", "CANOPTEK"], level: "model" }],
      member("in your unit", "stratagem-target"),
      ["[DEVASTATING WOUNDS]", "weapon-ability-keyword", { keyword: "Devastating Wounds" }]));
    expect(json).toContain('"member_of":"stratagem-target"');
    expect(json).toContain("Devastating Wounds");
  });
});

describe("a destruction by a membership's models (8104 shape)", () => {
  it("folds the destroyer's membership and keeps the destroyed side's exclusion", () => {
    const text = "Each time a friendly POXWALKER model in this unit destroys an enemy model (excluding MONSTER and VEHICLE models), this unit gains +1 M.";
    const json = JSON.stringify(mechanicsOf(text,
      ["a friendly POXWALKER model", "unit-filter", { side: "friendly", keywords: ["POXWALKER"], level: "model" }],
      member("in this unit", "this-unit"),
      ["destroys", "event", { kind: "model-destroyed", by: "antecedent" }],
      ["an enemy model (excluding MONSTER and VEHICLE models)", "unit-filter", { side: "enemy", excluded_keywords: ["MONSTER", "VEHICLE"], level: "model" }],
      ["this unit gains +1 M", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: 1 }]));
    expect(json).toContain('"subject":{"owner":"friendly","all_of":["POXWALKER"],"level":"model","member_of":"this-unit"}');
    expect(json).toContain('"object":{"owner":"enemy","none_of":["MONSTER","VEHICLE"],"level":"model"}');
  });
});

describe("a weapon property scope naming no weapon keyword binds to a model-group filter", () => {
  it("compiles a stat with no subject after a filter, the 9212 shape", () => {
    const text = "Friendly Orks Psyker models' [Psychic] attacks have: +1 S.";
    const json = JSON.stringify(mechanicsOf(text,
      ["Friendly Orks Psyker models'", "unit-filter", { side: "friendly", keywords: ["ORKS", "PSYKER"], level: "model" }],
      ["[Psychic] attacks have", "weapon-property-scope", { subject: "antecedent", weapon_type: "all", weapon_keyword: "Psychic" }],
      ["+1 S", "characteristic-modifier", { characteristics: ["S"], operation: "add", value: 1 }]));
    expect(json).toContain('"all_of":["ORKS","PSYKER"]');
    expect(json).toContain('"weapon_keyword":"Psychic"');
  });
});

describe("a unit-filter after an attack without excluded_from is still the attack's target", () => {
  it("keeps the attack's own attacker and reads the keyword filter as the target", () => {
    const text = "This unit's ranged attacks that target an enemy VEHICLE unit have [IGNORES COVER].";
    const json = JSON.stringify(mechanicsOf(text,
      ["This unit's ranged attacks", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged" }],
      ["an enemy VEHICLE unit", "unit-filter", { side: "enemy", keywords: ["VEHICLE"] }],
      ["have [IGNORES COVER]", "weapon-ability-keyword", { keyword: "Ignores Cover" }]));
    expect(json).not.toContain('"member_of":"this-unit"');
    expect(json).toContain('"VEHICLE"');
  });
});

describe("refusals in the new family versions", () => {
  it("refuses a membership of the moment's unit that is not relation in", () => {
    expect(() => normalizeFingerprintParameters("membership", { relation: "embarked-in", of: "antecedent" }, currentFamilyVersion("membership")))
      .toThrow("membership of the moment's unit is only a model of that unit (relation in).");
  });

  it("refuses an attack exclusion that names more than excluded keywords", () => {
    const version = currentFamilyVersion("unit-filter");
    expect(() => normalizeFingerprintParameters("unit-filter",
      { side: "friendly", keywords: ["ALPHA"], excluded_keywords: ["CHARACTER"], level: "model", excluded_from: "attacks" }, version))
      .toThrow("unit-filter.excluded_from takes excluded_keywords alone; keywords is not allowed with it.");
  });

  it("refuses an attack exclusion on a unit-level filter", () => {
    const version = currentFamilyVersion("unit-filter");
    expect(() => normalizeFingerprintParameters("unit-filter",
      { side: "friendly", excluded_keywords: ["CHARACTER"], excluded_from: "attacks" }, version))
      .toThrow("unit-filter.excluded_from names models, so the filter must be level model.");
  });
});
