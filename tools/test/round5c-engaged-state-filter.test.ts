import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { CompileError } from "../src/round5c/compile-fragments.js";
import { dslUnitFilter, foldUnitFilters, mergeStackedFilters } from "../src/round5c/compile-unit-filters.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { describeCondition } from "../src/translate/condition.js";

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
  it("accepts engaged and hidden at the current version, and the previous version still refuses them", () => {
    expect(currentFamilyVersion("unit-filter")).toBeGreaterThanOrEqual(9);
    expect(normalizeFingerprintParameters("unit-filter", { side: "friendly", states: ["engaged"] }, currentFamilyVersion("unit-filter"))).toEqual({ side: "friendly", states: ["engaged"] });
    expect(normalizeFingerprintParameters("unit-filter", { side: "friendly", states: ["hidden"] }, currentFamilyVersion("unit-filter"))).toEqual({ side: "friendly", states: ["hidden"] });
    expect(() => normalizeFingerprintParameters("unit-filter", { side: "friendly", states: ["engaged"] }, currentFamilyVersion("unit-filter") - 1)).toThrow();
    expect(() => normalizeFingerprintParameters("unit-filter", { side: "friendly", states: ["hidden"] }, currentFamilyVersion("unit-filter") - 1)).toThrow();
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

describe("aura: engaged and hidden are refused, unengaged still reaches units", () => {
  it("refuses an aura whose filter is engaged or hidden", () => {
    for (const state of ["engaged", "hidden"]) {
      const text = "Friendly engaged ARMIGER unit within 6\" of this unit has the Feel No Pain 6+ ability.";
      const result = compileLeaves(placed(text,
        ["Friendly engaged ARMIGER unit", "unit-filter", { side: "friendly", keywords: ["ARMIGER"], states: [state] }],
        ["within 6\" of this unit", "aura-range", { inches: 6, of: "this-unit" }],
        ["has the Feel No Pain 6+ ability", "feel-no-pain", { subject: "this-unit", threshold: 6, against: "all" }],
      ), text);
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.errors.join(" ")).toMatch(/engaged or hidden/u);
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
    expect(nodes(target.eligibility, (node) => node.type === "unit-state").map((node) => node.parameters)).toEqual([{ state: "engaged" }]);
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
    expect(describeCondition({ type: "unit-state", parameters: { state: "engaged" } } as never)).toMatch(/engaged/u);
    expect(describeCondition({ type: "unit-state", parameters: { state: "hidden" } } as never)).toMatch(/hidden/u);
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
