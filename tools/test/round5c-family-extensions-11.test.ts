import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { targetRestrictions } from "../src/round5c/compile-conditions.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { designationLabel } from "../src/translate/designations.js";

/** Leaves in source order at the current version of their family. */
function leaves(...items: Array<[string, Record<string, unknown>, string?]>): CompileLeaf[] {
  return items.map(([family, parameters, fragment], index) => {
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: index * 10, end_byte: index * 10 + 5, ...(fragment ? { fragment } : {}) };
  });
}

function mechanicsOf(list: CompileLeaf[]) {
  const result = compileLeaves(list);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Record<string, unknown>;
}

/** Leaves on their own wording in `text`, in order, all in one fragment. */
function placed(text: string, fragment: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment };
  });
}

const heal = (): [string, Record<string, unknown>] => ["regain-wounds", { subject: "this-unit", amount: "D3" }];

describe("Round 5C family extensions, eleventh round", () => {
  it("drops \"in any phase\" as a gate, but keeps a named turn", () => {
    const any = mechanicsOf(leaves(["phase-window", { phase: "any", turn: "either" }], heal()));
    expect(JSON.stringify(any)).not.toContain("phase-is");
    expect(any).toEqual(mechanicsOf(leaves(heal())));
    const yours = JSON.stringify(mechanicsOf(leaves(["phase-window", { phase: "any", turn: "your" }], heal())));
    expect(yours).toContain('"player-turn-is"');
    expect(yours).not.toContain("phase-is");
  });

  it("counts twice per battle as two uses a battle", () => {
    const usage = mechanicsOf(leaves(["usage-limit", { frequency: "twice-per-battle", per: "unit" }], heal())).usage;
    expect(usage).toEqual({ frequency: "n-per-battle", count: 2, per: "unit" });
  });

  it("reads \"whose attacks have been resolved this phase\" as the attacks-resolved history, not being selected", () => {
    const text = JSON.stringify(mechanicsOf(leaves(["unit-activity", { activities: ["resolved-attacks-this-phase"], subject: "this-unit", negated: false }], heal())));
    expect(text).toContain('"event":"attacks-resolved"');
    expect(text).toContain('"window":"phase"');
    expect(text).not.toContain('"to":"shoot"');
  });

  it("lets a binding alone be a Stratagem's TARGET, and still refuses two bindings", () => {
    const bound = (to: string) => leaves(["target-binding", { bound_to: to }, "TARGET"])[0]!;
    expect(targetRestrictions([bound("attacked-unit")], [])).toEqual({ count: "one", selects: "unit", bound_to: "attacked-unit" });
    expect(() => targetRestrictions([bound("attacked-unit"), bound("triggering-unit")], [])).toThrow(/bound to more than one unit/u);
  });

  it("reads engaged at an earlier point only for states the DSL can read then", () => {
    expect(normalizeFingerprintParameters("unit-state", { states: ["engaged"], subject: "event-subject", with: "this-unit", at: "phase-start", negated: false }, currentFamilyVersion("unit-state")))
      .toMatchObject({ at: "phase-start" });
    expect(() => normalizeFingerprintParameters("unit-state", { states: ["below-starting-strength"], subject: "this-unit", at: "turn-start", negated: false }, currentFamilyVersion("unit-state")))
      .toThrow(/at reads only/u);
  });
});

describe("leading-unit from the led unit's side", () => {
  it("says this unit is led by a Leader with keywords, negates, and names a selected unit", () => {
    const text = (parameters: Record<string, unknown>) => JSON.stringify(mechanicsOf(leaves(["leading-unit", parameters], heal())));
    expect(text({ subject: "this-unit", attachment: "led", leader_keywords: ["FARSEER"] }))
      .toContain('{"type":"attachment","parameters":{"role":"led","with":{"all_of":["FARSEER"]}}}');
    expect(text({ subject: "this-model", attachment: "leading", negated: true })).toContain('"operator":"not"');
    expect(text({ subject: "selected-unit", attachment: "led" })).toContain('"subject":"selected-unit"');
    expect(() => normalizeFingerprintParameters("leading-unit", { subject: "this-model", attachment: "leading", leader_keywords: ["FARSEER"] }, currentFamilyVersion("leading-unit")))
      .toThrow(/attachment led/u);
  });
});

