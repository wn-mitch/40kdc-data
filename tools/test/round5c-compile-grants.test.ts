import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { CompileError, compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { foldWeaponKeywords } from "../src/round5c/compile-weapon-keywords.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";

/**
 * Batch 2 (grants & ability control): core-ability-grant, keyword-grant, weapon-grant,
 * ability-modifier, ability-activate, and weapon-ability-grant@4's new filters and flags.
 */

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");

function authored(factionId: string, abilityId: string): Record<string, unknown> {
  const entries = JSON.parse(readFileSync(join(dataRoot, factionId, "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  const entry = entries.find((item) => item.ability_id === abilityId);
  if (!entry) throw new Error(`Missing ${factionId}/${abilityId}`);
  return entry;
}

let offset = 0;
function leaf(role: string, familyId: string, parameters: Record<string, unknown>, familyVersion = 1): CompileLeaf {
  offset += 10;
  return { role, family_id: familyId, family_version: familyVersion, parameters, start_byte: offset };
}

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

/** The compiled entry on a real authored base must validate, lint, and render. */
function rendered(base: Record<string, unknown>, leaves: CompileLeaf[]): string {
  const entry = entryWithMechanics(base, compiled(leaves).mechanics);
  const check = checkEntry(entry);
  expect(check.errors).toEqual([]);
  return check.rendered_text!;
}

describe("Round 5C grants & ability control families", () => {
  const base = authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");

  it("grants a core ability, rated or not, distinct from fights-first", () => {
    const cases: Array<[CompileLeaf, Record<string, unknown>]> = [
      [leaf("EFFECT", "core-ability-grant", { subject: "this-unit", ability: "infiltrators" }), { type: "ability-grant", target: "this-unit", modifier: { ability: "infiltrators" } }],
      [leaf("EFFECT", "core-ability-grant", { subject: "this-model", ability: "scouts", value: 6 }), { type: "ability-grant", target: "this-model", modifier: { ability: "scouts", value: 6 } }],
      [leaf("EFFECT", "core-ability-grant", { subject: "this-unit", ability: "deadly-demise", value: { rating: true } }),
        { type: "ability-grant", target: "this-unit", modifier: { ability: "deadly-demise", value: { rating: true } } }],
      [leaf("EFFECT", "core-ability-grant", { subject: "this-unit", ability: "benefit-of-cover" }), { type: "ability-grant", target: "this-unit", modifier: { ability: "benefit-of-cover" } }],
    ];
    for (const [input, expected] of cases) {
      expect(compiled([input]).mechanics.effect).toEqual(expected);
      expect(rendered(base, [input]).length).toBeGreaterThan(0);
    }
    // A value is only valid for a rated ability, and only within its schema's bounds.
    expect(() => normalizeFingerprintParameters("core-ability-grant", { subject: "this-unit", ability: "infiltrators", value: 1 })).toThrow();
    expect(() => normalizeFingerprintParameters("core-ability-grant", { subject: "this-unit", ability: "scouts" })).toThrow();
  });

  it("grants unit keywords, optionally replacing others", () => {
    const plain = leaf("EFFECT", "keyword-grant", { subject: "this-unit", keywords: ["INFANTRY"] });
    expect(compiled([plain]).mechanics.effect).toEqual({ type: "keyword-grant", target: "this-unit", modifier: { keywords: ["INFANTRY"] } });
    const replacing = leaf("EFFECT", "keyword-grant", { subject: "this-model", keywords: ["CHARACTER", "EPIC HERO"], replaces: ["INFANTRY"] });
    expect(compiled([replacing]).mechanics.effect).toEqual({
      type: "keyword-grant", target: "this-model", modifier: { keywords: ["CHARACTER", "EPIC HERO"], replaces: ["INFANTRY"] },
    });
    expect(rendered(base, [plain]).length).toBeGreaterThan(0);
    expect(rendered(base, [replacing]).length).toBeGreaterThan(0);
    // A keyword must read the way the DSL spells one: uppercase, no markdown emphasis.
    expect(() => normalizeFingerprintParameters("keyword-grant", { subject: "this-unit", keywords: ["infantry"] })).toThrow();
    expect(() => normalizeFingerprintParameters("keyword-grant", { subject: "this-unit", keywords: [] })).toThrow();
  });

  it("equips a weapon, optionally more than one", () => {
    const one = leaf("EFFECT", "weapon-grant", { subject: "this-model", weapon_id: "power-fist" });
    expect(compiled([one]).mechanics.effect).toEqual({ type: "weapon-grant", target: "this-model", modifier: { weapon_id: "power-fist" } });
    const many = leaf("EFFECT", "weapon-grant", { subject: "this-unit", weapon_id: "frag-grenades", count: 2 });
    expect(compiled([many]).mechanics.effect).toEqual({ type: "weapon-grant", target: "this-unit", modifier: { weapon_id: "frag-grenades", count: 2 } });
    expect(rendered(base, [one]).length).toBeGreaterThan(0);
    expect(rendered(base, [many]).length).toBeGreaterThan(0);
    expect(() => normalizeFingerprintParameters("weapon-grant", { subject: "this-unit", weapon_id: "Power Fist" })).toThrow();
  });

  it("changes a named ability's range, uses, or other measured aspect (@1, frozen)", () => {
    const widenRange = leaf("EFFECT", "ability-modifier", { subject: "this-unit", ability: "voice-of-command-astra-militarum", aspect: "range", operation: "add", value: 3 });
    expect(compiled([widenRange]).mechanics.effect).toEqual({
      type: "ability-modifier", target: "this-unit", modifier: { ability: "voice-of-command-astra-militarum", aspect: "range", operation: "add", value: 3 },
    });
    const extraUse = leaf("EFFECT", "ability-modifier", { subject: "this-model", ability: "voice-of-command-astra-militarum", aspect: "uses", operation: "set", value: 2 });
    expect(compiled([extraUse]).mechanics.effect).toEqual({
      type: "ability-modifier", target: "this-model", modifier: { ability: "voice-of-command-astra-militarum", aspect: "uses", operation: "set", value: 2 },
    });
    expect(rendered(base, [widenRange]).length).toBeGreaterThan(0);
    expect(rendered(base, [extraUse]).length).toBeGreaterThan(0);
    // @1 never had recipients/options/lift-limit; those only exist from @2.
    expect(() => normalizeFingerprintParameters("ability-modifier", { subject: "this-unit", ability: "x", aspect: "recipients", operation: "add", value: 1 }, 1)).toThrow();
    expect(() => normalizeFingerprintParameters("ability-modifier", { subject: "this-unit", ability: "x", aspect: "range", operation: "lift-limit", value: 1 }, 1)).toThrow();
  });

  it("changes a named ability at @2: recipients, options, an object ability ref, and uses-only limits", () => {
    // Widen recipients: no value, a unit-filter names who else the ability now reaches.
    const widen = leaf("EFFECT", "ability-modifier", {
      subject: "this-unit", ability: "oath-of-moment", aspect: "recipients", operation: "add", recipients: { owner: "friendly", all_of: ["CHARACTER"] },
    }, 2);
    expect(compiled([widen]).mechanics.effect).toEqual({
      type: "ability-modifier", target: "this-unit",
      modifier: { ability: "oath-of-moment", aspect: "recipients", operation: "add", recipients: { owner: "friendly", all_of: ["CHARACTER"] } },
    });
    expect(rendered(base, [widen]).length).toBeGreaterThan(0);

    // Add an option: the embedded effect is validated against the real effect-node schema.
    const addOption = leaf("EFFECT", "ability-modifier", {
      subject: "this-model", ability: "warlord-trait-x", aspect: "options", operation: "add",
      add_option: { name: "Total Carnage", effect: { type: "mortal-wounds", target: "this-unit", modifier: { count: 3 } } },
    }, 2);
    expect(compiled([addOption]).mechanics.effect).toMatchObject({ modifier: { aspect: "options", add_option: { name: "Total Carnage" } } });
    expect(rendered(base, [addOption]).length).toBeGreaterThan(0);
    expect(() => normalizeFingerprintParameters("ability-modifier", {
      subject: "this-model", ability: "warlord-trait-x", aspect: "options", operation: "add", add_option: { name: "X", effect: { type: "not-a-real-effect" } },
    }, 2)).toThrow();

    // An object ability ref: every ability with a keyword, or the ability a used-trigger names.
    const byKeyword = leaf("EFFECT", "ability-modifier", { subject: "this-unit", ability: { keyword: "PSYCHIC" }, aspect: "threshold", operation: "set", value: 4 }, 2);
    expect(compiled([byKeyword]).mechanics.effect).toEqual({
      type: "ability-modifier", target: "this-unit", modifier: { ability: { keyword: "PSYCHIC" }, aspect: "threshold", operation: "set", value: 4 },
    });
    expect(rendered(base, [byKeyword]).length).toBeGreaterThan(0);
    const affecting = leaf("EFFECT", "ability-modifier", { subject: "this-unit", ability: { affecting: { owner: "enemy" } }, aspect: "range", operation: "add", value: 3 }, 2);
    expect(compiled([affecting]).mechanics.effect).toMatchObject({ modifier: { ability: { affecting: { owner: "enemy" } } } });
    expect(rendered(base, [affecting]).length).toBeGreaterThan(0);

    // Uses-only limits: cap_per and not_same only apply to the uses aspect.
    const cappedUse = leaf("EFFECT", "ability-modifier", {
      subject: "this-model", ability: "overkill", aspect: "uses", operation: "add", value: 1, cap_per: { count: 1, period: "battle-round" }, not_same: "phase",
    }, 2);
    expect(compiled([cappedUse]).mechanics.effect).toEqual({
      type: "ability-modifier", target: "this-model",
      modifier: { ability: "overkill", aspect: "uses", operation: "add", value: 1, cap_per: { count: 1, period: "battle-round" }, not_same: "phase" },
    });
    expect(rendered(base, [cappedUse]).length).toBeGreaterThan(0);
    expect(() => normalizeFingerprintParameters("ability-modifier", {
      subject: "this-model", ability: "overkill", aspect: "range", operation: "add", value: 1, not_same: "phase",
    }, 2)).toThrow();
  });

  it("migrates ability-modifier@1 leaves to @2 with no data loss", () => {
    const v1 = leaf("EFFECT", "ability-modifier", { subject: "this-unit", ability: "voice-of-command-astra-militarum", aspect: "range", operation: "add", value: 3 }, 1);
    const v2 = leaf("EFFECT", "ability-modifier", { subject: "this-unit", ability: "voice-of-command-astra-militarum", aspect: "range", operation: "add", value: 3 }, 2);
    expect(compiled([v1]).mechanics.effect).toEqual(compiled([v2]).mechanics.effect);
    expect(normalizeFingerprintParameters("ability-modifier", { subject: "this-unit", ability: "voice-of-command-astra-militarum", aspect: "range", operation: "add", value: 3 }, 1))
      .toEqual(normalizeFingerprintParameters("ability-modifier", { subject: "this-unit", ability: "voice-of-command-astra-militarum", aspect: "range", operation: "add", value: 3 }, 2));
  });

  it("grants a non-core ability record, distinct from core-ability-grant", () => {
    const plain = leaf("EFFECT", "ability-record-grant", { subject: "this-unit", ability: "blessings-of-khorne-world-eaters" });
    expect(compiled([plain]).mechanics.effect).toEqual({ type: "ability-grant", target: "this-unit", modifier: { ability: "blessings-of-khorne-world-eaters" } });
    const rated = leaf("EFFECT", "ability-record-grant", { subject: "this-model", ability: "riled-up", value: { rating: true } });
    expect(compiled([rated]).mechanics.effect).toEqual({ type: "ability-grant", target: "this-model", modifier: { ability: "riled-up", value: { rating: true } } });
    const bundle = leaf("EFFECT", "ability-record-grant", { subject: "this-unit", ability: "author-of-the-codex-adeptus-astartes", rules_bundle: true });
    expect(compiled([bundle]).mechanics.effect).toEqual({ type: "ability-grant", target: "this-unit", modifier: { ability: "author-of-the-codex-adeptus-astartes", rules_bundle: true } });
    for (const input of [plain, rated, bundle]) expect(rendered(base, [input]).length).toBeGreaterThan(0);
    // A core ability belongs to core-ability-grant, not this family.
    expect(() => normalizeFingerprintParameters("ability-record-grant", { subject: "this-unit", ability: "fights-first" })).toThrow();
  });

  it("activates a named ability now, or one of its options exclusively", () => {
    const now = leaf("EFFECT", "ability-activate", { subject: "this-unit", ability: "voice-of-command-astra-militarum" });
    expect(compiled([now]).mechanics.effect).toEqual({ type: "ability-activate", target: "this-unit", modifier: { ability: "voice-of-command-astra-militarum" } });
    const option = leaf("EFFECT", "ability-activate", { subject: "this-model", ability: "stratagem-x", option: "advance", exclusive: true });
    expect(compiled([option]).mechanics.effect).toEqual({
      type: "ability-activate", target: "this-model", modifier: { ability: "stratagem-x", option: "advance", exclusive: true },
    });
    expect(rendered(base, [now]).length).toBeGreaterThan(0);
    expect(rendered(base, [option]).length).toBeGreaterThan(0);
    // exclusive names which option is exclusively active; it needs an option to point at.
    expect(() => normalizeFingerprintParameters("ability-activate", { subject: "this-unit", ability: "x", exclusive: true })).toThrow();
  });

  it("extends weapon-ability-grant@4 with a weapon filter, if_present, and incoming", () => {
    const named = leaf("EFFECT", "weapon-ability-grant", { subject: "this-unit", keyword: "Lethal Hits", weapon_type: "all", weapon_name: "Volkite Charger" }, 4);
    expect(compiled([named]).mechanics.effect).toEqual({
      type: "weapon-ability-grant", target: "this-unit", modifier: { abilities: ["Lethal Hits"], weapon_name: "Volkite Charger" },
    });
    const byKeyword = leaf("EFFECT", "weapon-ability-grant", { subject: "this-unit", keyword: "Precision", weapon_type: "ranged", weapon_keyword: "PISTOL" }, 4);
    expect(compiled([byKeyword]).mechanics.effect).toEqual({
      type: "weapon-ability-grant", target: "this-unit", modifier: { abilities: ["Precision"], weapon_type: "ranged", weapon_keyword: "PISTOL" },
    });
    const incrementing = leaf("EFFECT", "weapon-ability-grant", { subject: "this-model", keyword: "Sustained Hits 1", weapon_type: "all", if_present: "increment" }, 4);
    expect(compiled([incrementing]).mechanics.effect).toEqual({
      type: "weapon-ability-grant", target: "this-model", modifier: { abilities: ["Sustained Hits 1"], if_present: "increment" },
    });
    const incoming = leaf("EFFECT", "weapon-ability-grant", { subject: "this-unit", keyword: "Devastating Wounds", weapon_type: "melee", incoming: true }, 4);
    expect(compiled([incoming]).mechanics.effect).toEqual({
      type: "weapon-ability-grant", target: "this-unit", modifier: { abilities: ["Devastating Wounds"], weapon_type: "melee", incoming: true },
    });
    for (const input of [named, byKeyword, incrementing, incoming]) expect(rendered(base, [input]).length).toBeGreaterThan(0);
    // weapon_name and weapon_keyword are alternative filters, never both at once.
    expect(() => normalizeFingerprintParameters("weapon-ability-grant", {
      subject: "this-unit", keyword: "Lethal Hits", weapon_type: "all", weapon_name: "X", weapon_keyword: "PISTOL",
    }, 4)).toThrow();
    // incoming names the attacking weapon; combining it with a named-weapon filter has no text.
    expect(() => normalizeFingerprintParameters("weapon-ability-grant", {
      subject: "this-unit", keyword: "Lethal Hits", weapon_type: "all", weapon_name: "X", incoming: true,
    }, 4)).toThrow();
  });

  it("migrates weapon-ability-grant@3 leaves to @4 with no data loss", () => {
    // v3->v4 is purely additive: a v3 leaf's parameters are already a valid v4 parameter set.
    const v3 = leaf("EFFECT", "weapon-ability-grant", { subject: "this-unit", keyword: "Lethal Hits", weapon_type: "melee" }, 3);
    const v4 = leaf("EFFECT", "weapon-ability-grant", { subject: "this-unit", keyword: "Lethal Hits", weapon_type: "melee" }, 4);
    expect(compiled([v3]).mechanics.effect).toEqual(compiled([v4]).mechanics.effect);
  });
});

/** Leaves placed on fabricated wording in order, each spanning its phrase (as round5c-attack-properties.test.ts). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>, string?]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, fragment = "RAW_TEXT"]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment };
  });
}

describe("Round 5C weapon-ability grants with recipient leaves between frame and keyword", () => {
  // Fabricated wording: a frame, a model recipient, an owner clause, then the keyword it grants.
  const text = "Ranged weapons carried by ZORN models from your army have Ignores Cover.";
  const frameWording = "Ranged weapons carried by";
  const recipient = ["ZORN models", "unit-filter", { side: "friendly", keywords: ["ZORN"], level: "model" }] as const;
  const owner = ["from your army", "unit-owner", { owner: "friendly" }] as const;
  const keyword = ["Ignores Cover", "weapon-ability-keyword", { keyword: "Ignores Cover" }] as const;
  const frame = (subject: string) => [frameWording, "weapon-ability-grant", { subject, weapon_type: "ranged" }] as const;

  it("folds a keyword run across a model recipient and owner into the frame that precedes them", () => {
    const list = placed(text, [...frame("antecedent")], [...recipient], [...owner], [...keyword]);
    const folded = foldWeaponKeywords(list, text);
    expect(folded.map((leaf) => leaf.family_id)).toEqual(["weapon-ability-grant", "unit-filter", "unit-owner"]);
    expect(folded[0]!.parameters.keywords).toEqual(["Ignores Cover"]);
    expect(folded[1]!.parameters).toMatchObject({ side: "friendly", level: "model" });
  });

  it("compiles the folded grant to a model-level recipient", () => {
    const result = compileLeaves(placed(text, [...frame("antecedent")], [...recipient], [...owner], [...keyword]), text);
    expect(result.ok).toBe(true);
    expect(result.mechanics.effect).toMatchObject({ type: "weapon-ability-grant", modifier: { abilities: ["Ignores Cover"], weapon_type: "ranged" } });
  });

  it("refuses a duration between the frame and its keyword, so the keyword is not folded across it", () => {
    const timed = "Ranged weapons carried by ZORN models until the end of the phase have Ignores Cover.";
    const withDuration = placed(timed, [...frame("antecedent")], ["until the end of the phase", "duration", {}], [...keyword]);
    expect(() => foldWeaponKeywords(withDuration, timed)).toThrow(CompileError);
    expect(() => foldWeaponKeywords(withDuration, timed)).toThrow("A weapon-ability-grant without a keyword needs weapon-ability-keyword leaves to grant.");
  });

  it("does not claim a keyword run across a sentence break", () => {
    const broken = "Ranged weapons carried by ZORN models. Ignores Cover.";
    const list = placed(broken, [...frame("antecedent")], ["ZORN models", "unit-filter", { side: "friendly", keywords: ["ZORN"], level: "model" }], [...keyword]);
    expect(() => foldWeaponKeywords(list, broken)).toThrow(CompileError);
  });

  it("does not claim a keyword run across a recipient leaf in another fragment", () => {
    const other = placed(text, [...frame("antecedent")], ["ZORN models", "unit-filter", { side: "friendly", keywords: ["ZORN"], level: "model" }, "WHEN"], [...keyword]);
    expect(() => foldWeaponKeywords(other, text)).toThrow(CompileError);
  });

  it("refuses a this-unit frame with a recipient filter after it, through the full pipeline", () => {
    const result = compileLeaves(placed(text, [...frame("this-unit")], [...recipient], [...owner], [...keyword]), text);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("A unit-filter needs a select-unit or attack right before it");
  });
});

describe("Round 5C grant and activation shapes from the wave-10 records (fabricated wording)", () => {
  it("re-rolls a roll made by the units a filter after the reroll names", () => {
    const text = "Re-roll Advance rolls made for FOO units from your army.";
    const result = compileLeaves(placed(text,
      ["Re-roll Advance rolls made for", "reroll", { roll: "advance", subset: "all", weapon_type: "all", subject: "antecedent" }],
      ["FOO units", "unit-filter", { side: "friendly", keywords: ["FOO"] }],
      ["from your army", "unit-owner", { owner: "friendly" }]), text);
    expect(result.ok).toBe(true);
    expect(result.mechanics.effect).toEqual({ type: "re-roll", target: { owner: "friendly", all_of: ["FOO"] }, modifier: { roll: "advance", result_scope: "any-result" } });
  });

  it("activates a chosen option for the units a filter after it names, with no exclusive", () => {
    const text = "Choose one Blessing of Khorne. That Blessing of Khorne is active for friendly FOO units in addition to it.";
    const result = compileLeaves(placed(text,
      ["Choose one Blessing of Khorne", "choice-open", { min_choices: 1, max_choices: 1 }],
      ["That Blessing of Khorne is active for", "ability-activate", { subject: "antecedent", ability: "blessing-of-khorne", chosen: true, additive: true }],
      ["friendly FOO units", "unit-filter", { side: "friendly", keywords: ["FOO"] }]), text);
    expect(result.ok).toBe(true);
    expect(result.mechanics.effect).toEqual({ type: "ability-activate", target: { owner: "friendly", all_of: ["FOO"] }, modifier: { ability: "blessing-of-khorne", select: { by: "player" } } });
  });

  it("gives each option of a menu its own unit filter, with the header a connective", () => {
    const text = "Select one option. Furor: weapons equipped by FOO units have the Ignores Cover ability. Malleus: weapons equipped by FOO units have the Lethal Hits ability.";
    const result = compileLeaves(placed(text,
      ["Select one option.", "choice-open", { min_choices: 1, max_choices: 1 }],
      ["Furor", "named-option", { label: "Furor" }],
      ["weapons equipped by", "weapon-ability-grant", { subject: "antecedent", weapon_type: "all" }],
      ["FOO units", "unit-filter", { side: "friendly", keywords: ["FOO"] }],
      ["Ignores Cover", "weapon-ability-keyword", { keyword: "Ignores Cover" }],
      ["Malleus", "named-option", { label: "Malleus" }],
      ["weapons equipped by", "weapon-ability-grant", { subject: "antecedent", weapon_type: "all" }],
      ["FOO units", "unit-filter", { side: "friendly", keywords: ["FOO"] }],
      ["Lethal Hits", "weapon-ability-keyword", { keyword: "Lethal Hits" }]), text);
    expect(result.ok).toBe(true);
    const options = (result.mechanics.effect as { options: Array<{ target: unknown }> }).options;
    expect(options).toHaveLength(2);
    expect(options.map((option) => option.target)).toEqual([{ owner: "friendly", all_of: ["FOO"] }, { owner: "friendly", all_of: ["FOO"] }]);
  });

  it("grants a keyword across a model recipient with a weapon keyword scope (the ranged and psychic shapes)", () => {
    const text = "Psychic weapons equipped by FOO models have the Ignores Cover ability.";
    const result = compileLeaves(placed(text,
      ["Psychic weapons equipped by", "weapon-ability-grant", { subject: "antecedent", weapon_type: "all", weapon_keyword: "Psychic" }],
      ["FOO models", "unit-filter", { side: "friendly", keywords: ["FOO"], level: "model" }],
      ["Ignores Cover", "weapon-ability-keyword", { keyword: "Ignores Cover" }]), text);
    expect(result.ok).toBe(true);
    expect(result.mechanics.effect).toEqual({ type: "weapon-ability-grant", target: { owner: "friendly", all_of: ["FOO"], level: "model" }, modifier: { abilities: ["Ignores Cover"], weapon_keyword: "Psychic" } });
  });
});
