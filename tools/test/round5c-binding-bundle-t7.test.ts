import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { familyExtension } from "../src/round5c/families/index.js";

/** The family versions the extensions under test create. */
const BINDING_BUNDLE_VERSIONS: ReadonlySet<string> = new Set(["usage-limit@5", "event@24", "attack@7"]);

/** Leaves placed by their wording in `text`, in order (fabricated wording, not rules text). */
function compileItems(text: string, items: Array<[string, string, Record<string, unknown>, string?]>) {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  const leaves: CompileLeaf[] = items.map(([wording, family, parameters, fragment]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: fragment ?? "RAW_TEXT" };
  });
  return compileLeaves(leaves, text);
}

function mechanicsOf(text: string, items: Array<[string, string, Record<string, unknown>, string?]>): Record<string, any> {
  const result = compileItems(text, items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(text: string, items: Array<[string, string, Record<string, unknown>, string?]>): string[] {
  const result = compileItems(text, items);
  return result.ok ? [] : result.errors;
}

/** The version just before this bundle's extension of `family`; later extensions may sit above it. */
const PREVIOUS = (family: string) => {
  for (let version = currentFamilyVersion(family); version > 1; version -= 1) {
    const extension = familyExtension(family, version);
    if (extension !== undefined && BINDING_BUNDLE_VERSIONS.has(`${extension.family}@${extension.version}`)) return version - 1;
  }
  throw new Error(`The binding bundle does not extend ${family}.`);
};

describe("usage-limit per selected-unit (version 5 widens per only)", () => {
  it("accepts per selected-unit at the current version and not at the one before", () => {
    const leaf = { frequency: "once-per-turn", per: "selected-unit" };
    expect(normalizeFingerprintParameters("usage-limit", leaf, currentFamilyVersion("usage-limit"))).toEqual(leaf);
    expect(() => normalizeFingerprintParameters("usage-limit", leaf, PREVIOUS("usage-limit"))).toThrow();
  });

  it("still accepts every per value the previous version accepted", () => {
    for (const per of ["any", "army", "unit", "model"]) {
      const leaf = { frequency: "once-per-turn", per };
      expect(normalizeFingerprintParameters("usage-limit", leaf, currentFamilyVersion("usage-limit"))).toEqual(leaf);
    }
  });
});

describe("event attack_type on damage-allocated (widens the event family)", () => {
  it("accepts ranged and psychic on a damage-allocated moment and keeps the moment's other kinds unchanged", () => {
    const version = currentFamilyVersion("event");
    expect(normalizeFingerprintParameters("event", { kind: "damage-allocated", attack_type: "ranged" }, version)).toEqual({ kind: "damage-allocated", attack_type: "ranged" });
    expect(normalizeFingerprintParameters("event", { kind: "damage-allocated" }, version)).toEqual({ kind: "damage-allocated" });
    expect(() => normalizeFingerprintParameters("event", { kind: "attack-made", attack_type: "ranged" }, version)).toThrow();
    expect(normalizeFingerprintParameters("event", { kind: "damage-allocated", attack_type: "psychic" }, version)).toEqual({ kind: "damage-allocated", attack_type: "psychic" });
  });

  it("refuses attack_type at the version before", () => {
    expect(() => normalizeFingerprintParameters("event", { kind: "damage-allocated", attack_type: "ranged" }, PREVIOUS("event"))).toThrow();
  });
});

describe("attack target following-filter (widens the attack family)", () => {
  it("accepts the defender named by the following filter, and keeps that-unit", () => {
    const version = currentFamilyVersion("attack");
    const leaf = { direction: "makes", unit: "friendly-unit", attack_type: "ranged", target: "following-filter" };
    expect(normalizeFingerprintParameters("attack", leaf, version)).toEqual(leaf);
    const that = { direction: "makes", unit: "this-unit", attack_type: "any", target: "that-unit" };
    expect(normalizeFingerprintParameters("attack", that, version)).toEqual(that);
  });

  it("refuses a following-filter target that is not a makes attack, or whose unit is that-unit", () => {
    const version = currentFamilyVersion("attack");
    expect(() => normalizeFingerprintParameters("attack", { direction: "targeted", unit: "friendly-unit", attack_type: "any", target: "following-filter" }, version)).toThrow();
    expect(() => normalizeFingerprintParameters("attack", { direction: "makes", unit: "that-unit", attack_type: "any", target: "following-filter" }, version)).toThrow();
  });
});

describe("per selected-unit usage lowers to the unit selection's cap (8553 shape)", () => {
  const TEXT = "Shooting phase. Select one ALPHA unit within 6 of this model. That unit must take a Battle-shock test. Once per turn, the same unit can only be selected for this ability.";
  const ITEMS: Array<[string, string, Record<string, unknown>, string?]> = [
    ["Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
    ["Select one", "select-unit", { scope: "enemy", distance: "any", visible: false }],
    ["ALPHA unit", "unit-filter", { side: "enemy", keywords: ["ALPHA"] }],
    ["That unit must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }],
    ["Once per turn", "usage-limit", { frequency: "once-per-turn", per: "selected-unit" }],
  ];

  it("caps the enemy selection and leaves the ability without a usage", () => {
    const mechanics = mechanicsOf(TEXT, ITEMS);
    const selector = mechanics.effect.effect.selector;
    expect(selector.limit).toEqual({ count: 1, period: "turn" });
    expect(selector.filter).toMatchObject({ owner: "enemy" });
    expect(mechanics.usage).toBeUndefined();
  });

  it("refuses a per selected-unit usage on a model selection", () => {
    const errors = errorsOf("Shooting phase. Select one ALPHA model within 6 of this model. That model must take a Battle-shock test. Once per turn, the same model can only be selected.", [
      ["Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["Select one", "select-unit", { distance: "any", visible: false }],
      ["ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["That model must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }],
      ["Once per turn", "usage-limit", { frequency: "once-per-turn", per: "selected-unit" }],
    ]);
    expect(errors.join(" ")).toContain("per-selected-unit usage on a model selection has no reading");
  });

  it("lowers a designated selection's cap to designate-target's select, counted across bearers", () => {
    const text = "Shooting phase. Select one ALPHA unit. Each time a friendly unit makes an attack that targets that unit, add 1 to the Hit roll. Once per turn, the same unit can only be selected.";
    const mechanics = mechanicsOf(text, [
      ["Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["Select one", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["ALPHA unit", "unit-filter", { side: "enemy", keywords: ["ALPHA"] }],
      ["Each time a friendly unit makes an attack that targets that unit", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any", target: "that-unit" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
      ["Once per turn", "usage-limit", { frequency: "once-per-turn", per: "selected-unit" }],
    ]);
    const designate = mechanics.effect.effect;
    expect(designate.type).toBe("designate-target");
    expect(designate.select.selector.limit).toEqual({ count: 1, period: "turn" });
    expect(mechanics.usage).toBeUndefined();
  });

  it("keeps a bearer's own per-unit usage on the ability alongside the selected-unit cap (8553 bearer shape)", () => {
    const text = "Shooting phase. Select one ALPHA unit. Each time a friendly unit makes an attack that targets that unit, add 1 to the Hit roll. Once per turn, the same unit can only be selected. Once per turn, this unit can use this ability.";
    const mechanics = mechanicsOf(text, [
      ["Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["Select one", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["ALPHA unit", "unit-filter", { side: "enemy", keywords: ["ALPHA"] }],
      ["Each time a friendly unit makes an attack that targets that unit", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any", target: "that-unit" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
      ["Once per turn, the same unit", "usage-limit", { frequency: "once-per-turn", per: "selected-unit" }],
      ["Once per turn, this unit", "usage-limit", { frequency: "once-per-turn", per: "unit" }],
    ]);
    expect(mechanics.effect.effect.select.selector.limit).toEqual({ count: 1, period: "turn" });
    expect(mechanics.usage).toMatchObject({ frequency: "once-per-turn", per: "unit" });
  });
});

describe("a model's attack that targets that unit lowers with the selected unit as attacker (8538 shape)", () => {
  const TEXT = "Command phase. Select one ALPHA model within 3 of this model. Each time that ALPHA model makes an attack, add 1 to the Hit roll. Each model can only be selected for this ability once per turn.";
  const ITEMS = (unit: string): Array<[string, string, Record<string, unknown>, string?]> => [
    ["Command phase", "phase-window", { phase: "command", turn: "your" }],
    ["Select one", "select-unit", { distance: "any", visible: false }],
    ["ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
    ["within 3 of this model", "unit-position", { kind: "within", inches: 3, of: "this-model", subject: "selected-unit", negated: false }],
    ["Each time that ALPHA model makes an attack", "attack", { direction: "makes", unit, attack_type: "any" }],
    ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ["Each model can only be selected for this ability once per turn", "usage-limit", { frequency: "once-per-turn", per: "model" }],
  ];

  it("compiles with the model selection's cap and the attacker as the selected unit", () => {
    const mechanics = mechanicsOf(TEXT, ITEMS("that-unit"));
    const selector = mechanics.effect.effect.selector;
    expect(selector.filter.level).toBe("model");
    expect(selector.limit).toEqual({ count: 1, period: "turn" });
    expect(JSON.stringify(mechanics.effect.effect.effect)).toContain("\"target\":\"selected-unit\"");
  });

  it("keeps the refusal for an attack by any other unit on a model selection", () => {
    expect(errorsOf(TEXT, ITEMS("this-model")).join(" ")).toContain("An attack made by a selected model has no decided binding yet");
  });
});

describe("attack whose defender is the following filter binds visible to that defender (8166 shape)", () => {
  const TEXT = "While the bearer is within 3\" of one or more friendly DEATH GUARD VEHICLE units, each time one of those VEHICLE units makes a ranged attack that targets an enemy unit visible to the bearer, re-roll a Wound roll of 1.";
  const ITEMS = (attack: Record<string, unknown> = { direction: "makes", unit: "friendly-unit", attack_type: "ranged", target: "following-filter" }): Array<[string, string, Record<string, unknown>, string?]> => [
    ["While the bearer is within 3\" of one or more friendly DEATH GUARD VEHICLE units", "unit-position", { kind: "within", inches: 3, of: "matching-unit", subject: "this-model", negated: false, of_keywords: ["DEATH GUARD", "VEHICLE"], of_side: "friendly" }],
    ["one of those VEHICLE units", "unit-filter", { side: "friendly", keywords: ["VEHICLE"], among: "matched-units" }],
    ["makes a ranged attack that targets", "attack", attack],
    ["an enemy unit", "unit-filter", { side: "enemy" }],
    ["visible to the bearer", "visible", { subject: "antecedent", to: "this-model" }],
    ["re-roll a Wound roll of 1", "reroll", { roll: "wound", subset: "ones", weapon_type: "all" }],
  ];

  it("binds the visible subject to the defender, and the defender is an enemy unit", () => {
    const mechanics = mechanicsOf(TEXT, ITEMS());
    const conditions = JSON.stringify(mechanics.effect);
    expect(conditions).toContain('"type":"matches","parameters":{"subject":"defender","filter":{"visible":{"to":"this-model"}}}');
    expect(conditions).toContain("\"owner\":\"enemy\"");
  });

  it("refuses a following-filter target with no unit-filter right after the attack", () => {
    const errors = errorsOf(TEXT, ITEMS().filter((item) => item[0] !== "an enemy unit"));
    expect(errors.join(" ")).toContain("needs an enemy or friendly unit-filter right after it");
  });

  it("refuses visible on an enemy filter that follows an attack naming no target, rather than binding it to this model", () => {
    const errors = errorsOf(TEXT, ITEMS({ direction: "makes", unit: "friendly-unit", attack_type: "ranged" }));
    expect(errors.join(" ")).toContain("the attack has no target");
  });

  it("refuses a defender filter that says neither friendly nor enemy", () => {
    const errors = errorsOf(TEXT, ITEMS().map((item) => item[0] === "an enemy unit" ? ["an enemy unit", "unit-filter", { side: "any" }] as [string, string, Record<string, unknown>] : item));
    expect(errors.join(" ")).toContain("must say friendly or enemy");
  });
});

describe("a plural among-filter takes an up-to head whole (7708 shape)", () => {
  const TEXT = "Start of your Movement phase. One ALPHA unit and up to three friendly BRAVO units. Each one of those BRAVO units must take a Battle-shock test.";
  const ITEMS = (count: Record<string, unknown>): Array<[string, string, Record<string, unknown>, string?]> => [
    ["Start of your Movement phase", "event", { kind: "phase-start", phase: "movement", turn: "your" }, "WHEN"],
    ["One", "stratagem-target", { count: "one" }, "TARGET"],
    ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "TARGET"],
    ["up to three", "stratagem-target", count, "TARGET"],
    ["friendly BRAVO units", "unit-filter", { side: "friendly", keywords: ["BRAVO"] }, "TARGET"],
    ["Each one of those BRAVO units", "unit-filter", { side: "friendly", keywords: ["BRAVO"], among: "stratagem-targets", targets: "any" }, "EFFECT"],
    ["must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }, "EFFECT"],
  ];

  it("binds the plural pick to the up-to head", () => {
    const mechanics = mechanicsOf(TEXT, ITEMS({ count: "up-to", count_max: 3 }));
    expect(mechanics.effect.target).toEqual({ stratagem_target: "second" });
  });

  it("keeps the refusal for a plural pick over a singular head", () => {
    expect(errorsOf(TEXT, ITEMS({ count: "one" })).join(" ")).toContain("names any one of several targets but matches only second");
  });
});

describe("for-each including the target: the keyword narrows only the other units (7269 shape)", () => {
  const TEXT = "Shooting phase, just after selecting a target. The target unit and every other enemy BRAVO unit within 3 of that unit must take a Battle-shock test.";
  const ITEMS = (extra: Array<[string, string, Record<string, unknown>, string?]> = []): Array<[string, string, Record<string, unknown>, string?]> => [
    ["Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
    ["just after selecting a target", "event", { kind: "targets-selected", action_kind: "shoot" }],
    ["The target unit and every other", "for-each-unit-select", { including: "target" }],
    ["enemy BRAVO unit", "unit-filter", { side: "enemy", keywords: ["BRAVO"] }],
    ["within 3 of that unit", "unit-position", { kind: "within", inches: 3, of: "target", subject: "antecedent", negated: false }],
    ["must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }],
    ...extra,
  ];

  it("does not require the target to have the keyword, and gates only the others", () => {
    const mechanics = mechanicsOf(TEXT, ITEMS());
    const selector = mechanics.effect.effect.selector;
    expect(selector.filter).toEqual({ owner: "enemy" });
    const others = selector.eligibility.operands[1];
    expect(selector.eligibility.operands[0]).toEqual({ type: "same-unit", parameters: { as: "defender" } });
    expect(JSON.stringify(others)).toContain("\"all_of\":[\"BRAVO\"]");
  });

  it("keeps the target and every other matching unit even without a range restriction", () => {
    const mechanics = mechanicsOf("Shooting phase, just after selecting a target. The target unit and every other enemy BRAVO unit must take a Battle-shock test.", [
      ["Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["just after selecting a target", "event", { kind: "targets-selected", action_kind: "shoot" }],
      ["The target unit and every other", "for-each-unit-select", { including: "target" }],
      ["enemy BRAVO unit", "unit-filter", { side: "enemy", keywords: ["BRAVO"] }],
      ["must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }],
    ]);
    expect(mechanics.effect.effect.selector).toEqual({ filter: { owner: "enemy" }, eligibility: { operator: "or", operands: [
      { type: "same-unit", parameters: { as: "defender" } },
      { type: "matches", parameters: { filter: { owner: "enemy", all_of: ["BRAVO"] } } },
    ] } });
  });

  it("does not narrow the target by an excluded keyword", () => {
    const mechanics = mechanicsOf(TEXT, ITEMS().map((item) => item[0] === "enemy BRAVO unit" ? ["enemy BRAVO unit", "unit-filter", { side: "enemy", keywords: ["BRAVO"], excluded_keywords: ["CHARACTER"] }] as [string, string, Record<string, unknown>] : item));
    expect(mechanics.effect.effect.selector.excluded_keywords).toBeUndefined();
    expect(JSON.stringify(mechanics.effect.effect.selector.eligibility)).toContain("\"CHARACTER\"");
  });
});

describe("destroyed Warlord: the destruction object takes the Warlord designation (7891 shape)", () => {
  const TEXT = "Fight phase. Your unit makes a melee attack. After your unit has fought, if the enemy WARLORD was destroyed as a result of those attacks, each enemy unit within 6 of your unit must take a Battle-shock test.";
  const ITEMS = (activity: string, filter: Record<string, unknown> = { side: "enemy" }): Array<[string, string, Record<string, unknown>, string?]> => [
    ["Fight phase", "phase-window", { phase: "fight", turn: "your" }],
    ["makes a melee attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "melee" }],
    ["After your unit has fought", "event", { kind: "attacks-resolved" }],
    ["the enemy", "unit-filter", filter],
    ["WARLORD", "designated-filter", { subject: "antecedent", tag: "warlord" }],
    ["was destroyed as a result of those attacks", "unit-activity", { activities: [activity], named: "before", container: "none", destroyer: "this-unit" }],
    ["each enemy unit", "unit-filter", { side: "enemy" }],
    ["within 6 of your unit", "unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "antecedent", negated: false }],
    ["must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }],
  ];

  it("compiles the destroyed Warlord as model-destroyed with object_owner enemy and the Warlord designation", () => {
    const result = compileItems(TEXT, ITEMS("destroyed-models-by-triggering-attacks"));
    expect(result.ok).toBe(true);
    const happened = JSON.stringify(result.ok ? result.mechanics : {});
    expect(happened).toContain('"event":"model-destroyed","object":{"owner":"enemy","designated":"warlord","level":"model"}');
    expect(happened).toContain('"filter":{"by":"this-unit"},"window":"event"');
  });

  it("refuses the Warlord designation on a destroyed unit, which is not a model", () => {
    const errors = errorsOf(TEXT, ITEMS("destroyed-units-by-triggering-attacks"));
    expect(errors.join(" ")).toContain("naming the Warlord");
  });

  it("refuses the Warlord designation on an effect's units outside a Warlord destruction", () => {
    const errors = errorsOf("Fight phase. Each enemy WARLORD must take a Battle-shock test.", [
      ["Fight phase", "phase-window", { phase: "fight", turn: "your" }],
      ["Each enemy", "unit-filter", { side: "enemy" }],
      ["WARLORD", "designated-filter", { subject: "antecedent", tag: "warlord" }],
      ["must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }],
    ]);
    expect(errors.join(" ")).toContain("naming the Warlord");
  });
});

describe("for-each including the target cannot range from the bearer (7269 refusal)", () => {
  it("refuses a distance on the including quantifier at the family, so the compile refusal is never reached through reviewed leaves", () => {
    const version = currentFamilyVersion("for-each-unit-select");
    expect(() => normalizeFingerprintParameters("for-each-unit-select", { including: "target", scope: "enemy", distance: "within", inches: 3 }, version)).toThrow();
    expect(() => normalizeFingerprintParameters("for-each-unit-select", { including: "target" }, version)).not.toThrow();
  });
});

describe("damage-allocated attack type and the allocated model (8755 and 1614 shapes)", () => {
  it("gates a reactive damage-allocated trigger on the attack type, and the grant binds the allocated model", () => {
    const text = "Each time a ranged attack is allocated to an ALPHA model from your army, if that model is not fully visible to the attacker, that model has the Benefit of Cover.";
    const mechanics = mechanicsOf(text, [
      ["Each time a ranged attack is allocated to an", "event", { kind: "damage-allocated", attack_type: "ranged" }],
      ["ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["if that model is not fully visible to the attacker", "visible", { subject: "defender", to: "attacker", fully: true, blocked_by: "this-model", negated: true }],
      ["that model has the Benefit of Cover", "core-ability-grant", { subject: "antecedent", ability: "benefit-of-cover" }],
    ]);
    expect(mechanics.trigger.event).toBe("damage-allocated");
    expect(mechanics.trigger.condition).toEqual({ type: "attack-is", parameters: { attack_type: "ranged" } });
    expect(JSON.stringify(mechanics.effect)).toContain("\"target\":\"event-object\"");
  });

  it("adds no condition for attack_type any", () => {
    const mechanics = mechanicsOf("Each time an attack is allocated to an ALPHA model, if that model is not fully visible to the attacker, that model has the Benefit of Cover.", [
      ["Each time an attack is allocated to an", "event", { kind: "damage-allocated", attack_type: "any" }],
      ["ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["if that model is not fully visible to the attacker", "visible", { subject: "defender", to: "attacker", fully: true, blocked_by: "this-model", negated: true }],
      ["that model has the Benefit of Cover", "core-ability-grant", { subject: "antecedent", ability: "benefit-of-cover" }],
    ]);
    expect(mechanics.trigger.condition).toBeUndefined();
  });

  it("binds a Stratagem's that-model grant to the allocated model, not the Stratagem's target", () => {
    const text = "Shooting phase, just after an enemy unit has selected its targets. One ALPHA VEHICLE unit from your army. Until the end of the phase, each time a ranged attack is allocated to a model, that model has the Benefit of Cover.";
    const mechanics = mechanicsOf(text, [
      ["Shooting phase", "use-window", { your_phases: [], opponent_phases: ["shooting"], either_phases: [] }, "WHEN"],
      ["just after an enemy unit has selected its targets", "event", { kind: "enemy-selected-targets" }, "WHEN"],
      ["One", "stratagem-target", { count: "one" }, "TARGET"],
      ["ALPHA VEHICLE unit", "unit-filter", { side: "friendly", keywords: ["ALPHA", "VEHICLE"] }, "TARGET"],
      ["from your army", "unit-owner", { owner: "friendly" }, "TARGET"],
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
      ["ranged attack is allocated to a model", "event", { kind: "damage-allocated", attack_type: "ranged" }, "EFFECT"],
      ["that model has the Benefit of Cover", "core-ability-grant", { subject: "antecedent", ability: "benefit-of-cover" }, "EFFECT"],
    ]);
    expect(JSON.stringify(mechanics.effect)).toContain("\"target\":\"event-object\"");
    expect(JSON.stringify(mechanics.effect)).not.toContain("\"target\":\"this-unit\"");
  });
});