describe("objective range against one marker", () => {
  it("names a designated marker, and refuses a selected one when nothing selects a marker", () => {
    const designated = JSON.stringify(mechanicsOf(leaves(["unit-position", { kind: "objective-range", controlled_by: "any", subject: "this-unit", negated: false, objective: "designated", objective_tag: "acquisition" }], heal())));
    expect(designated).toContain('"of":{"objective":{"designated":"acquisition"}}');
    const unselected = compileLeaves(leaves(["unit-position", { kind: "objective-range", controlled_by: "any", subject: "this-unit", negated: false, objective: "selected" }], heal()));
    expect(unselected.ok ? "" : unselected.errors.join()).toMatch(/selects no objective marker/u);
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "objective-range", controlled_by: "any", subject: "this-unit", negated: false, objective: "designated", objective_tag: "not-a-tag" }, currentFamilyVersion("unit-position")))
      .toThrow(/not a registered designation/u);
  });
});

describe("designations each rule prints", () => {
  it("tags a unit with the rule's own designation, and labels it as printed", () => {
    const text = JSON.stringify(mechanicsOf(leaves(["apply-mark", { subject: "this-unit", tag: "wracked-with-agonies" }])));
    expect(text).toContain('"type":"designate"');
    expect(text).toContain('"tag":"wracked-with-agonies"');
    expect(designationLabel("infested-with-snotlings")).toBe("infested with Snotlings");
    expect(designationLabel("vendetta-target")).toBe("a Vendetta target");
    expect(designationLabel("victim", true)).toBe("victims");
    expect(() => normalizeFingerprintParameters("apply-mark", { subject: "this-unit", tag: "wracked" }, currentFamilyVersion("apply-mark"))).toThrow(/not a registered designation/u);
    // Version 1's schema is frozen at the registry it was reviewed with; growing the registry must not drift it.
    expect(() => normalizeFingerprintParameters("apply-mark", { subject: "this-unit", tag: "wracked-with-agonies" }, 1)).toThrow();
    expect(normalizeFingerprintParameters("apply-mark", { subject: "this-unit", tag: { source: "wracked with agonies" } }, currentFamilyVersion("apply-mark")))
      .toEqual({ subject: "this-unit", tag: { source: "wracked with agonies" } });
  });
});

describe("a unit-filter before moments joined by \"or\"", () => {
  const triggersOf = (text: string, between: string) => {
    const when = `when a friendly WALKER unit is **selected to move**${between}**declares a charge**.`;
    const leaves = placed(when, "WHEN",
      ["a friendly WALKER unit", "unit-filter", { side: "friendly", keywords: ["WALKER"] }],
      ["is **selected to move", "event", { kind: "selected", to: "move" }],
      ["**declares a charge", "event", { kind: "targets-selected", action_kind: "charge" }]);
    const version = currentFamilyVersion("regain-wounds");
    const end = Buffer.byteLength(when);
    const heal: CompileLeaf = { role: familyRole("regain-wounds", version), family_id: "regain-wounds", family_version: version, parameters: { subject: "this-unit", amount: "D3" }, start_byte: end + 1, end_byte: end + 2, fragment: "EFFECT" };
    const result = compileLeaves([...leaves, heal], `${when} ${text}`);
    if (!result.ok) throw new Error(result.errors.join("; "));
    return (result.mechanics as { trigger: Array<{ subject?: unknown }> }).trigger;
  };

  it("gives the alternative moment the same unit", () => {
    const [move, charge] = triggersOf("x", "** or **");
    expect(charge!.subject).toEqual(move!.subject);
    expect(JSON.stringify(charge!.subject)).toContain("WALKER");
  });

  it("leaves a moment joined by other words to its own unit", () => {
    const [, charge] = triggersOf("x", "**, then later **");
    expect(JSON.stringify(charge!.subject ?? null)).not.toContain("WALKER");
  });
});

