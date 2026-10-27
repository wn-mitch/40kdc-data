import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { CompileError } from "../src/semantic-authoring/compile-fragments.js";
import { dslUnitFilter, foldUnitFilters, mergeStackedFilters } from "../src/semantic-authoring/compile-unit-filters.js";
import { describeCondition } from "../src/translate/condition.js";

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

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(list: CompileLeaf[], text: string): string {
  const result = compileLeaves(list, text);
  if (result.ok) throw new Error("expected a refusal, but the leaves compiled");
  return result.errors.join("; ");
}

const ENGAGED_WITH_EARLIER = { states: ["engaged"], subject: "antecedent", negated: false, with: "antecedent" };
const SELECT_ENEMY = ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }] as const;

describe("Semantic authoring engaged-with-that-unit binding (SS2)", () => {
  it("refuses a state whose subject and named unit resolve to the same unit (a moment's unit)", () => {
    const text = "When an enemy unit falls back, it is engaged with it.";
    const message = errorsOf(placed(text,
      ["When an enemy unit falls back", "event", { kind: "move-ended", owner: "enemy", move_types: ["fall-back"] }],
      ["it is engaged with it", "unit-state", ENGAGED_WITH_EARLIER]), text);
    expect(message).toMatch(/same unit as its subject \(event-subject\)/);
  });

  it("refuses a state that engages the selected unit with itself", () => {
    const text = "Select one friendly unit. It is engaged with it.";
    const message = errorsOf(placed(text,
      ["Select one friendly unit", "select-unit", { scope: "friendly", distance: "any", visible: false }],
      ["It is engaged with it", "unit-state", ENGAGED_WITH_EARLIER]), text);
    expect(message).toMatch(/same unit as its subject \(selected-unit\)/);
  });

  it("refuses a Stratagem target engaged with itself", () => {
    const text = "One ALPHA unit. It is engaged with it.";
    const message = errorsOf(placed(text,
      ["One", "stratagem-target", { count: "one" }],
      ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["It is engaged with it", "unit-state", ENGAGED_WITH_EARLIER]), text);
    expect(message).toMatch(/same unit as its subject/);
  });

  it("refuses a state whose named unit is the filter's own unit (the enemy filter names both)", () => {
    const text = "An enemy unit. It is engaged with it.";
    const message = errorsOf(placed(text,
      ["An enemy unit", "unit-filter", { side: "enemy" }],
      ["It is engaged with it", "unit-state", ENGAGED_WITH_EARLIER]), text);
    expect(message).toMatch(/same unit as its subject/);
  });

  it("refuses a named unit introduced in an earlier sentence that carries an effect", () => {
    // A sentence without an effect joins the next one (compile-placement.ts), so the introducing
    // sentence and the state's sentence each carry their own effect here.
    const text = "Select one friendly unit and add 1 to the Hit roll for it. If a unit engaged with it, add 1 to the Wound roll for this unit.";
    const message = errorsOf(placed(text,
      ["Select one friendly unit", "select-unit", { scope: "friendly", distance: "any", visible: false }],
      ["add 1 to the Hit roll for it", "roll-modifier", { roll: "hit", operation: "add", value: 1, subject: "antecedent" }],
      ["engaged with it", "unit-state", { states: ["engaged"], subject: "this-unit", negated: false, with: "antecedent" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1, subject: "this-unit" }]), text);
    expect(message).toMatch(/introduced outside this sentence/);
  });
});

