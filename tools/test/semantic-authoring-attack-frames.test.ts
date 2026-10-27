import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";
import { bindBareFilterHits } from "../src/semantic-authoring/compile-weapon-qualified.js";

/** A registered designation, so a designate-target compiles (compile-wrappers.ts designationIdFor). */
const FIXTURE_RULE_NAME = "A Trap Well Laid";

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

function effectOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text, { name: FIXTURE_RULE_NAME });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return (result.mechanics as unknown as Record<string, any>).effect;
}

const rangedAttack = (wording: string): [string, string, Record<string, unknown>] => [wording, "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged" }];

describe("Semantic authoring properties of an attack with conditions on its target", () => {
  it("grants keywords after an attack and its target filter to the attack, gated on the target", () => {
    const text = "This unit's ranged attacks that target an enemy MONSTER unit have [SUSTAINED HITS 1].";
    const effect = effectOf(placed(text,
      rangedAttack("This unit's ranged attacks"),
      ["enemy MONSTER unit", "unit-filter", { side: "enemy", keywords: ["MONSTER"] }],
      ["SUSTAINED HITS 1", "weapon-ability-keyword", { keyword: "Sustained Hits 1" }]), text);
    expect(effect.type).toBe("conditional");
    expect(effect.condition).toMatchObject({ type: "matches", parameters: { subject: "defender", filter: { all_of: ["MONSTER"] } } });
    expect(effect.effect).toEqual({ type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "sustained-hits", parameters: { value: 1 } }], weapons: { type: "ranged" } } });
  });

  it("reads list punctuation between properties as one list, and gives an unowned stat to the attack", () => {
    const text = "This unit's melee attacks have:+1 S.[LETHAL HITS].[PRECISION].";
    const effect = effectOf(placed(text,
      ["This unit's melee attacks", "attack", { direction: "makes", unit: "this-unit", attack_type: "melee" }],
      ["+1 S", "characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 1 }],
      ["LETHAL HITS", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
      ["PRECISION", "weapon-ability-keyword", { keyword: "Precision" }]), text);
    expect(effect).toEqual({ type: "sequence", steps: [
      { type: "stat-modifier", target: "this-unit", modifier: { stat: "S", operation: "improve", value: 1, weapons: { type: "melee" } } },
      { type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "lethal-hits" }, { keyword_id: "precision" }], weapons: { type: "melee" } } },
    ] });
  });

  it("does not let a framed attack's melee/ranged gate reach the next sentence", () => {
    const text = "When a friendly ALPHA unit is selected to Advance: that unit's ranged attacks have [ASSAULT]. That unit is eligible to declare a charge.";
    const effect = effectOf(placed(text,
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["is selected to Advance", "event", { kind: "selected", to: "move", move_types: ["advance"] }],
      ["that unit's ranged attacks", "attack", { direction: "makes", unit: "that-unit", attack_type: "ranged" }],
      ["ASSAULT", "weapon-ability-keyword", { keyword: "Assault" }],
      ["That unit is eligible to declare a charge", "eligibility-permission", { subject: "antecedent", activity: "declare-charge", allow: true }]), text);
    expect(JSON.stringify(effect)).not.toContain("attack-is");
    expect(effect.steps[0]).toMatchObject({ type: "weapon-ability-grant", target: "event-subject" });
    expect(effect.steps[1]).toMatchObject({ type: "permission", target: "event-subject" });
  });

  it("folds a target filter that follows the weapon the attack is made with", () => {
    const text = "Each time this model makes an attack with its plasma lance that targets a VEHICLE unit, add 1 to the Wound roll.";
    const effect = effectOf(placed(text,
      ["Each time this model makes an attack", "attack", { direction: "makes", unit: "this-model", attack_type: "any" }],
      ["with its plasma lance", "attack-filter", { weapon_name: "plasma lance" }],
      ["VEHICLE unit", "unit-filter", { side: "enemy", keywords: ["VEHICLE"] }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }]), text);
    expect(JSON.stringify(effect.condition)).toContain('"weapons":{"name":"plasma lance"}');
    expect(JSON.stringify(effect.condition)).toContain('"subject":"defender","filter":{"all_of":["VEHICLE"]}');
  });

  it("lets a filter's units' attack scope take a target gate and a duration before its properties", () => {
    const text = "Select one enemy unit within 12\" of this unit. Friendly ALPHA units' attacks that target that unit, until the end of the phase, have [LETHAL HITS].";
    const result = compileLeaves(placed(text,
      ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["within 12\" of this unit", "unit-position", { kind: "within", inches: 12, of: "this-unit", subject: "antecedent", negated: false }],
      ["Friendly ALPHA units'", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["attacks", "weapon-property-scope", { subject: "antecedent", weapon_type: "all" }],
      ["that target that unit", "target-is-selected", {}],
      ["until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["LETHAL HITS", "weapon-ability-keyword", { keyword: "Lethal Hits" }]), text, { name: FIXTURE_RULE_NAME });
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (!result.ok) return;
    const json = JSON.stringify(result.mechanics);
    expect(json).toContain('"all_of":["ALPHA"]');
    expect(json).toContain('"keyword_id":"lethal-hits"');
    expect((result.mechanics as unknown as Record<string, any>).scope.duration).toBe("phase");
  });
});

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
const reroll = (roll: string, weaponType = "all"): Record<string, unknown> => ({ roll, subset: "all", weapon_type: weaponType, count: 1 });
const FRIENDLY_VEHICLES: Array<[string, string, Record<string, unknown>]> = [
  ["Friendly ALPHA VEHICLE units", "unit-filter", { side: "friendly", keywords: ["ALPHA", "VEHICLE"] }],
  ["(excluding WALKER units)", "unit-filter", { side: "friendly", excluded_keywords: ["WALKER"] }],
];
const TEXT = "Friendly ALPHA VEHICLE units (excluding WALKER units) ranged attacks can: Re-roll one hit roll. Re-roll one wound roll.";

function compile(list: CompileLeaf[], text = TEXT) {
  return compileLeaves(list, text, {});
}

// "Friendly X units' ranged attacks can:" + two rolls. The attack-filter is the rolls' attack type.
describe("Semantic authoring attack-filter frame over subjectless rolls", () => {
  it("folds the attack type into each roll as its weapon scope and drops the frame", () => {
    const result = compile(placed(TEXT, ...FRIENDLY_VEHICLES,
      ["ranged attacks can:", "attack-filter", { attack_type: "ranged" }],
      ["Re-roll one hit roll.", "reroll", reroll("hit")],
      ["Re-roll one wound roll.", "reroll", reroll("wound")]));
    expect(result.ok).toBe(true);
    const steps = (result as { mechanics: { effect: { steps: Array<{ target: unknown; modifier: { roll: string; weapons?: { type?: string } } }> } } }).mechanics.effect.steps;
    expect(steps.map((step) => step.modifier.weapons?.type)).toEqual(["ranged", "ranged"]);
    expect(steps.map((step) => step.modifier.roll)).toEqual(["hit", "wound"]);
    // Each roll's recipient is the filter's units, exclusion included, not the attack's target.
    expect(steps[1]!.target).toEqual({ owner: "friendly", all_of: ["ALPHA", "VEHICLE"], none_of: ["WALKER"] });
    expect(JSON.stringify((result as { mechanics: unknown }).mechanics)).not.toContain("attack-filter");
  });

  it("keeps an explicit weapon_type that matches the attack type", () => {
    const result = compile(placed(TEXT, ...FRIENDLY_VEHICLES,
      ["ranged attacks can:", "attack-filter", { attack_type: "ranged" }],
      ["Re-roll one hit roll.", "reroll", reroll("hit", "ranged")],
      ["Re-roll one wound roll.", "reroll", reroll("wound", "all")]));
    expect(result.ok).toBe(true);
  });

  it("refuses a roll whose explicit weapon_type differs from the attack type", () => {
    const result = compile(placed(TEXT, ...FRIENDLY_VEHICLES,
      ["ranged attacks can:", "attack-filter", { attack_type: "ranged" }],
      ["Re-roll one hit roll.", "reroll", reroll("hit")],
      ["Re-roll one wound roll.", "reroll", reroll("wound", "melee")]));
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(" ")).toMatch(/ranged attack-filter and a melee roll.*conflict/);
  });

  it("refuses a negated attack-filter", () => {
    const result = compile(placed(TEXT, ...FRIENDLY_VEHICLES,
      ["ranged attacks can:", "attack-filter", { attack_type: "ranged", negated: true }],
      ["Re-roll one hit roll.", "reroll", reroll("hit")],
      ["Re-roll one wound roll.", "reroll", reroll("wound")]));
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(" ")).toMatch(/needs a select-unit or attack right before it/);
  });

  it("refuses a psychic attack-filter, which weapon_type cannot scope", () => {
    const result = compile(placed(TEXT, ...FRIENDLY_VEHICLES,
      ["ranged attacks can:", "attack-filter", { attack_type: "psychic" }],
      ["Re-roll one hit roll.", "reroll", reroll("hit")],
      ["Re-roll one wound roll.", "reroll", reroll("wound")]));
    expect(result.ok).toBe(false);
  });

  it("refuses an attack-filter that names more than its type", () => {
    const result = compile(placed(TEXT, ...FRIENDLY_VEHICLES,
      ["ranged attacks can:", "attack-filter", { attack_type: "ranged", weapon_keyword: "Torrent" }],
      ["Re-roll one hit roll.", "reroll", reroll("hit")],
      ["Re-roll one wound roll.", "reroll", reroll("wound")]));
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(" ")).toMatch(/needs a select-unit or attack right before it/);
  });

  it("refuses a frame followed by an effect that is not a subjectless roll", () => {
    const result = compile(placed(TEXT, ...FRIENDLY_VEHICLES,
      ["ranged attacks can:", "attack-filter", { attack_type: "ranged" }],
      ["Re-roll one hit roll.", "reroll", { ...reroll("hit"), subject: "this-unit" }]));
    expect(result.ok).toBe(false);
  });

  it("refuses a roll-auto-result, which has no weapon_type in the DSL, rather than dropping the frame", () => {
    const result = compile(placed(TEXT, ...FRIENDLY_VEHICLES,
      ["ranged attacks can:", "attack-filter", { attack_type: "ranged" }],
      ["Re-roll one hit roll.", "roll-auto-result", { roll: "hit", outcome: "auto-pass", count: 1 }]));
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(" ")).toMatch(/cannot scope a roll-auto-result effect/);
  });

  it("refuses an attack frame over a test roll", () => {
    const result = compile(placed(TEXT, ...FRIENDLY_VEHICLES,
      ["ranged attacks can:", "attack-filter", { attack_type: "ranged" }],
      ["Re-roll one hit roll.", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 1 }]));
    expect(result.ok).toBe(false);
    expect((result as { errors: string[] }).errors.join(" ")).toMatch(/hit, wound or damage rolls only/);
  });
});