describe("a bare \"each\" before a unit-filter", () => {
  const compiled = (text: string, ...items: Array<[string, string, Record<string, unknown>]>) => {
    const result = compileLeaves(placed(text, "RAW_TEXT", ...items), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    return result.mechanics as { effect: Record<string, unknown> };
  };

  it("rolls once per unit in range, and \"that enemy unit\" is each pass's unit", () => {
    const text = "At the end of the Fight phase, roll one D6 for each enemy unit within 6\" of this model: on a 4+, that enemy unit suffers D3 mortal wounds.";
    const { effect } = compiled(text,
      ["At the end of the Fight phase", "event", { kind: "phase-end", phase: "fight", turn: "either" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["for each", "for-each-unit-select", {}],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["on a 4+", "roll-result", { from: 4 }],
      ["that enemy unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "that-unit", count: "D3" }]);
    expect(effect.type).toBe("for-each-unit");
    expect(effect.selector).toEqual({ owner: "enemy", within_inches: 6 });
    expect(JSON.stringify(effect.effect)).toContain('"type":"mortal-wounds","target":"recipient"');
  });

  it("takes the units engaged with this unit, and their test and its modifier are theirs", () => {
    const text = "Each enemy MONSTER unit engaged with your unit makes a Battle-shock roll, with -1 to that Battle-shock roll.";
    const { effect } = compiled(text,
      ["Each", "for-each-unit-select", {}],
      ["enemy MONSTER unit", "unit-filter", { side: "enemy", keywords: ["MONSTER"] }],
      ["engaged with your unit", "unit-state", { states: ["engaged"], subject: "antecedent", with: "this-unit", negated: false }],
      ["makes a Battle-shock roll", "test", { target: "antecedent", test: "battle-shock" }],
      ["with -1 to that Battle-shock roll", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 1 }]);
    expect(effect.selector).toEqual({ owner: "enemy", keywords: ["MONSTER"], engagement_relation: "engaged-with-bearer", reference: "bearer-unit" });
    expect(effect.effect).toEqual({ type: "test", target: "recipient", modifier: { test: "battle-shock", modifier: -1 } });
  });

  it("refuses a bare \"each\" with no unit-filter after it", () => {
    const text = "Each time, this unit suffers 1 mortal wound.";
    const result = compileLeaves(placed(text, "RAW_TEXT", ["Each", "for-each-unit-select", {}], ["this unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }]), text);
    expect(result.ok ? "" : result.errors.join()).toMatch(/needs a unit-filter right after it/u);
  });
});

describe("a change to a test another unit takes", () => {
  it("is that unit's roll, past a condition on the change", () => {
    const text = "While an enemy unit is within 6\" of this model, it must take a Desperate Escape test. If that enemy unit is Battle-shocked, subtract 1 from that test.";
    const result = compileLeaves(placed(text, "RAW_TEXT",
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["it must take a Desperate Escape test", "test", { target: "antecedent", test: "desperate-escape" }],
      ["that enemy unit is Battle-shocked", "unit-state", { states: ["battle-shocked"], subject: "antecedent", negated: false }],
      ["subtract 1 from that test", "roll-modifier", { roll: "preceding", operation: "subtract", value: 1 }]), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(JSON.stringify(result.mechanics)).toContain('"type":"roll-modifier","target":"recipient","modifier":{"roll":"desperate-escape"');
  });
});

describe("a condition on each unit a filter names", () => {
  it("gates the effect per recipient, and only its own sentence", () => {
    const text = "If a friendly GRAVIS unit is within range of an objective, that unit's melee attacks have +1 A. This unit has +1 Move.";
    const result = compileLeaves(placed(text, "RAW_TEXT",
      ["friendly GRAVIS unit", "unit-filter", { side: "friendly", keywords: ["GRAVIS"] }],
      ["within range of an objective", "unit-position", { kind: "objective-range", controlled_by: "any", subject: "antecedent", negated: false }],
      ["that unit's melee attacks have", "weapon-property-scope", { subject: "antecedent", weapon_type: "melee" }],
      ["+1 A", "characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1 }],
      ["This unit has +1 Move", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: 1 }]), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const steps = (result.mechanics as { effect: { steps: Array<Record<string, unknown>> } }).effect.steps;
    expect(steps[0]).toMatchObject({ type: "conditional", condition: { type: "within", parameters: { subject: "recipient" } }, effect: { target: { owner: "friendly", all_of: ["GRAVIS"] } } });
    expect(steps[1]).toMatchObject({ type: "stat-modifier", target: "this-unit" });
  });
});

describe("wave-4 review fixes", () => {
  const ok = (result: ReturnType<typeof compileLeaves>) => {
    if (!result.ok) throw new Error(result.errors.join("; "));
    return result as Extract<typeof result, { ok: true }>;
  };
  const stratagem = (when: string, target: string, effect: string) => ({ when, target, effect, text: `${when}\n${target}\n${effect}` });
  const across = (s: ReturnType<typeof stratagem>, when: Array<[string, string, Record<string, unknown>]>, target: Array<[string, string, Record<string, unknown>]>, effect: Array<[string, string, Record<string, unknown>]>) => {
    const shift = (leaves: CompileLeaf[], by: number) => leaves.map((leaf) => ({ ...leaf, start_byte: leaf.start_byte + by, end_byte: leaf.end_byte + by }));
    const t = Buffer.byteLength(s.when) + 1;
    const e = t + Buffer.byteLength(s.target) + 1;
    return [...placed(s.when, "WHEN", ...when), ...shift(placed(s.target, "TARGET", ...target), t), ...shift(placed(s.effect, "EFFECT", ...effect), e)];
  };

  it("keeps the Stratagem unit's keywords off an enemy that moves, and binds the WHEN clause to that enemy", () => {
    const s = stratagem("Your opponent's Movement phase, when an enemy unit ends a move within 8\" of a friendly HAVOCS unit.", "That HAVOCS unit.", "Your unit can make a Normal move of up to D6\".");
    const { mechanics } = ok(compileLeaves(across(s,
      [["Your opponent's Movement phase", "use-window", { your_phases: [], opponent_phases: ["movement"], either_phases: [] }],
        ["enemy unit", "unit-filter", { side: "enemy" }],
        ["ends a move", "event", { kind: "move-ended", owner: "enemy" }],
        ["within 8\" of a", "unit-position", { kind: "within", inches: 8, of: "following-filter", subject: "antecedent", negated: false }],
        ["friendly HAVOCS unit", "unit-filter", { side: "friendly", keywords: ["HAVOCS"] }]],
      [["That HAVOCS unit", "triggering-target", { selects: "unit", keywords: ["HAVOCS"], match: "all" }]],
      [["Your unit can make a Normal move of up to D6", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }]]), s.text)) as { mechanics: Record<string, any> };
    expect(mechanics.trigger.subject).toEqual({ owner: "enemy" });
    expect(mechanics.trigger.condition).toEqual({ type: "has-keyword", parameters: { all_of: ["HAVOCS"] } });
    expect(mechanics.effect.condition.parameters.subject).toBe("event-subject");
  });

  it("makes -1 to the hazard rolls of Desperate Escape part of the escaping unit's test", () => {
    const text = "When an enemy unit is selected to Fall Back, that enemy unit must use the desperate escape mode, with -1 to those hazard rolls.";
    const { mechanics } = ok(compileLeaves(placed(text, "RAW_TEXT",
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["is selected to Fall Back", "event", { kind: "selected", move_types: ["fall-back"], to: "move" }],
      ["that enemy unit must use the desperate escape mode", "test", { target: "event-subject", test: "desperate-escape" }],
      ["with -1 to those hazard rolls", "roll-modifier", { roll: "hazard", operation: "subtract", value: 1 }]), text));
    expect(JSON.stringify(mechanics)).toContain('{"type":"test","target":"event-subject","modifier":{"test":"desperate-escape","modifier":-1}}');
  });

  it("takes the units engaged with this unit into an already scoped \"each\"", () => {
    const text = "Each enemy unit within Engagement Range of your unit must take a Battle-shock test.";
    const { mechanics } = ok(compileLeaves(placed(text, "RAW_TEXT",
      ["Each enemy unit", "for-each-unit-select", { scope: "enemy", distance: "any" }],
      ["within Engagement Range of your unit", "unit-state", { states: ["engaged"], subject: "antecedent", with: "this-unit", negated: false }],
      ["must take a Battle-shock test", "test", { target: "recipient", test: "battle-shock" }]), text)) as { mechanics: Record<string, any> };
    expect(mechanics.effect).toEqual({ type: "for-each-unit", selector: { owner: "enemy", engagement_relation: "engaged-with-bearer", reference: "bearer-unit" }, effect: { type: "test", target: "recipient", modifier: { test: "battle-shock" } } });
  });

  it("reads \"Or:\" between two effects of one kind as the player's choice of one", () => {
    const text = "This unit's attacks can re-roll Hit rolls of 1. Or: if the target is a MONSTER, re-roll Hit rolls.";
    const { mechanics } = ok(compileLeaves(placed(text, "RAW_TEXT",
      ["re-roll Hit rolls of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }],
      ["Or:", "instead", { choice: true }],
      ["the target is a MONSTER", "unit-keyword", { keywords: ["MONSTER"], subject: "target", negated: false }],
      ["re-roll Hit rolls", "reroll", { roll: "hit", subset: "all", weapon_type: "all" }]), text)) as { mechanics: Record<string, any> };
    expect(mechanics.effect.type).toBe("choice");
    expect(mechanics.effect.options[1].type).toBe("conditional");
    expect(mechanics.effect.options[0]).toMatchObject({ type: "re-roll", modifier: { subset: "ones" } });
  });
});

describe("wave-4 rulings", () => {
  it("sets a list of characteristics in one leaf", () => {
    const text = JSON.stringify(mechanicsOf(leaves(["characteristic-set", { subject: "this-model", values: [{ characteristic: "M", value: 7 }, { characteristic: "Sv", value: 3 }] }])));
    expect(text).toContain('{"type":"stat-modifier","target":"this-model","modifier":{"stat":"M","operation":"set","value":7}}');
    expect(text).toContain('"stat":"Sv","operation":"set","value":3');
    expect(() => normalizeFingerprintParameters("characteristic-set", { subject: "this-model", values: [{ characteristic: "M", value: 7 }] }, currentFamilyVersion("characteristic-set"))).toThrow(/two or more/u);
  });

  it("fires at either end of a move from one leaf", () => {
    const mechanics = mechanicsOf(leaves(["event", { kind: "move-started", subject: "this-unit", also: "move-ended" }], heal()));
    expect((mechanics.trigger as Array<{ event: string }>).map((moment) => moment.event)).toEqual(["move-started", "move-ended"]);
    expect(() => normalizeFingerprintParameters("event", { kind: "move-ended", also: "move-ended" }, currentFamilyVersion("event"))).toThrow(/other end/u);
  });
});

describe("rolls that belong to another unit", () => {
  it("puts a roll change on the unit an earlier moment names, and a re-roll on the aura's recipient", () => {
    const moved = JSON.stringify(mechanicsOf(leaves(
      ["event", { kind: "move-ended", subject: "this-unit" }],
      ["roll-modifier", { roll: "charge", operation: "add", value: 1, subject: "antecedent" }])));
    expect(moved).toContain('{"type":"roll-modifier","target":"event-subject","modifier":{"roll":"charge","operation":"add","value":1}}');
    const own = JSON.stringify(mechanicsOf(leaves(["roll-modifier", { roll: "charge", operation: "add", value: 1 }])));
    expect(own).toContain('"target":"this-unit"');
    expect(() => normalizeFingerprintParameters("reroll", { roll: "charge", subset: "all", weapon_type: "all", subject: "enemy" }, currentFamilyVersion("reroll"))).toThrow(/reroll.subject/u);
  });
});

describe("selections narrowed by the attacks that hit them", () => {
  const compiled = (text: string, ...items: Array<[string, string, Record<string, unknown>]>) => {
    const result = compileLeaves(placed(text, "RAW_TEXT", ...items), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    return JSON.stringify(result.mechanics);
  };

  it("folds a weapon named after \"hit by those attacks\" into the hit, and binds \"a unit is\" to the effect's unit", () => {
    const text = "After this model has shot, select one enemy unit hit by those attacks made with its Glimmer Lance. That unit is dazed. While a unit is dazed, subtract 1 from its Move characteristic.";
    const out = compiled(text,
      ["After this model has shot", "event", { kind: "after-shooting" }],
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["hit by those attacks", "hit-by-attacks", { subject: "selected-unit" }],
      ["made with its Glimmer Lance", "attack-filter", { weapon_name: "Glimmer Lance" }],
      ["That unit is dazed", "apply-mark", { subject: "antecedent", tag: "slowed" }],
      ["While a unit is dazed", "designated-filter", { tag: "slowed" }],
      ["subtract 1 from its Move characteristic", "characteristic-modifier", { subject: "antecedent", characteristics: ["M"], operation: "subtract", value: 1, weapon_type: "all" }]);
    expect(out).toContain('"filter":{"roll":"hit","result":"success","weapon_name":"Glimmer Lance"}');
    expect(out).not.toContain('"attack-is"');
    expect(out).toContain('{"type":"designated","parameters":{"subject":"selected-unit","tag":"slowed"}}');
  });

  it("keeps a weapon filter that does not follow a hit as a gate", () => {
    const text = "Each time this model makes an attack made with its Glimmer Lance, add 1 to the Hit roll.";
    const out = compiled(text,
      ["makes an attack", "attack", { direction: "makes", unit: "this-model", attack_type: "any" }],
      ["made with its Glimmer Lance", "attack-filter", { weapon_name: "Glimmer Lance" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    expect(out).toContain('{"type":"attack-is","parameters":{"weapon_name":"Glimmer Lance"}}');
  });

  it("gives a designated unit's selection its hit eligibility, and limits the changed attacks inside the designation", () => {
    const text = "After this unit has shot, select one enemy unit hit by those ranged attacks. Ranged attacks that target that unit have +1 to Hit rolls.";
    const out = compiled(text,
      ["After this unit has shot", "event", { kind: "after-shooting" }],
      ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["hit by those", "hit-by-attacks", { subject: "antecedent" }],
      ["ranged attacks", "attack-filter", { attack_type: "ranged" }],
      ["Ranged attacks", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "ranged" }],
      ["that target that unit", "target-is-selected", {}],
      ["have +1 to Hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]);
    expect(out).toMatch(/"select":\{"scope":"enemy-unit","count":1,"eligibility":\{"type":"happened".*"attack_type":"ranged"/u);
    expect(out).toMatch(/"applies":\{"to":"attackers-of-target","effect":\{"type":"conditional","condition":\{"type":"attack-is"/u);
    expect(out.startsWith('{"effect":{"type":"designate-target"')).toBe(true);
  });

  it("binds \"while a unit is\" to the target of the attacks it changes", () => {
    const text = "While a unit is dazed, ranged attacks that target that unit can re-roll Hit rolls of 1.";
    const out = compiled(text,
      ["While a unit is dazed", "designated-filter", { tag: "slowed" }],
      ["ranged attacks that target that unit", "attack", { direction: "targeted", unit: "that-unit", attack_type: "ranged" }],
      ["can re-roll Hit rolls of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }]);
    expect(out).toContain('{"type":"designated","parameters":{"subject":"defender","tag":"slowed"}}');
  });
});

describe("hidden units, a bearer's Transport and floored characteristics", () => {
  it("reads hidden as the core state and keeps the other states it lists", () => {
    const out = JSON.stringify(mechanicsOf(leaves(["unit-state", { states: ["hidden"], subject: "this-unit", negated: false }], heal())));
    expect(out).toContain('{"type":"unit-state","parameters":{"state":"hidden"}}');
    expect(out).not.toContain('"designated"');
    expect(normalizeFingerprintParameters("unit-state", { states: ["engaged", "hidden"], subject: "this-unit", negated: false }, currentFamilyVersion("unit-state")).states).toEqual(["engaged", "hidden"]);
    expect(() => normalizeFingerprintParameters("unit-state", { states: ["hidden"], subject: "this-unit", negated: false, at: "phase-start" }, currentFamilyVersion("unit-state"))).toThrow(/hidden/u);
    expect(() => normalizeFingerprintParameters("unit-state", { states: ["hidden"], subject: "this-unit", negated: false, with: "this-unit" }, currentFamilyVersion("unit-state"))).toThrow();
  });

  it("names the Transport this model is embarked within", () => {
    const out = JSON.stringify(mechanicsOf(leaves(["unit-state", { states: ["on-battlefield"], subject: "bearer-transport", negated: false }], heal())));
    expect(out).toContain('{"type":"unit-state","parameters":{"subject":"bearer-transport","state":"on-battlefield"}}');
  });

  it("floors a lowered characteristic, and refuses a floor on a raise", () => {
    const out = JSON.stringify(mechanicsOf(leaves(["characteristic-modifier", { subject: "this-unit", characteristics: ["OC"], operation: "subtract", value: 1, weapon_type: "all", minimum: 1 }])));
    expect(out).toContain('"modifier":{"stat":"OC","operation":"subtract","value":1,"minimum":1}');
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { subject: "this-unit", characteristics: ["OC"], operation: "add", value: 1, weapon_type: "all", minimum: 1 }, currentFamilyVersion("characteristic-modifier"))).toThrow(/minimum/u);
  });
});

describe("wave-5 review fixes", () => {
  const compiled = (text: string, fragment: string, ...items: Array<[string, string, Record<string, unknown>]>) => {
    const result = compileLeaves(placed(text, fragment, ...items), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    return result;
  };

  it("takes a test with a conditional change as two tests, one per side of the condition", () => {
    const text = "When an enemy unit Falls Back, that unit must take a Desperate Escape test; if that unit is Battle-shocked, subtract 1 from that test.";
    const out = JSON.stringify(compiled(text, "RAW_TEXT",
      ["When an enemy unit Falls Back", "event", { kind: "move-started", move_types: ["fall-back"] }],
      ["that unit must take a Desperate Escape test", "test", { target: "event-subject", test: "desperate-escape" }],
      ["if that unit is Battle-shocked", "unit-state", { states: ["battle-shocked"], subject: "event-subject", negated: false }],
      ["subtract 1 from that test", "roll-modifier", { roll: "desperate-escape", operation: "subtract", value: 1 }]).mechanics);
    expect(out).toContain('"effect":{"type":"test","target":"event-subject","modifier":{"test":"desperate-escape","modifier":-1}}');
    expect(out).toContain('{"type":"conditional","condition":{"operator":"not","operands":[{"type":"unit-state","parameters":{"subject":"event-subject","state":"battle-shocked"}}]},"effect":{"type":"test","target":"event-subject","modifier":{"test":"desperate-escape"}}}');
    expect(out).not.toContain('"roll-modifier"');
  });

  it("limits only the part a \"first time\" opens", () => {
    const text = "Add 1 to this unit's Move characteristic. The first time this unit destroys an enemy unit, add 1 to this unit's Leadership characteristic.";
    const mechanics = compiled(text, "RAW_TEXT",
      ["Add 1 to this unit's Move characteristic", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: 1, weapon_type: "all" }],
      ["The first time", "usage-limit", { frequency: "first-this-battle", per: "model" }],
      ["this unit destroys an", "event", { kind: "unit-destroyed", by: "this-unit" }],
      ["add 1 to this unit's Leadership characteristic", "characteristic-modifier", { subject: "this-unit", characteristics: ["Ld"], operation: "add", value: 1, weapon_type: "all" }]).mechanics as Record<string, unknown>;
    expect(mechanics.usage).toBeUndefined();
    expect(JSON.stringify(mechanics.effect)).toMatch(/"type":"ability-part".*"usage":\{"frequency":"first-this-battle"/u);
  });

  it("reads a Stratagem target's own state as the candidate's", () => {
    const text = "One unit from your army that is within Engagement Range of one or more enemy units. Add 1 to this unit's Leadership characteristic.";
    const leaves = [
      ...placed(text, "TARGET",
        ["One", "stratagem-target", { count: "one" }],
        ["unit from your army", "unit-filter", { side: "friendly" }],
        ["within Engagement Range of one or more enemy units", "unit-state", { states: ["engaged"], subject: "target", negated: false }]),
      ...placed(text, "EFFECT", ["Add 1 to this unit's Leadership characteristic", "characteristic-modifier", { subject: "this-unit", characteristics: ["Ld"], operation: "add", value: 1, weapon_type: "all" }]),
    ];
    const result = compileLeaves(leaves, text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const eligibility = JSON.stringify(result.core);
    expect(eligibility).toContain('{"type":"unit-state","parameters":{"state":"engaged"}}');
    expect(eligibility).not.toContain('"defender"');
  });

  it("gates each unit an aura reaches inside the aura", () => {
    const text = "If an enemy unit within 8\" of this unit is below Starting Strength, that enemy unit must take a Battle-shock test.";
    const out = JSON.stringify(compiled(text, "RAW_TEXT",
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within 8\" of this unit", "aura-range", { inches: 8, of: "this-unit" }],
      ["below Starting Strength", "unit-state", { states: ["below-starting-strength"], subject: "antecedent", negated: false }],
      ["that enemy unit must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }]).mechanics);
    expect(out).toMatch(/^\{"effect":\{"type":"aura".*"effect":\{"type":"conditional","condition":\{"type":"strength","parameters":\{"subject":"recipient"/u);
  });
});

describe("moments done to this unit or model", () => {
  it("fires when a friendly Stratagem targets the bearer, and when an attack is allocated to it", () => {
    const targeted = JSON.stringify(mechanicsOf(leaves(["event", { kind: "targets-selected", owner: "friendly", action_kind: "stratagem", object: "this-model" }], heal())));
    expect(targeted).toContain('"trigger":{"event":"targets-selected","subject":{"owner":"friendly"},"filter":{"kind":"stratagem"},"object":"this-model"}');
    const allocated = JSON.stringify(mechanicsOf(leaves(["event", { kind: "damage-allocated", object: "this-model" }], heal())));
    expect(allocated).toContain('"trigger":{"event":"damage-allocated","object":"this-model"}');
    expect(() => normalizeFingerprintParameters("event", { kind: "move-ended", object: "this-model" }, currentFamilyVersion("event"))).toThrow(/event.object/u);
  });
});

describe("a parenthesised alternative", () => {
  it("joins two conditions with \"(or\" as either", () => {
    const text = "If this model is on the battlefield (or any TRANSPORT it is embarked within is on the battlefield), add 1 to this unit's Leadership characteristic.";
    const result = compileLeaves(placed(text, "RAW_TEXT",
      ["this model is on the battlefield", "unit-state", { states: ["on-battlefield"], subject: "this-model", negated: false }],
      ["any TRANSPORT it is embarked within is on the battlefield", "unit-state", { states: ["on-battlefield"], subject: "bearer-transport", negated: false }],
      ["add 1 to this unit's Leadership characteristic", "characteristic-modifier", { subject: "this-unit", characteristics: ["Ld"], operation: "add", value: 1, weapon_type: "all" }]), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(JSON.stringify(result.mechanics)).toContain('"condition":{"operator":"or"');
  });
});

describe("a selection a persistent designation makes", () => {
  it("is made once, by the designation", () => {
    const text = "At the start of the battle, select one enemy unit to be this model's quarry. Each time this model makes an attack that targets its quarry, you can re-roll the Hit roll.";
    const result = compileLeaves(placed(text, "RAW_TEXT",
      ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["to be this model's quarry", "persistent-designation-open", { designation: "prey", scope: "enemy-unit", timing: "start-of-first-battle-round", beneficiary: "this-model" }],
      ["Each time this model makes an attack", "attack", { direction: "makes", unit: "this-model", attack_type: "any" }],
      ["that targets its quarry", "designated-filter", { subject: "defender", tag: "prey" }],
      ["you can re-roll the Hit roll", "reroll", { roll: "hit", subset: "all", weapon_type: "all" }]), text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const out = JSON.stringify(result.mechanics);
    expect(out).toContain('"type":"persistent-designation"');
    expect(out).not.toContain('"select-units"');
  });
});

describe("more of a unit's history", () => {
  it("reads each new activity as its own event and window", () => {
    const of = (activity: string) => JSON.stringify(mechanicsOf(leaves(["unit-activity", { activities: [activity], subject: "this-unit", negated: false }], heal())));
    expect(of("fell-back-this-phase")).toContain('"event":"move-ended","filter":{"move_types":["fall-back"]},"window":"phase"');
    expect(of("made-normal-move-this-turn")).toContain('"filter":{"move_types":["normal"]},"window":"turn"');
    expect(of("destroyed-enemy-model-this-phase")).toContain('{"event":"model-destroyed","object":{"owner":"enemy","level":"model"},"filter":{"by":"this-unit"},"window":"phase"}');
    expect(of("lost-models-this-phase")).toContain('{"event":"model-destroyed","object":"model-in-this-unit","window":"phase"}');
  });
});

describe("an instead of another rule's default", () => {
  const consolidate = (text: string) => compileLeaves(placed(text, "RAW_TEXT",
    ["Each time this unit Consolidates", "event", { kind: "move-ended", move_types: ["consolidation"] }],
    ["it can move up to 6\"", "make-move", { subject: "this-unit", move: "consolidation", distance: 6 }],
    ["instead", "instead", {}]), text);

  it("stands alone when the replaced value is printed after \"instead of\"", () => {
    const result = consolidate("Each time this unit Consolidates, it can move up to 6\" instead of up to 3\".");
    expect(result.ok).toBe(true);
  });

  it("still refuses a bare instead with nothing to replace", () => {
    const result = consolidate("Each time this unit Consolidates, it can move up to 6\" instead.");
    expect(result.ok).toBe(false);
  });
});
