import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import type { CompileLeaf } from "../src/semantic-authoring/compile-fragments.js";
import { mergeStackedFilters } from "../src/semantic-authoring/compile-unit-filter-merge.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { coreCheckErrors } from "../src/semantic-authoring/core-checks.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";

// Fabricated wording and records only; no GW rule prose.

let at = 0;
function leaf(family_id: string, parameters: Record<string, unknown>, fragment?: string, version = currentFamilyVersion(family_id)): CompileLeaf {
  at += 10;
  return {
    role: familyRole(family_id, version), family_id, family_version: version, start_byte: at,
    parameters: normalizeFingerprintParameters(family_id, parameters, version), ...(fragment ? { fragment } : {}),
  };
}
const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

function nodes(tree: unknown, test: (node: Record<string, unknown>) => boolean): Array<Record<string, unknown>> {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, test));
  if (tree === null || typeof tree !== "object") return [];
  const node = tree as Record<string, unknown>;
  return [...(test(node) ? [node] : []), ...Object.values(node).flatMap((value) => nodes(value, test))];
}
function compiled(leaves: CompileLeaf[]): Record<string, unknown> {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Record<string, unknown>;
}
const errors = (leaves: CompileLeaf[]) => {
  const result = compileLeaves(leaves);
  return result.ok ? [] : result.errors;
};
const first = (tree: unknown, type: string) => nodes(tree, (node) => node.type === type)[0];
const heal = () => leaf("regain-wounds", { subject: "this-unit", amount: "1" });

const friendly = (keywords: string[], extra: Record<string, unknown> = {}) => leaf("unit-filter", { side: "friendly", keywords, ...extra });
const aura = () => leaf("aura-range", { inches: 6, of: "this-model" });