{
  /** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
  const COMPARE = { left_of: "attacker", left_stat: "S", comparison: "greater-than", right_kind: "stat", right_of: "defender", right_stat: "T" };
  const WOUND_MINUS_ONE = { roll: "wound", operation: "subtract", value: 1 };
  const CLAW = ["friendly Zeta units", "unit-filter", { side: "friendly", keywords: ["ZETA"] }] as const;
  const TEXT = "Ranged attacks aimed at friendly Zeta units where the attacker's power is above the target's resilience have -1 to wound rolls.";

  const errorsOf = (result: unknown) => (result as { errors: string[] }).errors.join(" ");
  const mechanicsOf = (result: unknown) => JSON.stringify((result as { mechanics: unknown }).mechanics);

  // "Ranged attacks aimed at friendly X units where the attacker's power is above the target's resilience": the attack-filter
  // is the attack, and the unit-filter after it is the attack's defender.
  describe("Semantic authoring attack-filter frame with a defender unit-filter", () => {
    it("binds the unit-filter to the attack's target, keeping its side and keywords", () => {
      const result = compile(placed(TEXT,
        ["Ranged attacks", "attack-filter", { attack_type: "ranged" }], CLAW,
        ["where the attacker's power is above the target's resilience", "attack-compare", COMPARE],
        ["have -1 to wound rolls.", "roll-modifier", WOUND_MINUS_ONE]));
      expect(result.ok).toBe(true);
      const json = mechanicsOf(result);
      expect(json).toContain('"all_of":["ZETA"]');
      expect(json).toContain('"type":"matches","parameters":{"subject":"defender","filter":{"owner":"friendly","all_of":["ZETA"]}}');
      expect(json).toContain('"attack_type":"ranged"');
      expect(json).toContain('"type":"attack-compare"');
      expect(json).not.toContain("unit-filter-target");
      // The wound roll is the attacking unit's: the -1 lands on the attacker, not on this unit.
      expect(json).toContain('"type":"roll-modifier","target":"attacker"');
      expect(json).not.toContain('"target":"this-unit"');
    });

    it("refuses a target filter that is not friendly or enemy", () => {
      const result = compile(placed(TEXT,
        ["Ranged attacks", "attack-filter", { attack_type: "ranged" }],
        ["friendly Zeta units", "unit-filter", { side: "any", keywords: ["ZETA"] }],
        ["where the attacker's power is above the target's resilience", "attack-compare", COMPARE],
        ["have -1 to wound rolls.", "roll-modifier", WOUND_MINUS_ONE]));
      expect(result.ok).toBe(false);
      expect(errorsOf(result)).toMatch(/must say friendly or enemy/);
    });

    it("refuses a second unit-filter after the target filter rather than binding it to the roll", () => {
      const text = "Ranged attacks aimed at friendly Zeta units, enemy Monster units have -1 to wound rolls.";
      const result = compile(placed(text,
        ["Ranged attacks", "attack-filter", { attack_type: "ranged" }],
        ["friendly Zeta units", "unit-filter", { side: "friendly", keywords: ["ZETA"] }],
        ["enemy Monster units", "unit-filter", { side: "enemy", keywords: ["MONSTER"] }],
        ["have -1 to wound rolls.", "roll-modifier", WOUND_MINUS_ONE]), text);
      expect(result.ok).toBe(false);
      expect(errorsOf(result)).toMatch(/needs a select-unit or attack right before it/);
    });

    it("refuses a frame that names more than its attack type", () => {
      const result = compile(placed(TEXT,
        ["Ranged attacks", "attack-filter", { attack_type: "ranged", of: "antecedent" }], CLAW,
        ["where the attacker's power is above the target's resilience", "attack-compare", COMPARE],
        ["have -1 to wound rolls.", "roll-modifier", WOUND_MINUS_ONE]));
      expect(result.ok).toBe(false);
      expect(errorsOf(result)).toMatch(/Those attacks|needs a select-unit or attack right before it/);
    });

    it("refuses a negated frame", () => {
      const result = compile(placed(TEXT,
        ["Ranged attacks", "attack-filter", { attack_type: "ranged", negated: true }], CLAW,
        ["where the attacker's power is above the target's resilience", "attack-compare", COMPARE],
        ["have -1 to wound rolls.", "roll-modifier", WOUND_MINUS_ONE]));
      expect(result.ok).toBe(false);
    });
  });

  // "Attacks aimed at friendly X units where the attacker's power is above the target's resilience": no attack-filter.
  describe("Semantic authoring defender unit-filter before an attack-compare", () => {
    it("binds a clause-initial unit-filter to the attack-compare's defender", () => {
      const result = compile(placed("Attacks aimed at friendly Omega/Sigma units where the attacker's power is above the target's resilience have -1 to wound rolls.",
        ["friendly Omega/Sigma units", "unit-filter", { side: "friendly", any_keywords: ["OMEGA", "SIGMA"] }],
        ["where the attacker's power is above the target's resilience", "attack-compare", COMPARE],
        ["have -1 to wound rolls.", "roll-modifier", WOUND_MINUS_ONE])
        , "Attacks aimed at friendly Omega/Sigma units where the attacker's power is above the target's resilience have -1 to wound rolls.");
      expect(result.ok).toBe(true);
      expect(mechanicsOf(result)).toContain('"subject":"defender","filter":{"owner":"friendly","any_of":["OMEGA","SIGMA"]}');
      expect(mechanicsOf(result)).toContain('"type":"roll-modifier","target":"attacker"');
    });

    it("refuses when the attack-compare does not name the defender", () => {
      const text = "Attacks aimed at friendly Omega/Sigma units where the attacker's power is above the bearer's resilience have -1 to wound rolls.";
      const result = compile(placed(text,
        ["friendly Omega/Sigma units", "unit-filter", { side: "friendly", any_keywords: ["OMEGA", "SIGMA"] }],
        ["where the attacker's power is above the bearer's resilience", "attack-compare", { ...COMPARE, right_of: "this-unit" }],
        ["have -1 to wound rolls.", "roll-modifier", WOUND_MINUS_ONE]), text);
      expect(result.ok).toBe(false);
      expect(errorsOf(result)).toMatch(/needs a select-unit or attack right before it/);
    });

    it("refuses when an earlier leaf in the sentence precedes the unit-filter", () => {
      const text = "While this unit is near, attacks that target friendly Omega/Sigma units where the attacker's power is above the target's resilience have -1 to wound rolls.";
      const result = compile(placed(text,
        ["While this unit is near,", "unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "this-unit", negated: false }],
        ["friendly Omega/Sigma units", "unit-filter", { side: "friendly", any_keywords: ["OMEGA", "SIGMA"] }],
        ["where the attacker's power is above the target's resilience", "attack-compare", COMPARE],
        ["have -1 to wound rolls.", "roll-modifier", WOUND_MINUS_ONE]), text);
      expect(result.ok).toBe(false);
    });
  });

  // "Friendly X units' ranged attacks aimed at a unit within 12\" have +1 to hit rolls."
  describe("Semantic authoring attack frame with a target gate before its rolls", () => {
    const TEXT4 = "Friendly Echo units' ranged attacks aimed at a unit within 12\" have +1 to hit rolls.";
    const HIT_PLUS_ONE = { roll: "hit", operation: "add", value: 1 };
    const HERNKYN = ["Friendly Echo units'", "unit-filter", { side: "friendly", keywords: ["ECHO"] }] as const;
    // The distance is measured from the attacking unit, the unit the army-wide filter names.
    const TARGET_12 = ["aimed at a unit within 12\"", "unit-position", { kind: "within", inches: 12, of: "attacker", subject: "target", negated: false }] as const;

    it("keeps the target distance as a gate and folds the attacker filter into the roll", () => {
      const result = compile(placed(TEXT4, HERNKYN,
        ["ranged attacks", "attack-filter", { attack_type: "ranged" }], TARGET_12,
        ["have +1 to hit rolls.", "roll-modifier", HIT_PLUS_ONE]), TEXT4);
      expect(result.ok).toBe(true);
      const json = mechanicsOf(result);
      expect(json).toContain('"subject":"defender","filter":{"within":{"of":"attacker","range":{"inches":12}}}');
      expect(json).toContain('"owner":"friendly","all_of":["ECHO"]');
      expect(json).toContain('"weapons":{"type":"ranged"}');
      expect(json).not.toContain("attack-filter");
    });

    it("refuses a gate whose subject is not the attack's target", () => {
      const result = compile(placed(TEXT4, HERNKYN,
        ["ranged attacks", "attack-filter", { attack_type: "ranged" }],
        ["aimed at a unit within 12\"", "unit-position", { kind: "within", inches: 12, of: "this-unit", subject: "this-unit", negated: false }],
        ["have +1 to hit rolls.", "roll-modifier", HIT_PLUS_ONE]), TEXT4);
      expect(result.ok).toBe(false);
      expect(errorsOf(result)).toMatch(/needs a select-unit or attack right before it/);
    });
  });
}

{
  /** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
  function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
    const result = compileLeaves(list, text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    return result.mechanics as unknown as Record<string, any>;
  }

  const SHOOTING = ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }] as const;
  const AFTER_SHOT = ["after this model has shot", "event", { kind: "after-shooting" }] as const;
  const INFANTRY = ["enemy INFANTRY unit", "unit-filter", { side: "enemy", keywords: ["INFANTRY"] }] as const;
  const HIT_BY = ["was hit by one or more of those attacks", "hit-by-attacks", { subject: "antecedent" }] as const;
  const ZAP = ["made with a zap cannon", "attack-filter", { weapon_name: "zap cannon" }] as const;
  const PINNED = ["that enemy unit is pinned", "apply-mark", { subject: "antecedent", tag: "pinned" }] as const;

  /** "each enemy INFANTRY unit was hit by … made with a zap cannon. … that enemy unit is pinned." */
  const TEXT = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon. Until the end of the turn, that enemy unit is pinned.";

  describe("a bare unit-filter gated by a hit-by condition after it", () => {
    it("binds the hit and its attack-filter to a per-unit pass over the filter's units", () => {
      const mechanics = mechanicsOf(placed(TEXT, SHOOTING, AFTER_SHOT, INFANTRY, HIT_BY, ZAP, PINNED), TEXT);
      const json = JSON.stringify(mechanics);
      expect(json).toContain('"type":"for-each-unit"');
      expect(json).toContain('"filter":{"owner":"enemy","all_of":["INFANTRY"]}');
      expect(json).toContain('"weapons":{"name":"zap cannon"}');
      expect(json).toContain('"object":"this-unit"');
    });

    it("gates on no weapon when the hit-by condition has no attack-filter", () => {
      const text = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks. Until the end of the turn, that enemy unit is pinned.";
      const json = JSON.stringify(mechanicsOf(placed(text, SHOOTING, AFTER_SHOT, INFANTRY, HIT_BY, PINNED), text));
      expect(json).toContain('"type":"for-each-unit"');
      expect(json).not.toContain('"weapons"');
    });

    it("refuses a hit-by condition with no 'that unit' after it", () => {
      const text = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon.";
      const result = compileLeaves(placed(text, SHOOTING, AFTER_SHOT, INFANTRY, HIT_BY, ZAP), text);
      expect(result.ok).toBe(false);
      expect(result.errors?.join(" ")).toContain("needs a 'that unit' after it");
    });

    it("leaves a hit-by condition with subject this-unit alone", () => {
      const text = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon. Until the end of the turn, that enemy unit is pinned.";
      const list = placed(text, SHOOTING, AFTER_SHOT, INFANTRY, ["was hit by one or more of those attacks", "hit-by-attacks", { subject: "this-unit" }], ZAP, PINNED);
      expect(bindBareFilterHits(list, text)).toEqual(list);
    });

    it("refuses a moment that is not this unit's own after-shooting event", () => {
      const text = "After enemy units have shot, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon. Until the end of the turn, that enemy unit is pinned.";
      const list = placed(text, ["After enemy units have shot", "event", { kind: "attacks-resolved", subject: "enemy" }], INFANTRY, HIT_BY, ZAP, PINNED);
      expect(() => bindBareFilterHits(list, text)).toThrow("needs the attacks of this unit's own moment");
    });

    it("refuses an attacks-resolved moment that names no subject (this model's own attacks)", () => {
      const text = "After all of this model's attacks are resolved, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon. Until the end of the turn, that enemy unit is pinned.";
      const list = placed(text, ["After all of this model's attacks are resolved", "event", { kind: "attacks-resolved" }], INFANTRY, HIT_BY, ZAP, PINNED);
      expect(() => bindBareFilterHits(list, text)).toThrow("needs the attacks of this unit's own moment");
    });

    it("refuses a negated attack-filter instead of dropping it", () => {
      const text = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon. Until the end of the turn, that enemy unit is pinned.";
      const list = placed(text, SHOOTING, AFTER_SHOT, INFANTRY, HIT_BY, ["made with a zap cannon", "attack-filter", { weapon_name: "zap cannon", negated: true }], PINNED);
      expect(() => bindBareFilterHits(list, text)).toThrow("cannot be negated");
    });

    it("refuses an attack-filter field the hit filter does not have", () => {
      const text = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon. Until the end of the turn, that enemy unit is pinned.";
      const list = placed(text, SHOOTING, AFTER_SHOT, INFANTRY, HIT_BY, ["made with a zap cannon", "attack-filter", { side: "enemy" }], PINNED);
      expect(() => bindBareFilterHits(list, text)).toThrow("names side");
    });

    it("refuses a per-unit pass that shares a record with a count-scale", () => {
      const text = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon. Until the end of the turn, that enemy unit is pinned.";
      const list = placed(text, SHOOTING, AFTER_SHOT, INFANTRY, HIT_BY, ZAP, PINNED);
      const scaled = [...list, { role: "EFFECT", family_id: "count-scale", family_version: currentFamilyVersion("count-scale"), parameters: {}, start_byte: 0, end_byte: 1, fragment: "RAW_TEXT" } as CompileLeaf];
      expect(() => bindBareFilterHits(scaled, text)).toThrow("cannot share a record");
    });

    it("refuses a per-unit pass that shares a record with an army composition", () => {
      const text = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon. Until the end of the turn, that enemy unit is pinned.";
      const list = placed(text, SHOOTING, AFTER_SHOT, INFANTRY, HIT_BY, ZAP, PINNED);
      const composed = [...list, { role: familyRole("army-construction", currentFamilyVersion("army-construction")), family_id: "army-construction", family_version: currentFamilyVersion("army-construction"), parameters: { rule: "composition" }, start_byte: 0, end_byte: 1, fragment: "RAW_TEXT" } as CompileLeaf];
      expect(() => bindBareFilterHits(composed, text)).toThrow("cannot share a record");
    });

    it("refuses a second hit-by condition on the same bare filter", () => {
      const text = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks, and was hit by one or more of those attacks. Until the end of the turn, that enemy unit is pinned.";
      const list = placed(text, SHOOTING, AFTER_SHOT, INFANTRY, HIT_BY, ["and was hit by one or more of those attacks", "hit-by-attacks", { subject: "antecedent" }], PINNED);
      expect(() => bindBareFilterHits(list, text)).toThrow("takes one hit-by condition");
    });
  });

  /** The record's shape with fabricated wording: the hit, its weapon filter, the mark, and the two effects on "that unit". */
  const MIRROR = "In your Shooting phase, after this model has shot, each enemy INFANTRY unit was hit by one or more of those attacks made with a zap cannon. Until the end of the turn, that enemy unit is pinned. While a unit is pinned, subtract 2 from that unit's Move. Subtract 2 from Charge rolls made for that unit.";

  describe("the full hit-by shape compiles once the leaves are authored", () => {
    it("binds the Charge roll-modifier to the hit unit when its subject is the antecedent", () => {
      const list = placed(MIRROR, SHOOTING, AFTER_SHOT, INFANTRY, HIT_BY, ZAP,
        ["that enemy unit is pinned", "apply-mark", { subject: "antecedent", tag: "pinned" }],
        ["While a unit is pinned", "rule-active", { rule: "pinned" }],
        ["subtract 2 from that unit's Move", "characteristic-modifier", { subject: "antecedent", characteristics: ["M"], operation: "subtract", value: 2, weapon_type: "all" }],
        ["Subtract 2 from Charge rolls made for that unit", "roll-modifier", { roll: "charge", operation: "subtract", value: 2, subject: "antecedent" }]);
      const result = compileLeaves(list, MIRROR);
      expect(result.ok).toBe(true);
      const json = JSON.stringify(result.ok ? result.mechanics : null);
      expect(json).toContain('"type":"for-each-unit"');
      expect(json).toContain('"weapons":{"name":"zap cannon"}');
    });
  });
}