describe("Semantic authoring engaged-with-this-model selection (SS3)", () => {
  const text = "Select one enemy unit within Engagement Range of it. Add 1 to the Hit roll for that unit.";
  const effect = ["Add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1, subject: "antecedent" }] as const;

  it("names the model the selected unit is measured to", () => {
    const mechanics = mechanicsOf(placed(text, SELECT_ENEMY,
      ["within Engagement Range of it", "unit-state", { states: ["engaged"], subject: "selected-unit", negated: false, with: "this-model" }],
      [...effect]), text);
    expect(JSON.stringify(mechanics)).toContain('"engaged_with":"this-model"');
  });

  it("names the unit when the state says this unit", () => {
    const mechanics = mechanicsOf(placed(text, SELECT_ENEMY,
      ["within Engagement Range of it", "unit-state", { states: ["engaged"], subject: "selected-unit", negated: false, with: "this-unit" }],
      [...effect]), text);
    expect(JSON.stringify(mechanics)).toContain('"engaged_with":"this-unit"');
  });
});

describe("Semantic authoring engaged with a designated unit (SS5)", () => {
  const text = "One HERETIC ASTARTES unit is within Engagement Range of your focus of hatred. Add 1 to the Hit roll for that unit.";

  it("lowers the target's engagement with the designated enemy", () => {
    const mechanics = mechanicsOf(placed(text,
      ["One", "stratagem-target", { count: "one" }],
      ["HERETIC ASTARTES unit", "unit-filter", { side: "friendly", keywords: ["HERETIC ASTARTES"] }],
      ["is within Engagement Range of", "unit-state", { states: ["engaged"], subject: "target", negated: false, with: "following-filter" }],
      ["your focus of hatred", "unit-filter", { side: "enemy", designated: "focus-of-hatred" }],
      ["Add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1, subject: "this-unit" }]), text);
    expect(JSON.stringify(mechanics)).toContain('"engaged_with":{"owner":"enemy","designated":"focus-of-hatred"}');
  });

  it("retains a designation on a selection's unit filter", () => {
    const selection = "Select one enemy unit that is your focus of hatred. That unit suffers 1 mortal wound.";
    const mechanics = mechanicsOf(placed(selection,
      ["Select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["your focus of hatred", "unit-filter", { side: "enemy", designated: "focus-of-hatred" }],
      ["That unit suffers 1 mortal wound", "mortal-wounds", { recipient: "that-unit", count: "1" }]), selection);
    expect(mechanics.effect.selector.filter).toEqual({ owner: "enemy", designated: "focus-of-hatred" });
    expect(mechanics.effect.effect).toMatchObject({ type: "mortal-wounds", target: "selected-unit" });
  });
});

describe("Semantic authoring engaged with only the named units (SS1)", () => {
  const text = "While an enemy unit is only within Engagement Range of one or more FORTIFICATIONS from your army, add 1 to the Hit roll for this unit.";
  const enemyWhile = ["While an enemy unit", "unit-filter", { side: "enemy" }] as const;
  const exclusive = ["only", "engagement-exclusive", {}] as const;
  const engaged = ["within Engagement Range of one or more", "unit-state", { states: ["engaged"], subject: "antecedent", negated: false, with: "following-filter" }] as const;
  const fortifications = ["FORTIFICATIONS", "unit-filter", { side: "friendly", keywords: ["FORTIFICATIONS"] }] as const;
  const effect = ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1, subject: "this-unit" }] as const;

  it("folds the qualifier into a two-operand engagement: engaged with the named units, and with no other friendly unit", () => {
    const mechanics = mechanicsOf(placed(text, enemyWhile, exclusive, engaged, fortifications, effect), text);
    const condition = JSON.stringify(mechanics);
    expect(condition).toContain('"not_all_of":["FORTIFICATIONS"]');
    expect(condition).toContain('"all_of":["FORTIFICATIONS"]');
  });

  it("gives both operands the subject the state gets from the enemy filter", () => {
    const mechanics = mechanicsOf(placed(text, enemyWhile, exclusive, engaged, fortifications, effect), text);
    const subjects = [...JSON.stringify(mechanics).matchAll(/"type":"matches","parameters":\{"subject":(\{[^}]*\}),"filter":\{"engaged_with"/gu)].map((match) => match[1]);
    expect(subjects).toEqual(['{"owner":"enemy"}', '{"owner":"enemy"}']);
  });

  it("leaves the state plain without the qualifier (regression)", () => {
    const plain = placed(text, enemyWhile, engaged, fortifications, effect);
    const mechanics = mechanicsOf(plain, text);
    expect(JSON.stringify(mechanics)).not.toContain("not_all_of");
  });

  it("refuses the qualifier when no engaged state follows it in its clause", () => {
    const bare = "Only units are affected, and add 1 to the Hit roll for this unit.";
    const message = errorsOf(placed(bare, ["Only", "engagement-exclusive", {}], effect), bare);
    expect(message).toMatch(/no unit-state follows/);
  });

  it("refuses the qualifier when the state after it is negated", () => {
    const message = errorsOf(placed(text, enemyWhile, exclusive,
      ["within Engagement Range of one or more", "unit-state", { states: ["engaged"], subject: "antecedent", negated: true, with: "following-filter" }],
      fortifications, effect), text);
    expect(message).toMatch(/plain engaged-with-filter/);
  });

  it("refuses a qualifier whose following filter carries a state", () => {
    const message = errorsOf(placed(text, enemyWhile, exclusive, engaged,
      ["FORTIFICATIONS", "unit-filter", { side: "friendly", keywords: ["FORTIFICATIONS"], states: ["battle-shocked"] }], effect), text);
    expect(message).toMatch(/friendly unit-filter of keywords alone/);
  });

  it("refuses two qualifiers on one state", () => {
    const twice = "While an enemy unit is only, and only, within Engagement Range of one or more FORTIFICATIONS from your army, add 1 to the Hit roll for this unit.";
    const message = errorsOf(placed(twice, enemyWhile, exclusive, ["only", "engagement-exclusive", {}], engaged, fortifications, effect), twice);
    expect(message).toMatch(/Two engagement-exclusive leaves/);
  });
});

describe("Semantic authoring unit-position named as the Engagement Range (SS4)", () => {
  const text = "The bearer is within Engagement Range of one or more enemy PSYKER units that are Battle-shocked. Add 1 to the Hit roll.";
  const distance = ["The bearer is within Engagement Range of one or more", "unit-position", { kind: "within", range_ref: "engagement", of: "following-filter", subject: "this-model", negated: false }] as const;
  const psykers = ["enemy PSYKER units that are Battle-shocked", "unit-filter", { side: "enemy", keywords: ["PSYKER"], states: ["battle-shocked"] }] as const;
  const effect = ["Add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1, subject: "this-unit" }] as const;

  it("measures the bearer to the enemy units within the Engagement Range", () => {
    const mechanics = mechanicsOf(placed(text, distance, psykers, effect), text);
    expect(JSON.stringify(mechanics)).toContain('"range":"engagement"');
  });

  it("refuses a beyond distance, a matching-unit measure and a counts-as use of the Engagement Range", () => {
    const version = currentFamilyVersion("unit-position");
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "beyond", range_ref: "engagement", of: "this-unit", subject: "this-unit", negated: false }, version)).toThrow(/beyond/);
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "within", range_ref: "engagement", of: "matching-unit", of_side: "enemy", of_keywords: ["PSYKER"], subject: "this-unit", negated: false }, version)).toThrow(/matching-unit/);
    expect(() => normalizeFingerprintParameters("counts-as", { subject: "this-unit", range_ref: "engagement", of_side: "friendly" }, currentFamilyVersion("counts-as"))).toThrow();
  });

  it("keeps the named Synapse range as before", () => {
    expect(normalizeFingerprintParameters("unit-position", { kind: "within", range_ref: "synapse", of: "this-unit", subject: "this-unit", negated: false }, currentFamilyVersion("unit-position"))).toMatchObject({ range_ref: "synapse" });
  });
});