describe("Semantic authoring family extensions, third round", () => {
  describe("'that unit' after an aura is the unit the aura reaches", () => {
    it("binds an effect, mortal wounds and a condition to the aura's recipient, not the record's own unit", () => {
      const mechanics = compiled([
        friendly(["INFANTRY"]), aura(),
        leaf("unit-state", { states: ["battle-shocked"], subject: "antecedent", negated: true }),
        leaf("feel-no-pain", { subject: "antecedent", threshold: 5, against: "all" }),
      ]);
      expect(first(mechanics, "aura")).toMatchObject({ target: "friendly-within-aura", modifier: { range: { inches: 6 }, eligible: { owner: "friendly", all_of: ["INFANTRY"] } } });
      expect(first(mechanics, "feel-no-pain")).toMatchObject({ target: "recipient" });
      expect(JSON.stringify(mechanics)).toContain('"subject":"recipient"');
      const wounds = compiled([friendly(["INFANTRY"]), aura(), leaf("mortal-wounds", { recipient: "antecedent", count: "1" })]);
      expect(first(wounds, "mortal-wounds")).toMatchObject({ target: "recipient" });
    });

    it("still binds to the record's own unit without an aura, and refuses a family that cannot name the recipient", () => {
      expect(first(compiled([leaf("feel-no-pain", { subject: "antecedent", threshold: 5, against: "all" })]), "feel-no-pain")).toMatchObject({ target: "this-unit" });
      // A set-up's subject lowers as any unit-ref, so it names the recipient too.
      expect(first(compiled([friendly(["INFANTRY"]), aura(), leaf("set-up", { subject: "antecedent", to: "strategic-reserves", from: "battlefield" })]), "set-up")).toMatchObject({ target: "recipient" });
      expect(errors([friendly(["INFANTRY"]), aura(), leaf("targeting-restriction", { subject: "antecedent", may: "cannot-target", kind: "shoot", weapon_type: "all" })]).join(" "))
        .toMatch(/points back to the recipient/u);
    });

    it("leaves a selection first: 'that unit' after a selection inside an aura is the selected unit", () => {
      const mechanics = compiled([
        friendly(["INFANTRY"]), aura(),
        leaf("select-unit", { distance: "any", visible: false }), leaf("unit-filter", { side: "enemy" }),
        leaf("mortal-wounds", { recipient: "antecedent", count: "1" }),
      ]);
      expect(first(mechanics, "mortal-wounds")).toMatchObject({ target: "selected-unit" });
    });
  });

  describe("a unit-filter right before an effect names every unit it matches", () => {
    it("grants an ability to every friendly unit with the keywords, past a 'from your army'", () => {
      const mechanics = compiled([
        friendly(["ADEPTUS ASTARTES", "INFANTRY"]), leaf("unit-owner", { owner: "friendly" }),
        leaf("core-ability-grant", { subject: "antecedent", ability: "scouts", value: 6 }),
      ]);
      expect(first(mechanics, "ability-grant")).toMatchObject({ target: { owner: "friendly", all_of: ["ADEPTUS ASTARTES", "INFANTRY"] }, modifier: { ability: "scouts", value: 6 } });
      // The "from your army" is the filter's own wording, not a gate on this unit.
      expect(JSON.stringify(mechanics)).not.toContain("owned-by");
    });

    it("names models for a model-level filter, and keeps a filter after a selection on the selection", () => {
      const mechanics = compiled([friendly(["PSYKER"], { level: "model" }), leaf("invulnerable-save", { subject: "antecedent", threshold: 4 })]);
      expect(first(mechanics, "invulnerable-save")).toMatchObject({ target: { owner: "friendly", all_of: ["PSYKER"], level: "model" } });
      const selected = compiled([
        leaf("select-unit", { distance: "any", visible: false }), friendly(["INFANTRY"]),
        leaf("mortal-wounds", { recipient: "antecedent", count: "1" }),
      ]);
      expect(first(selected, "mortal-wounds")).toMatchObject({ target: "selected-unit" });
    });

    it("gives every property of an attack scope to the filter's units: \"Friendly X units' melee attacks have +1 A, +1 S and [LETHAL HITS]\"", () => {
      const mechanics = compiled([
        friendly(["WORLD EATERS"]), leaf("weapon-property-scope", { subject: "antecedent", weapon_type: "melee" }),
        leaf("characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1 }),
        leaf("characteristic-modifier", { characteristics: ["S"], operation: "improve", value: 1 }),
        leaf("weapon-ability-keyword", { keyword: "Lethal Hits" }),
      ]);
      const text = JSON.stringify(mechanics);
      expect(text).not.toContain("filtered-units");
      expect(text.match(/"target":\{"owner":"friendly","all_of":\["WORLD EATERS"\]\}/gu)).toHaveLength(3);
    });

    it("refuses a filter and a 'from your army' that name different sides, and a family that cannot take a filter", () => {
      expect(errors([friendly(["INFANTRY"]), leaf("unit-owner", { owner: "enemy" }), leaf("feel-no-pain", { subject: "antecedent", threshold: 5, against: "all" })]).join(" "))
        .toMatch(/different sides/u);
      // A family that cannot take a filter's units refuses it.
      expect(errors([friendly(["INFANTRY"]), leaf("targeting-restriction", { subject: "antecedent", may: "cannot-target", kind: "shoot", weapon_type: "all" })]).join(" "))
        .toMatch(/cannot name|unit-filter needs/u);
    });
  });

  it("binds 'it' in an ability grant and an invulnerable save, and gives Lone Operative a range", () => {
    expect(normalize("core-ability-grant", { subject: "antecedent", ability: "stealth" })).toEqual({ subject: "antecedent", ability: "stealth" });
    expect(normalize("invulnerable-save", { subject: "antecedent", threshold: 4 })).toEqual({ subject: "antecedent", threshold: 4 });
    expect(normalize("core-ability-grant", { subject: "this-model", ability: "lone-operative", value: 9 })).toEqual({ subject: "this-model", ability: "lone-operative", value: 9 });
    expect(() => normalize("core-ability-grant", { subject: "this-model", ability: "lone-operative", value: "9\"" })).toThrow(/range in inches/u);
    expect(() => normalize("core-ability-grant", { subject: "this-model", ability: "stealth", value: 9 })).toThrow();
  });

  it("names who destroyed a unit and whose unit it was, and selects a unit to attack", () => {
    const mechanics = compiled([
      leaf("event", { kind: "unit-destroyed", by: "this-unit", object_owner: "enemy" }),
      leaf("regain-wounds", { subject: "this-unit", amount: "1" }),
    ]);
    expect(JSON.stringify(mechanics)).toContain('"event":"destroyed","subject":"this-unit","object":{"owner":"enemy"}');
    expect(() => normalize("event", { kind: "phase-start", phase: "fight", turn: "your", by: "this-unit" })).toThrow(/unit-destroyed only/u);
    const attack = compiled([leaf("event", { kind: "selected", to: "attack" }), leaf("regain-wounds", { subject: "this-unit", amount: "1" })]);
    expect(JSON.stringify(attack)).toContain('"filter":{"to":"attack"}');
  });

  it("limits a characteristic change to one named weapon or to the subject's models with keywords", () => {
    const named = compiled([leaf("characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "add", value: 1, weapon_type: "melee", weapon_name: "Force Sword" })]);
    expect(first(named, "stat-modifier")).toMatchObject({ target: "this-model", modifier: { stat: "A", weapons: { type: "melee", name: "force sword" } } });
    expect(() => normalize("characteristic-modifier", { subject: "this-model", characteristics: ["A"], operation: "add", value: 1, weapon_type: "all", weapon_name: "force sword" })).toThrow(/melee or ranged/u);
    const models = compiled([leaf("characteristic-modifier", { subject: "this-unit", characteristics: ["T"], operation: "add", value: 1, weapon_type: "all", model_keywords: ["CHARACTER"] })]);
    expect(first(models, "stat-modifier")).toMatchObject({ target: { level: "model", member_of: "this-unit", all_of: ["CHARACTER"] } });
    expect(() => normalize("feel-no-pain", { subject: "this-model", threshold: 5, against: "all", model_keywords: ["CHARACTER"] })).toThrow(/models of a unit/u);
    const set = compiled([leaf("characteristic-set", { subject: "this-model", characteristic: "D", value: 2, weapon_type: "melee", weapon_name: "flail" })]);
    expect(first(set, "stat-modifier")).toMatchObject({ modifier: { stat: "D", operation: "set", value: 2, weapons: { type: "melee", name: "flail" } } });
    // A printed "Armour Penetration characteristic of -2" is stored as its magnitude.
    const ap = compiled([leaf("characteristic-set", { subject: "this-model", characteristic: "AP", value: -2, weapon_type: "ranged" })]);
    expect(first(ap, "stat-modifier")).toMatchObject({ modifier: { stat: "AP", operation: "set", value: 2 } });
  });

  it("inflicts any dice amount of mortal wounds, and sets a unit up near where it was destroyed beyond the Reserves limits", () => {
    expect(normalize("mortal-wounds", { recipient: "target", count: "2d3" })).toEqual({ recipient: "target", count: "2D3" });
    expect(normalize("mortal-wounds", { recipient: "target", count: "D3+1" })).toEqual({ recipient: "target", count: "D3+1" });
    expect(normalize("mortal-wounds", { recipient: "target", count: "D3" })).toEqual({ recipient: "target", count: "D3" });
    expect(() => normalize("mortal-wounds", { recipient: "target", count: "D4" })).toThrow();
    expect(() => normalize("mortal-wounds", { recipient: "nobody", count: "2D3" })).toThrow();
    const wounds = compiled([leaf("mortal-wounds", { recipient: "this-unit", count: "D3+1" })]);
    expect(first(wounds, "mortal-wounds")).toMatchObject({ modifier: { count: "D3+1" } });
    const setUp = compiled([leaf("set-up", { subject: "this-unit", to: "strategic-reserves", from: "battlefield", placement: "closest-to-destruction", ignore_limits: true })]);
    expect(first(setUp, "set-up")).toMatchObject({ modifier: { to: "strategic-reserves", placement: "closest-to-destruction", ignore_limits: true } });
    expect(() => normalize("set-up", { subject: "this-unit", to: "battlefield", ignore_limits: false })).toThrow(/true or absent/u);
  });
});

describe("Semantic authoring family extensions, third round: rolls and printed keywords", () => {
  const band = (from: number) => leaf("roll-result", { from });
  it("folds '+N to that roll' into the ability's own dice, so the band reads the changed result", () => {
    const mechanics = compiled([
      leaf("dice-roll", { dice: "D6" }), leaf("roll-modifier", { roll: "preceding", operation: "add", value: 1 }),
      band(4), leaf("mortal-wounds", { recipient: "this-unit", count: "1" }),
    ]);
    expect(first(mechanics, "dice-gated")).toMatchObject({ dice: "D6+1", threshold: 4 });
    expect(first(mechanics, "roll-modifier")).toBeUndefined();
    // A band only the changed roll can reach is no longer beyond the die.
    expect(errors([leaf("dice-roll", { dice: "D6" }), leaf("roll-modifier", { roll: "preceding", operation: "add", value: 1 }), band(7), leaf("mortal-wounds", { recipient: "this-unit", count: "1" })])).toEqual([]);
  });

  it("names the roll a test or roll event made, and refuses with no roll before it or a subtraction from dice", () => {
    // A condition between them keeps the change its own effect, naming the test's roll.
    const test = compiled([
      leaf("test", { target: "this-unit", test: "battle-shock" }),
      leaf("unit-state", { states: ["below-starting-strength"], subject: "this-unit", negated: false }),
      leaf("roll-modifier", { roll: "preceding", operation: "subtract", value: 1 }),
    ]);
    expect(first(test, "roll-modifier")).toMatchObject({ modifier: { roll: "battle-shock", operation: "subtract", value: 1 } });
    // Right after the test, the change is that test's own modifier.
    const folded = compiled([leaf("test", { target: "this-unit", test: "battle-shock" }), leaf("roll-modifier", { roll: "preceding", operation: "subtract", value: 1 })]);
    expect(first(folded, "test")).toMatchObject({ modifier: { test: "battle-shock", modifier: -1 } });
    expect(first(folded, "roll-modifier")).toBeUndefined();
    expect(errors([leaf("roll-modifier", { roll: "preceding", operation: "add", value: 1 })]).join(" ")).toMatch(/no roll or test comes before it/u);
    expect(errors([leaf("dice-roll", { dice: "D6" }), leaf("roll-modifier", { roll: "preceding", operation: "subtract", value: 1 }), band(4), leaf("mortal-wounds", { recipient: "this-unit", count: "1" })]).join(" "))
      .toMatch(/Only adding/u);
  });

  it("accepts keywords printed with accented capitals and keeps their spelling", () => {
    expect(normalize("bearer-eligibility", { keywords: ["KÂHL"], match: "all", excluded_keywords: [] })).toEqual({ keywords: ["KÂHL"], match: "all", excluded_keywords: [] });
    expect(normalize("unit-keyword", { keywords: ["KÂHL"], subject: "this-unit", negated: false })).toMatchObject({ keywords: ["KÂHL"] });
    expect(() => normalize("bearer-eligibility", { keywords: ["KÂHL", "KAHL"], match: "all", excluded_keywords: [] })).toThrow(/with and without accents/u);
    expect(() => normalize("bearer-eligibility", { keywords: ["kâhl!"], match: "all", excluded_keywords: [] })).toThrow();
  });
});

describe("Semantic authoring family extensions, third round: unit history", () => {
  it("reads disembarking, an Ingress move and being set up this turn as history, and keeps earlier activities", () => {
    const condition = (activities: string[]) => compiled([
      leaf("unit-activity", { activities, subject: "this-unit", negated: false }), leaf("regain-wounds", { subject: "this-unit", amount: "1" }),
    ]);
    const text = JSON.stringify(condition(["disembarked-this-turn"]));
    expect(text).toContain('"event":"disembarked","window":"turn"');
    expect(text).not.toContain('"filter":{}');
    expect(JSON.stringify(condition(["made-ingress-move-this-turn", "advanced-this-turn"]))).toContain('"move_types":["ingress"]');
    expect(JSON.stringify(condition(["set-up-this-turn"]))).toContain('"event":"set-up","window":"turn"');
    expect(() => normalize("unit-activity", { activities: ["set-up-this-turn", "set-up-this-turn"], subject: "this-unit", negated: false })).toThrow(/twice/u);
  });
});

describe("Semantic authoring family extensions, third round: an aura's recipient acting", () => {
  it("names the aura's recipient as the unit whose moment fires the trigger", () => {
    const mechanics = compiled([
      friendly(["WAR DOG"]), aura(),
      leaf("event", { kind: "attacks-resolved", action_kind: "attack", subject: "antecedent" }),
      leaf("reroll", { roll: "wound", subset: "ones", weapon_type: "all" }),
    ]);
    expect(JSON.stringify(mechanics)).toContain('"event":"attacks-resolved","subject":"recipient"');
  });
});

describe("targeting-restriction by and target", () => {
  const restriction = { may: "must-target", kind: "attack", weapon_type: "all" };

  it("names the unit that targets and the unit targeted, the anaphor bound to the selection", () => {
    const tree = compiled([
      leaf("select-unit", { scope: "enemy", distance: "any", visible: false }),
      leaf("targeting-restriction", { ...restriction, by: "this-unit", target: "antecedent" }),
    ]);
    expect(first(tree, "targeting")).toEqual({ type: "targeting", target: "this-unit", modifier: { by: "this-unit", may: "must-target", kind: "attack", target: "selected-unit" } });
  });

  it("puts a passive restriction on the unit targeted, with no attacker named", () => {
    const tree = compiled([leaf("targeting-restriction", { may: "cannot-target", kind: "shoot", weapon_type: "ranged", target: "this-unit" })]);
    expect(first(tree, "targeting")).toEqual({ type: "targeting", target: "this-unit", modifier: { may: "cannot-target", kind: "shoot", weapons: { type: "ranged" }, target: "this-unit" } });
  });

  it("lowers every enemy unit as an owner filter on either side", () => {
    const tree = compiled([leaf("targeting-restriction", { may: "cannot-target", kind: "stratagem", weapon_type: "all", by: "enemy-units", target: "this-unit" })]);
    expect(first(tree, "targeting")).toMatchObject({ target: { owner: "enemy" }, modifier: { by: { owner: "enemy" }, target: "this-unit" } });
  });

  it("names one Stratagem, or every Stratagem but the Core ones", () => {
    const fire = compiled([leaf("targeting-restriction", { may: "cannot-target", kind: "stratagem", weapon_type: "all", by: "enemy-units", target: "this-unit", stratagem: "fire-overwatch" })]);
    expect(first(fire, "targeting")).toMatchObject({ modifier: { by: { owner: "enemy" }, target: "this-unit", kind: "stratagem", stratagem: "fire-overwatch" } });
    const core = compiled([leaf("targeting-restriction", { may: "cannot-target", kind: "stratagem", weapon_type: "all", target: "this-model", except: "core-stratagems" })]);
    expect(first(core, "targeting")).toMatchObject({ target: "this-model", modifier: { target: "this-model", except: "core-stratagems" } });
    expect(() => normalize("targeting-restriction", { may: "cannot-target", kind: "attack", weapon_type: "all", target: "this-unit", stratagem: "fire-overwatch" })).toThrow(/kind stratagem only/u);
    expect(() => normalize("targeting-restriction", { may: "must-target", kind: "stratagem", weapon_type: "all", target: "this-unit", except: "core-stratagems" })).toThrow(/cannot-target/u);
    expect(() => normalize("targeting-restriction", { may: "cannot-target", kind: "stratagem", weapon_type: "all", subject: "this-unit", stratagem: "fire-overwatch" })).toThrow(/not subject/u);
    expect(() => normalize("targeting-restriction", { may: "cannot-target", kind: "stratagem", weapon_type: "all", target: "this-unit", stratagem: "Fire Overwatch" })).toThrow(/kebab-case/u);
  });

  it("keeps a subject leaf exactly as the previous version read it", () => {
    const tree = compiled([leaf("targeting-restriction", { ...restriction, subject: "this-unit" })]);
    expect(first(tree, "targeting")).toEqual({ type: "targeting", target: "this-unit", modifier: { may: "must-target", kind: "attack" } });
    expect(currentFamilyVersion("targeting-restriction")).toBeGreaterThan(2);
    expect(normalizeFingerprintParameters("targeting-restriction", { ...restriction, subject: "this-unit" }, currentFamilyVersion("targeting-restriction") - 1))
      .toEqual(normalize("targeting-restriction", { ...restriction, subject: "this-unit" }));
  });

  it("refuses a leaf that mixes the readings, an attacker with no target, or one unit on both sides", () => {
    expect(() => normalize("targeting-restriction", { ...restriction, subject: "this-unit", target: "antecedent" })).toThrow(/either subject/u);
    expect(() => normalize("targeting-restriction", { ...restriction, by: "this-unit" })).toThrow(/needs a target/u);
    expect(() => normalize("targeting-restriction", { ...restriction, by: "this-unit", target: "this-unit" })).toThrow(/same unit/u);
    expect(() => normalize("targeting-restriction", { ...restriction })).toThrow();
  });

  it("refuses an anaphor with nothing for it to point back to in a Stratagem", () => {
    expect(errors([
      leaf("use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"),
      leaf("targeting-restriction", { ...restriction, by: "this-unit", target: "antecedent" }, "EFFECT"),
    ]).join()).toMatch(/points back/u);
  });
});

describe("stacked unit-filters", () => {
  const friendly = (extra: Record<string, unknown>) => leaf("unit-filter", { side: "friendly", ...extra }, "TARGET");
  const owner = () => leaf("unit-owner", { owner: "friendly" }, "TARGET");

  it("merges a keyword filter and an excluding filter, keeping \"from your army\" after them", () => {
    const merged = mergeStackedFilters([friendly({ keywords: ["ALPHA"] }), owner(), friendly({ excluded_keywords: ["BETA"] })]);
    expect(merged.map((item) => item.family_id)).toEqual(["unit-filter", "unit-owner"]);
    expect(merged[0]!.parameters).toEqual({ side: "friendly", keywords: ["ALPHA"], excluded_keywords: ["BETA"] });
  });

  it("compiles a Stratagem target written as two filters", () => {
    const result = compileLeaves([
      leaf("use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"),
      leaf("stratagem-target", { count: "one" }, "TARGET"), friendly({ keywords: ["ALPHA"] }), owner(), friendly({ excluded_keywords: ["BETA"] }),
      leaf("regain-wounds", { subject: "this-unit", amount: "1" }, "EFFECT"),
    ]);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(JSON.stringify(result.core)).toContain("ALPHA");
    expect(JSON.stringify(result.core)).toContain("BETA");
  });

  it("leaves filters of different sides, of models and units, or with two any-of lists apart", () => {
    const enemy = leaf("unit-filter", { side: "enemy" }, "TARGET");
    expect(mergeStackedFilters([enemy, friendly({ keywords: ["ALPHA"] })])).toHaveLength(2);
    expect(mergeStackedFilters([friendly({ keywords: ["ALPHA"], level: "model" }), friendly({ excluded_keywords: ["BETA"] })])).toHaveLength(2);
    expect(mergeStackedFilters([friendly({ any_keywords: ["ALPHA", "GAMMA"] }), friendly({ any_keywords: ["BETA", "DELTA"] })])).toHaveLength(2);
    // A "from your army" of another side between them keeps them apart too.
    expect(mergeStackedFilters([friendly({ keywords: ["ALPHA"] }), leaf("unit-owner", { owner: "enemy" }, "TARGET"), friendly({ excluded_keywords: ["BETA"] })])).toHaveLength(3);
  });

  /** Filters placed on their own wording in `text`, so the joiners between them are real source. */
  const placed = (text: string, ...items: Array<[string, Record<string, unknown>]>): CompileLeaf[] => {
    const bytes = Buffer.from(text, "utf8");
    let from = 0;
    return items.map(([wording, extra]) => {
      const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
      if (start < 0) throw new Error(`"${wording}" is not in the text`);
      from = start + Buffer.byteLength(wording, "utf8");
      return { ...friendly(extra), start_byte: start, end_byte: from };
    });
  };

  it("joins filters written as alternatives into one any-of instead of narrowing to both", () => {
    const text = "One **HERETIC ASTARTES TERMINATOR**, **OBLITERATORS** or **MUTILATORS** unit from your army.";
    const merged = mergeStackedFilters(placed(text,
      ["HERETIC ASTARTES TERMINATOR", { keywords: ["HERETIC ASTARTES", "TERMINATOR"] }],
      ["OBLITERATORS", { keywords: ["HERETIC ASTARTES", "OBLITERATORS"] }],
      ["MUTILATORS** unit", { keywords: ["HERETIC ASTARTES", "MUTILATORS"] }]), text);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.parameters).toEqual({ side: "friendly", keywords: ["HERETIC ASTARTES"], any_keywords: ["MUTILATORS", "OBLITERATORS", "TERMINATOR"] });
  });

  it("keeps an exclusion's own parentheses as narrowing of its own alternative only", () => {
    const text = "One **HERETIC ASTARTES INFANTRY** (excluding **DAMNED** units) or **HERETIC ASTARTES MOUNTED** unit";
    const merged = mergeStackedFilters(placed(text,
      ["HERETIC ASTARTES INFANTRY", { keywords: ["HERETIC ASTARTES", "INFANTRY"] }],
      ["excluding **DAMNED** units", { excluded_keywords: ["DAMNED"] }],
      ["HERETIC ASTARTES MOUNTED** unit", { keywords: ["HERETIC ASTARTES", "MOUNTED"] }]), text);
    expect(merged).toHaveLength(1);
    // The exclusion stays with INFANTRY; a MOUNTED unit is not checked for DAMNED.
    expect(merged[0]!.parameters).toEqual({
      side: "friendly", keywords: ["HERETIC ASTARTES"],
      alternatives: [{ keywords: ["INFANTRY"], excluded_keywords: ["DAMNED"] }, { keywords: ["MOUNTED"] }],
    });
  });

  it("keeps alternatives that share no keyword prefix as alternatives, never their union", () => {
    // (HERETIC ASTARTES and VEHICLE) or VASHTORR THE ARKIFANE.
    const text = "One **HERETIC ASTARTES VEHICLE** or **VASHTORR THE ARKIFANE** unit";
    const merged = mergeStackedFilters(placed(text,
      ["HERETIC ASTARTES VEHICLE", { keywords: ["HERETIC ASTARTES", "VEHICLE"] }],
      ["VASHTORR THE ARKIFANE** unit", { keywords: ["VASHTORR THE ARKIFANE"] }]), text);
    expect(merged[0]!.parameters).toEqual({
      side: "friendly", alternatives: [{ keywords: ["HERETIC ASTARTES", "VEHICLE"] }, { keywords: ["VASHTORR THE ARKIFANE"] }],
    });
  });

  it("still narrows a comma list with no \"or\", and filters with no source text", () => {
    const text = "**ALPHA**, **BETA** unit";
    const leaves = placed(text, ["ALPHA", { keywords: ["ALPHA"] }], ["BETA** unit", { keywords: ["BETA"] }]);
    expect(mergeStackedFilters(leaves, text)[0]!.parameters).toEqual({ side: "friendly", keywords: ["ALPHA", "BETA"] });
    expect(mergeStackedFilters(leaves)[0]!.parameters).toEqual({ side: "friendly", keywords: ["ALPHA", "BETA"] });
  });

  it("compiles a Stratagem target of alternatives as any of them", () => {
    const text = "Your Shooting phase.\nOne **HERETIC ASTARTES INFANTRY** or **HERETIC ASTARTES MOUNTED** unit from your army.\nOne model in your unit regains 1 lost wound.";
    const at = (wording: string) => Buffer.from(text, "utf8").indexOf(Buffer.from(wording, "utf8"));
    const [infantry, mounted] = placed(text,
      ["HERETIC ASTARTES INFANTRY", { keywords: ["HERETIC ASTARTES", "INFANTRY"] }],
      ["HERETIC ASTARTES MOUNTED** unit", { keywords: ["HERETIC ASTARTES", "MOUNTED"] }]);
    const result = compileLeaves([
      { ...leaf("use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"), start_byte: 0, end_byte: 19 },
      { ...leaf("stratagem-target", { count: "one" }, "TARGET"), start_byte: at("One"), end_byte: at("One") + 3 },
      infantry!, mounted!,
      { ...leaf("unit-owner", { owner: "friendly" }, "TARGET"), start_byte: at("from your army"), end_byte: at("from your army") + 14 },
      { ...leaf("regain-wounds", { subject: "this-unit", amount: "1" }, "EFFECT"), start_byte: at("One model"), end_byte: text.length },
    ], text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const core = JSON.stringify(result.core);
    expect(core).toContain('"any_of":["INFANTRY","MOUNTED"]');
    expect(core).not.toContain('"INFANTRY","MOUNTED"],"match":"all"');
  });

  it("refuses a merged filter that requires and excludes one keyword", () => {
    expect(() => mergeStackedFilters([friendly({ keywords: ["ALPHA"] }), friendly({ excluded_keywords: ["ALPHA"] })])).toThrow(/require and exclude/u);
  });
});

describe("selected to charge", () => {
  it("lowers to the DSL's declare-charge", () => {
    const tree = compiled([leaf("event", { kind: "selected", to: "charge" }), heal()]);
    expect(tree.trigger).toEqual({ event: "selected", filter: { to: "declare-charge" } });
  });
});

describe("implied CHARACTER on enhancements", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function fixture(nonCharacter: boolean | null): string {
    const base = mkdtempSync(join(tmpdir(), "semantic-authoring-extensions-4-"));
    roots.push(base);
    const data = join(base, "data");
    mkdirSync(join(data, "core", "alpha"), { recursive: true });
    // Fabricated fixture record only.
    writeFileSync(join(data, "core", "alpha", "enhancements.json"), JSON.stringify([
      { id: "gun", keyword_restrictions: ["Alpha", "Titanic"], external_refs: [{ namespace: "mfm", id: "m-1" }] },
    ]));
    if (nonCharacter !== null) {
      mkdirSync(join(base, "_private"));
      writeFileSync(join(base, "_private", "dump.json"), JSON.stringify({ data: { enhancement: [{ id: "m-1", isEquipableByNonCharacterUnit: nonCharacter }] } }));
    }
    return data;
  }
  const check = (data: string) => coreCheckErrors(data, "gun", [{ kind: "bearer-eligibility", parameters: { keywords: ["ALPHA", "CHARACTER", "TITANIC"], match: "all", excluded_keywords: [] } }]);

  it("accepts CHARACTER the core record leaves out when the dump keeps the enhancement from non-Characters", () => {
    expect(check(fixture(false))).toEqual([]);
  });

  it("still refuses CHARACTER when the dump lets non-Characters take it, or there is no dump", () => {
    expect(check(fixture(true))).toHaveLength(1);
    expect(check(fixture(null))).toHaveLength(1);
  });
});

describe("detachment tags", () => {
  const enrichment = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
  const authored = (factionId: string, abilityId: string) => (JSON.parse(readFileSync(join(enrichment, factionId, "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
    .find((item) => item.ability_id === abilityId)!;

  it("lowers the tag a detachment carries as the army rule's tag, which the DSL schema accepts", () => {
    const tree = compiled([leaf("army-construction", { rule: "detachment-tag-exclusive", with_keywords: ["ALPHA"] })]);
    expect(first(tree, "army-rule")).toEqual({ type: "army-rule", target: "this-unit", modifier: { rule: "detachment-tag-exclusive", tag: "ALPHA" } });
    const result = compileLeaves([leaf("army-construction", { rule: "detachment-tag-exclusive", with_keywords: ["ALPHA"] })]);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(checkEntry(entryWithMechanics(authored("aeldari", "dance-of-distortion-aeldari"), result.mechanics)).errors).toEqual([]);
  });

  it("refuses a tag leaf that names no tag", () => {
    expect(errors([leaf("army-construction", { rule: "detachment-tag-exclusive" })]).join()).toMatch(/exactly one tag/u);
  });
});