describe("Semantic authoring re-authored Charge-move selections (records 1400, 3058)", () => {
  // The base records wrote "within Engagement Range of it" as a state with the selected unit as its own
  // named unit (self-engagement). "it" is the moving unit or model, so each names that instead.
  const bodyUnit = (who: "this-unit" | "this-model") => {
    const text = `Each time ${who === "this-unit" ? "this unit" : "this model"} ends a Charge move, select one enemy unit within Engagement Range of it. That unit must take a Battle-shock test, subtracting 1 from that test.`;
    const leaves = placed(text,
      ["Each time", "event", { kind: "move-ended", move_types: ["charge"] }],
      ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["within Engagement Range of it", "unit-state", { states: ["engaged"], subject: "selected-unit", negated: false, with: who }],
      ["That unit must take a Battle-shock test", "test", { target: "selected-unit", test: "battle-shock" }],
      ["subtracting 1 from that test", "roll-modifier", { roll: "battle-shock", operation: "subtract", value: 1 }]);
    return { text, leaves };
  };

  it("compiles a Charge-move selection engaged with this unit", () => {
    const { text, leaves } = bodyUnit("this-unit");
    expect(JSON.stringify(mechanicsOf(leaves, text))).toContain('"engaged_with":"this-unit"');
  });

  it("compiles a Charge-move selection engaged with this model", () => {
    const { text, leaves } = bodyUnit("this-model");
    expect(JSON.stringify(mechanicsOf(leaves, text))).toContain('"engaged_with":"this-model"');
  });
});

{
  // Fabricated wording only. Engaged and hidden are unit-filter states (unit-filter@9); each test is
  // written so it fails on the code before the change, except the regression guards.

  /** Leaves placed on their own wording in `text`, normalized as the family registry reads them. */
  function placed(text: string, ...items: Array<[string, string, Record<string, unknown>, string?]>): CompileLeaf[] {
    const bytes = Buffer.from(text, "utf8");
    let from = 0;
    return items.map(([wording, family, parameters, fragment]) => {
      const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
      if (start < 0) throw new Error(`"${wording}" is not in the text`);
      from = start + Buffer.byteLength(wording, "utf8");
      const version = currentFamilyVersion(family);
      return {
        role: familyRole(family, version), family_id: family, family_version: version,
        parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from,
        ...(fragment !== undefined ? { fragment } : {}),
      };
    });
  }

  /** A filter leaf for the direct tests: the parameters as the family normalizes them. */
  const filterLeaf = (parameters: Record<string, unknown>): CompileLeaf => ({
    role: "CONDITION", family_id: "unit-filter", family_version: currentFamilyVersion("unit-filter"), parameters: normalizeFingerprintParameters("unit-filter", parameters, currentFamilyVersion("unit-filter")), start_byte: 0, end_byte: 1,
  });

  function nodes(tree: unknown, test: (node: Record<string, unknown>) => boolean): Array<Record<string, unknown>> {
    if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, test));
    if (tree === null || typeof tree !== "object") return [];
    const node = tree as Record<string, unknown>;
    return [...(test(node) ? [node] : []), ...Object.values(node).flatMap((value) => nodes(value, test))];
  }

  const FIGHT_WINDOW = { your_phases: [], opponent_phases: [], either_phases: ["fight"] };

  describe("unit-filter family: engaged and hidden", () => {
    it("accepts engaged and hidden at the current version, and the version before they were introduced still refuses them", () => {
      // The version that introduced engaged and hidden is pinned by number: later versions add to the chain above it.
      const INTRODUCED = 10;
      expect(currentFamilyVersion("unit-filter")).toBeGreaterThanOrEqual(INTRODUCED);
      expect(normalizeFingerprintParameters("unit-filter", { side: "friendly", states: ["engaged"] }, currentFamilyVersion("unit-filter"))).toEqual({ side: "friendly", states: ["engaged"] });
      expect(normalizeFingerprintParameters("unit-filter", { side: "friendly", states: ["hidden"] }, currentFamilyVersion("unit-filter"))).toEqual({ side: "friendly", states: ["hidden"] });
      expect(normalizeFingerprintParameters("unit-filter", { side: "friendly", states: ["engaged"] }, INTRODUCED)).toEqual({ side: "friendly", states: ["engaged"] });
      expect(() => normalizeFingerprintParameters("unit-filter", { side: "friendly", states: ["engaged"] }, INTRODUCED - 1)).toThrow();
      expect(() => normalizeFingerprintParameters("unit-filter", { side: "friendly", states: ["hidden"] }, INTRODUCED - 1)).toThrow();
    });

    it("normalizes an input with none of the new states exactly as the previous version does", () => {
      const input = { side: "friendly", keywords: ["ARMIGER"], states: ["battle-shocked", "unengaged"] };
      expect(normalizeFingerprintParameters("unit-filter", input, currentFamilyVersion("unit-filter"))).toEqual(normalizeFingerprintParameters("unit-filter", input, currentFamilyVersion("unit-filter") - 1));
    });

    it("refuses engaged with unengaged in one filter", () => {
      expect(() => normalizeFingerprintParameters("unit-filter", { side: "friendly", states: ["engaged", "unengaged"] }, currentFamilyVersion("unit-filter"))).toThrow(/both engaged and unengaged/);
    });

    it("refuses a state listed twice when the filter names an engaged or hidden state", () => {
      expect(() => normalizeFingerprintParameters("unit-filter", { side: "friendly", states: ["hidden", "hidden"] }, currentFamilyVersion("unit-filter"))).toThrow(/twice/);
    });
  });

  describe("dslUnitFilter: one positive state per filter", () => {
    it("emits engaged and hidden as the DSL state", () => {
      expect(dslUnitFilter(filterLeaf({ side: "friendly", states: ["engaged"] }))).toMatchObject({ owner: "friendly", state: "engaged" });
      expect(dslUnitFilter(filterLeaf({ side: "friendly", keywords: ["PHOBOS"], states: ["hidden"] }))).toMatchObject({ owner: "friendly", all_of: ["PHOBOS"], state: "hidden" });
    });

    it("keeps unengaged as a negation and battle-shocked as the state", () => {
      const unengaged = dslUnitFilter(filterLeaf({ side: "enemy", states: ["unengaged"] }));
      expect(unengaged).toMatchObject({ not_states: ["engaged"] });
      expect(unengaged).not.toHaveProperty("state");
      expect(dslUnitFilter(filterLeaf({ side: "friendly", states: ["battle-shocked"] }))).toMatchObject({ state: "battle-shocked" });
    });

    it("keeps battle-shocked with unengaged in one filter", () => {
      const both = dslUnitFilter(filterLeaf({ side: "friendly", states: ["battle-shocked", "unengaged"] }));
      expect(both).toMatchObject({ state: "battle-shocked", not_states: ["engaged"] });
    });

    it("refuses two positive states, and a positive state with a held unit", () => {
      expect(() => dslUnitFilter(filterLeaf({ side: "friendly", states: ["engaged", "battle-shocked"] }))).toThrow(CompileError);
      expect(() => dslUnitFilter(filterLeaf({ side: "friendly", states: ["hidden", "battle-shocked"] }))).toThrow(CompileError);
      expect(() => dslUnitFilter(filterLeaf({ side: "friendly", states: ["engaged"], held_in: "strategic-reserves" }))).toThrow(CompileError);
      // Merged filters skip the family's normalize, so the compiler refuses this pair on its own.
      const raw: CompileLeaf = { role: "CONDITION", family_id: "unit-filter", family_version: 9, parameters: { side: "friendly", states: ["engaged", "unengaged"] }, start_byte: 0, end_byte: 1 };
      expect(() => dslUnitFilter(raw)).toThrow(CompileError);
    });
  });

  describe("stacked filters: the merged filter holds one positive state", () => {
    const text = "Friendly ARMIGER units affected by this ability.";
    const stacked = (first: Record<string, unknown>, second: Record<string, unknown>) => placed(text,
      ["Friendly ARMIGER units", "unit-filter", first],
      ["affected by this ability", "unit-filter", second],
    );

    it("refuses engaged merged with unengaged, and engaged merged with battle-shocked", () => {
      expect(() => mergeStackedFilters(stacked({ side: "friendly", keywords: ["ARMIGER"], states: ["engaged"] }, { side: "friendly", states: ["unengaged"] }), text)).toThrow(/both engaged and unengaged/);
      expect(() => mergeStackedFilters(stacked({ side: "friendly", keywords: ["ARMIGER"], states: ["engaged"] }, { side: "friendly", states: ["battle-shocked"] }), text)).toThrow(/holds one state/);
    });

    it("merges battle-shocked with unengaged, as before", () => {
      const merged = mergeStackedFilters(stacked({ side: "friendly", keywords: ["ARMIGER"], states: ["battle-shocked"] }, { side: "friendly", states: ["unengaged"] }), text);
      expect(merged).toHaveLength(1);
      expect(merged[0]!.parameters).toMatchObject({ states: ["battle-shocked", "unengaged"] });
    });
  });

  describe("aura: state restrictions remain on the recipient filter", () => {
    it("preserves an aura's engaged or hidden restriction", () => {
      for (const state of ["engaged", "hidden"]) {
        const text = `Friendly ${state} ARMIGER unit within 6" of this unit has the Feel No Pain 6+ ability.`;
        const result = compileLeaves(placed(text,
          [`Friendly ${state} ARMIGER unit`, "unit-filter", { side: "friendly", keywords: ["ARMIGER"], states: [state] }],
          ["within 6\" of this unit", "aura-range", { inches: 6, of: "this-unit" }],
          ["has the Feel No Pain 6+ ability", "feel-no-pain", { subject: "this-unit", threshold: 6, against: "all" }],
        ), text);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.mechanics.effect).toMatchObject({ type: "aura", modifier: { eligible: { owner: "friendly", all_of: ["ARMIGER"], state } } });
      }
    });

    it("still compiles an aura whose filter is unengaged", () => {
      const text = "Friendly unengaged ARMIGER unit within 6\" of this unit has the Feel No Pain 6+ ability.";
      const result = compileLeaves(placed(text,
        ["Friendly unengaged ARMIGER unit", "unit-filter", { side: "friendly", keywords: ["ARMIGER"], states: ["unengaged"] }],
        ["within 6\" of this unit", "aura-range", { inches: 6, of: "this-unit" }],
        ["has the Feel No Pain 6+ ability", "feel-no-pain", { subject: "this-unit", threshold: 6, against: "all" }],
      ), text);
      expect(result.ok).toBe(true);
    });
  });

  describe("integration: where the filter sits", () => {
    it("a Stratagem target's filter state becomes the target's eligibility, with no separate unit-state leaf", () => {
      const text = "Fight phase. One friendly engaged PLAGUE MARINES unit. Your unit's melee attacks have [PRECISION].";
      const leaves = placed(text,
        ["Fight phase", "use-window", FIGHT_WINDOW],
        ["One", "stratagem-target", { count: "one" }],
        ["friendly engaged PLAGUE MARINES unit", "unit-filter", { side: "friendly", keywords: ["PLAGUE MARINES"], states: ["engaged"] }],
        ["Your unit's melee attacks have", "weapon-ability-grant", { subject: "this-unit", weapon_type: "melee" }],
        ["PRECISION", "weapon-ability-keyword", { keyword: "Precision" }],
      );
      const result = compileLeaves(leaves, text);
      if (!result.ok) throw new Error(result.errors.join("; "));
      const target = (result.core as { target_restrictions: Record<string, unknown> }).target_restrictions;
      expect(target).toMatchObject({ required_keywords: ["PLAGUE MARINES"] });
      expect(nodes(target.eligibility, (node) => node.type === "matches").map((node) => node.parameters)).toEqual([{ filter: { state: "engaged" } }]);
    });

    it("a trigger's subject filter carries hidden as its state", () => {
      const text = "Friendly hidden PHOBOS unit is selected to attack. Your unit's melee attacks have [PRECISION].";
      const leaves = placed(text,
        ["Friendly hidden PHOBOS unit", "unit-filter", { side: "friendly", keywords: ["PHOBOS"], states: ["hidden"] }],
        ["is selected to attack", "event", { kind: "selected", to: "attack" }],
        ["Your unit's melee attacks have", "weapon-ability-grant", { subject: "this-unit", weapon_type: "melee" }],
        ["PRECISION", "weapon-ability-keyword", { keyword: "Precision" }],
      );
      const result = compileLeaves(leaves, text);
      if (!result.ok) throw new Error(result.errors.join("; "));
      expect(nodes(result.mechanics, (node) => node.state === "hidden")).toHaveLength(1);
      expect(nodes(result.mechanics, (node) => node.state === "hidden")[0]).toMatchObject({ owner: "friendly", all_of: ["PHOBOS"] });
    });

    it("a distance measured to an engaged enemy unit folds the state into the following filter", () => {
      const text = "within 12\" of an engaged enemy unit";
      const folded = foldUnitFilters(placed(text,
        ["within 12\" of an", "unit-position", { kind: "within", inches: 12, of: "following-filter", subject: "event-subject", negated: false }],
        ["engaged enemy unit", "unit-filter", { side: "enemy", states: ["engaged"] }],
      ), text);
      expect(folded).toHaveLength(1);
      expect(folded[0]!.parameters).toMatchObject({ inches: 12, following_filter: { owner: "enemy", state: "engaged" } });
    });
  });

  describe("design records' shapes (fabricated wording)", () => {
    const shoot = "Your Shooting phase, when a friendly engaged SAMPLE KNIGHTS unit is selected to shoot.\nThat SAMPLE KNIGHTS unit.\nYour unit's ranged attacks have [PRECISION].";
    it("a friendly engaged unit selected to shoot carries engaged on the event subject", () => {
      const result = compileLeaves(placed(shoot,
        ["Your Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }],
        ["friendly engaged SAMPLE KNIGHTS unit", "unit-filter", { side: "friendly", keywords: ["SAMPLE KNIGHTS"], states: ["engaged"] }],
        ["selected to shoot", "event", { kind: "selected", to: "shoot" }],
        ["That SAMPLE KNIGHTS unit", "triggering-target", { selects: "unit", keywords: ["SAMPLE KNIGHTS"], match: "all" }],
        ["Your unit's ranged attacks have", "weapon-ability-grant", { subject: "this-unit", weapon_type: "ranged" }],
        ["PRECISION", "weapon-ability-keyword", { keyword: "Precision" }],
      ), shoot);
      if (!result.ok) throw new Error(result.errors.join("; "));
      expect(nodes(result.mechanics, (node) => node.state === "engaged")).toHaveLength(1);
    });

    const attack = "Your Shooting phase or the Fight phase, when a friendly hidden SAMPLE SCOUTS unit is selected to attack.\nThat SAMPLE SCOUTS unit.\nYour unit's attacks have: +1 S. [Lethal Hits].";
    const attackLeaves = (middle: Array<[string, string, Record<string, unknown>]>) => placed(attack,
      ["Your Shooting phase or the Fight phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: ["fight"] }],
      ["friendly hidden SAMPLE SCOUTS unit", "unit-filter", { side: "friendly", keywords: ["SAMPLE SCOUTS"], states: ["hidden"] }],
      ["selected to attack", "event", { kind: "selected", to: "attack" }],
      ["That SAMPLE SCOUTS unit", "triggering-target", { selects: "unit", keywords: ["SAMPLE SCOUTS"], match: "all" }],
      ["Your unit's attacks have", "weapon-ability-grant", { subject: "this-unit", weapon_type: "all" }],
      ...middle,
      ["Lethal Hits", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
    );
    it("a stat adjustment between the grant frame and its keyword does not strand the keyword", () => {
      const result = compileLeaves(attackLeaves([["+1 S", "characteristic-modifier", { subject: "this-unit", characteristics: ["S"], operation: "improve", value: 1, weapon_type: "all" }]]), attack);
      if (!result.ok) throw new Error(result.errors.join("; "));
      expect(nodes(result.mechanics, (node) => node.state === "hidden")).toHaveLength(1);
      expect(nodes(result.mechanics, (node) => node.type === "stat-modifier")).toHaveLength(1);
      expect(nodes(result.mechanics, (node) => node.type === "weapon-ability-grant")).toHaveLength(1);
    });
    it("still refuses a keyword with no frame reaching it past a different leaf", () => {
      const result = compileLeaves(attackLeaves([["+1 S", "feel-no-pain", { subject: "this-unit", threshold: 6, against: "all" }]]), attack);
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.errors.join(" ")).toMatch(/needs weapon-ability-keyword leaves to grant/u);
    });
  });

  describe("describer: the state reads as the printed word", () => {
    it("renders engaged and hidden unit states", () => {
      expect(describeCondition({ type: "matches", parameters: { filter: { state: "engaged" } } } as never)).toMatch(/engaged/u);
      expect(describeCondition({ type: "matches", parameters: { filter: { state: "hidden" } } } as never)).toMatch(/hidden/u);
    });
  });

  describe("refusals that stay", () => {
    it("a shooting trigger with an engaged filter refuses for its other need, not for the state", () => {
      const text = "Friendly engaged IMPERIAL KNIGHTS unit is selected to shoot. It can do the Unknown Thing.";
      const result = compileLeaves(placed(text,
        ["Friendly engaged IMPERIAL KNIGHTS unit", "unit-filter", { side: "friendly", keywords: ["IMPERIAL KNIGHTS"], states: ["engaged"] }],
        ["is selected to shoot", "event", { kind: "selected", to: "shoot" }],
        ["It can do the Unknown Thing", "weapon-ability-keyword", { keyword: "Blast" }],
      ), text);
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.errors.join(" ")).not.toMatch(/engaged|hidden/u);
    });
  });
}
