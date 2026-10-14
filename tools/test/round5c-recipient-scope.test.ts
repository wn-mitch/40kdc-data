import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { hoistWeaponRecipients } from "../src/round5c/compile-weapon-scopes.js";

/**
 * A weapon scope printed before its recipient chain, and "such a weapon" after a scope-printed
 * grant. Wording is fabricated; each leaf is placed on its wording's first occurrence after the
 * previous one, as the parser places them.
 */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
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

function resultOf(list: CompileLeaf[], text: string) {
  return compileLeaves(list, text);
}

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = resultOf(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

const FAB = { faction_id: "fab", source_type: "stratagem", catalog: { faction: [{ name: "Plasma rifle", type: "ranged" as const }] } };
const SCOPE_ERROR = "An attack-property scope needs a following weapon property in its clause.";
const NO_GRANT_ERROR = "\"Such a weapon\" has no earlier keyword grant to name the weapons it gave the keyword to.";
const scope = (wording: string, weaponType?: string): [string, string, Record<string, unknown>] =>
  [wording, "weapon-property-scope", { subject: "antecedent", ...(weaponType === undefined ? {} : { weapon_type: weaponType }) }];

// Each leaf's parameter spans, so a recipient chain of ALPHA, BETA and GAMMA models.
const ALPHA_TEXT = "Ranged weapons equipped by ALPHA, BETA and GAMMA models from your army have the IGNORES COVER ability.";

describe("a weapon scope printed before its recipient chain", () => {
  it("binds the model-level recipients of any listed keyword as the grant's target", () => {
    const mechanics = mechanicsOf(placed(ALPHA_TEXT,
      scope("Ranged weapons equipped by", "ranged"),
      ["ALPHA, BETA and GAMMA models", "unit-filter", { side: "friendly", any_keywords: ["ALPHA", "BETA", "GAMMA"], level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["IGNORES COVER", "weapon-ability-keyword", { keyword: "Ignores Cover" }],
    ), ALPHA_TEXT);
    const grant = JSON.stringify(mechanics.effect);
    expect(grant).toContain('"owner":"friendly"');
    expect(grant).toContain('"any_of":["ALPHA","BETA","GAMMA"]');
    expect(grant).toContain('"level":"model"');
    expect(grant).toContain('"keywords":[{"keyword_id":"ignores-cover"}]');
    expect(grant).toContain('"weapons":{"type":"ranged"}');
    // An "all" list is not an "any" list: a substituted operator would widen or narrow the recipients.
    expect(grant).not.toContain('"all_of":["ALPHA"');
  });

  it("binds a single keyword's model-level recipients with the scope's type", () => {
    const text = "Ranged weapons equipped by OMEGA models from your army have the ASSAULT ability.";
    const json = JSON.stringify(mechanicsOf(placed(text,
      scope("Ranged weapons equipped by", "ranged"),
      ["OMEGA models", "unit-filter", { side: "friendly", keywords: ["OMEGA"], level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["ASSAULT", "weapon-ability-keyword", { keyword: "Assault" }],
    ), text).effect);
    expect(json).toContain(JSON.stringify({ owner: "friendly", all_of: ["OMEGA"], level: "model" }));
    expect(json).toContain(JSON.stringify({ keywords: [{ keyword_id: "assault" }], weapons: { type: "ranged" } }));
  });

  it("keeps a battle-round window ahead of a scope printed after its chain", () => {
    const text = "In battle rounds three to five, ranged weapons equipped by NU models from your army have the ASSAULT ability.";
    const json = JSON.stringify(mechanicsOf(placed(text,
      ["In battle rounds three to five", "battle-round", { min: 3, max: 5 }],
      scope("ranged weapons equipped by", "ranged"),
      ["NU models", "unit-filter", { side: "friendly", keywords: ["NU"], level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["ASSAULT", "weapon-ability-keyword", { keyword: "Assault" }],
    ), text));
    expect(json).toContain('"type":"battle-round"');
    expect(json).toContain(JSON.stringify({ owner: "friendly", all_of: ["NU"], level: "model" }));
  });

  it("binds a unit-level recipient with no level, and omits a weapon type the scope does not state", () => {
    const text = "Melee weapons equipped by DELTA units from your army have the LANCE ability.";
    const mechanics = mechanicsOf(placed(text,
      scope("Melee weapons equipped by", "melee"),
      ["DELTA units", "unit-filter", { side: "friendly", keywords: ["DELTA"] }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["LANCE", "weapon-ability-keyword", { keyword: "Lance" }],
    ), text);
    const grant = JSON.stringify(mechanics.effect);
    expect(grant).toContain('"all_of":["DELTA"]');
    expect(grant).not.toContain('"level"');
    expect(grant).toContain('"weapons":{"type":"melee"}');
  });

  it("keeps a scope of all weapons unrestricted by type", () => {
    const text = "Weapons equipped by EPSILON and ZETA models from your army have the SUSTAINED HITS 1 ability.";
    const mechanics = mechanicsOf(placed(text,
      scope("Weapons equipped by", "all"),
      ["EPSILON and ZETA models", "unit-filter", { side: "friendly", any_keywords: ["EPSILON", "ZETA"], level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["SUSTAINED HITS 1", "weapon-ability-keyword", { keyword: "Sustained Hits 1" }],
    ), text);
    const grant = JSON.stringify(mechanics.effect);
    expect(grant).toContain('"keywords":[{"keyword_id":"sustained-hits","parameters":{"value":1}}]');
    expect(mechanics.effect.modifier.weapons).toBeUndefined();
  });

  it("refuses a recipient chain split by a sentence break before the keyword", () => {
    const text = "Ranged weapons equipped by ETA models from your army. Have the ASSAULT ability.";
    const result = resultOf(placed(text,
      scope("Ranged weapons equipped by", "ranged"),
      ["ETA models", "unit-filter", { side: "friendly", keywords: ["ETA"], level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["ASSAULT", "weapon-ability-keyword", { keyword: "Assault" }],
    ), text);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toEqual([SCOPE_ERROR]);
  });

  it("refuses a keyword run split by a sentence break between its keywords", () => {
    // ". " has no letters and is short, so the keyword fold's run test alone would join the two keywords.
    const text = "Ranged weapons equipped by SIGMA models from your army have the ASSAULT. LANCE ability.";
    const result = resultOf(placed(text,
      scope("Ranged weapons equipped by", "ranged"),
      ["SIGMA models", "unit-filter", { side: "friendly", keywords: ["SIGMA"], level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["ASSAULT", "weapon-ability-keyword", { keyword: "Assault" }],
      ["LANCE", "weapon-ability-keyword", { keyword: "Lance" }],
    ), text);
    expect(result.ok ? [] : result.errors).toEqual([SCOPE_ERROR]);
  });

  it("refuses a recipient chain followed by an attack before the keyword", () => {
    const text = "Ranged weapons equipped by THETA models from your army make an attack and have the ASSAULT ability.";
    const result = resultOf(placed(text,
      scope("Ranged weapons equipped by", "ranged"),
      ["THETA models", "unit-filter", { side: "friendly", keywords: ["THETA"], level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["make an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["ASSAULT", "weapon-ability-keyword", { keyword: "Assault" }],
    ), text);
    expect(result.ok ? [] : result.errors).toEqual([SCOPE_ERROR]);
  });

  it("refuses a scope with no recipient chain and no property after it", () => {
    const text = "Ranged weapons equipped by IOTA models.";
    const result = resultOf(placed(text, scope("Ranged weapons equipped by", "ranged")), text);
    expect(result.ok ? [] : result.errors).toEqual([SCOPE_ERROR]);
  });

  it("refuses a chain whose unit-filter is any-sided", () => {
    const result = resultOf(placed(ALPHA_TEXT,
      scope("Ranged weapons equipped by", "ranged"),
      ["ALPHA, BETA and GAMMA models", "unit-filter", { side: "any", any_keywords: ["ALPHA", "BETA", "GAMMA"], level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["IGNORES COVER", "weapon-ability-keyword", { keyword: "Ignores Cover" }],
    ), ALPHA_TEXT);
    expect(result.ok ? [] : result.errors).toEqual([SCOPE_ERROR]);
  });

  it("refuses an owner on the other side from the chain's unit-filter", () => {
    const result = resultOf(placed(ALPHA_TEXT,
      scope("Ranged weapons equipped by", "ranged"),
      ["ALPHA, BETA and GAMMA models", "unit-filter", { side: "friendly", any_keywords: ["ALPHA", "BETA", "GAMMA"], level: "model" }],
      ["from your army", "unit-owner", { owner: "enemy" }],
      ["IGNORES COVER", "weapon-ability-keyword", { keyword: "Ignores Cover" }],
    ), ALPHA_TEXT);
    expect(result.ok ? [] : result.errors).toEqual([SCOPE_ERROR]);
  });

  it("keeps a stat run after a chain unhoisted, so the chain still refuses", () => {
    const text = "Ranged weapons equipped by KAPPA models from your army add 1 to the Strength characteristic.";
    const result = resultOf(placed(text,
      scope("Ranged weapons equipped by", "ranged"),
      ["KAPPA models", "unit-filter", { side: "friendly", keywords: ["KAPPA"], level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["add 1 to the Strength characteristic", "characteristic-modifier", { characteristics: ["S"], operation: "add", value: 1 }],
    ), text);
    expect(result.ok ? [] : result.errors).toEqual([SCOPE_ERROR]);
  });

  // A scope's weapon_name is legitimate (weapon-property-scope carries one weapon name), but the name needs the
  // record's faction to resolve, and the hoist never moves a scope that names its weapons.
  const named = () => placed(ALPHA_TEXT,
    scope("Ranged weapons equipped by", "ranged"),
    ["ALPHA, BETA and GAMMA models", "unit-filter", { side: "friendly", any_keywords: ["ALPHA", "BETA", "GAMMA"], level: "model" }],
    ["from your army", "unit-owner", { owner: "friendly" }],
    ["IGNORES COVER", "weapon-ability-keyword", { keyword: "Ignores Cover" }],
  ).map((leaf) => leaf.family_id === "weapon-property-scope" ? { ...leaf, parameters: { ...leaf.parameters, weapon_name: "plasma rifle" } } : leaf);

  it("never hoists a scope that names its weapons by name", () => {
    const list = named();
    expect(hoistWeaponRecipients(list, ALPHA_TEXT).map((leaf) => leaf.family_id)).toEqual(list.map((leaf) => leaf.family_id));
  });

  it("refuses a scope that names a weapon when the record has no faction to look it up in", () => {
    const result = resultOf(named(), ALPHA_TEXT);
    expect(result.ok ? [] : result.errors).toEqual(["Named weapons need the record's faction to look them up."]);
  });

  it("still refuses the scope for the unhoisted chain once a faction resolves the name", () => {
    const text = "Plasma rifle weapons equipped by ALPHA, BETA and GAMMA models from your army have the IGNORES COVER ability.";
    const list = placed(text,
      scope("Plasma rifle weapons", "ranged"),
      ["ALPHA, BETA and GAMMA models", "unit-filter", { side: "friendly", any_keywords: ["ALPHA", "BETA", "GAMMA"], level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["IGNORES COVER", "weapon-ability-keyword", { keyword: "Ignores Cover" }],
    ).map((leaf) => leaf.family_id === "weapon-property-scope" ? { ...leaf, parameters: { ...leaf.parameters, weapon_name: "Plasma rifle" } } : leaf);
    const result = compileLeaves(list, text, { weapons: FAB });
    expect(result.ok ? [] : result.errors).toEqual([SCOPE_ERROR]);
  });

  it("compiles a named scope that has its recipient in front, once a faction resolves the name", () => {
    const text = "Your unit's Plasma rifle weapons have the IGNORES COVER ability.";
    const list = placed(text,
      ["Your unit's Plasma rifle weapons", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged" }],
      ["IGNORES COVER", "weapon-ability-keyword", { keyword: "Ignores Cover" }],
    ).map((leaf) => leaf.family_id === "weapon-property-scope" ? { ...leaf, parameters: { ...leaf.parameters, weapon_name: "Plasma rifle" } } : leaf);
    const result = compileLeaves(list, text, { weapons: FAB });
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(JSON.stringify(result.ok ? result.mechanics : null)).toContain("Plasma rifle");
  });
});

describe("hoistWeaponRecipients places the scope after its chain", () => {
  it("orders the leaves by byte position once the scope moves", () => {
    const list = placed(ALPHA_TEXT,
      scope("Ranged weapons equipped by", "ranged"),
      ["ALPHA, BETA and GAMMA models", "unit-filter", { side: "friendly", any_keywords: ["ALPHA", "BETA", "GAMMA"], level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["IGNORES COVER", "weapon-ability-keyword", { keyword: "Ignores Cover" }],
    );
    const hoisted = hoistWeaponRecipients(list, ALPHA_TEXT);
    const starts = hoisted.map((leaf) => leaf.start_byte);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(hoisted.map((leaf) => leaf.family_id)).toEqual(["unit-filter", "unit-owner", "weapon-property-scope", "weapon-ability-keyword"]);
    // The scope's span now ends where the chain ends, so the gap before the keyword is the lead-in.
    expect(hoisted[2]!.start_byte).toBe(list[2]!.end_byte);
  });

  it("returns the list unchanged without source text", () => {
    const list = placed(ALPHA_TEXT,
      scope("Ranged weapons equipped by", "ranged"),
      ["ALPHA, BETA and GAMMA models", "unit-filter", { side: "friendly", any_keywords: ["ALPHA", "BETA", "GAMMA"], level: "model" }],
      ["IGNORES COVER", "weapon-ability-keyword", { keyword: "Ignores Cover" }],
    );
    expect(hoistWeaponRecipients(list, undefined).map((leaf) => leaf.family_id)).toEqual(list.map((leaf) => leaf.family_id));
  });
});

/** "that weapon" is the Assault grant of a model-level scope (fabricated wording). */
const SUCH_TEXT = "Ranged weapons equipped by KAPPA models from your army have the ASSAULT ability, and each time an attack made with such a weapon targets a unit within 6\", add 1 to the Strength characteristic of that attack.";
const sustained = (attackParameters: Record<string, unknown> = {}) => [
  scope("Ranged weapons equipped by", "ranged"),
  ["KAPPA models", "unit-filter", { side: "friendly", keywords: ["KAPPA"], level: "model" }],
  ["from your army", "unit-owner", { owner: "friendly" }],
  ["ASSAULT", "weapon-ability-keyword", { keyword: "Assault" }],
  ["each time an attack made", "attack", { direction: "makes", unit: "that-unit", attack_type: "any", ...attackParameters }],
  ["with such a weapon", "attack-filter", { weapon: "antecedent" }],
  ["targets a unit within 6\"", "unit-position", { kind: "within", inches: 6, of: "attacker", subject: "target", negated: false }],
  ["add 1 to the Strength characteristic of that attack", "characteristic-modifier", { subject: "attack", characteristics: ["S"], operation: "add", value: 1, weapon_type: "all" }],
] as Array<[string, string, Record<string, unknown>]>;

describe("such a weapon after a scope-printed grant", () => {
  it("binds the attacks to the granted model units, not to every weapon of the type", () => {
    const mechanics = mechanicsOf(placed(SUCH_TEXT, ...sustained()), SUCH_TEXT);
    const json = JSON.stringify(mechanics);
    expect(json).toContain('"weapons":{"keyword":{"keyword_id":"assault"}},"attack_type":"ranged"');
    expect(json).not.toContain('"weapon":"antecedent"');
    expect(json).not.toContain('"this-unit"');
    // The stat change's target is the grant's recipients, the same units the keyword went to.
    const target = { owner: "friendly", all_of: ["KAPPA"], level: "model" };
    expect(json).toContain(JSON.stringify(target));
    expect(JSON.stringify(mechanics.effect).split(JSON.stringify(target)).length - 1).toBeGreaterThanOrEqual(2);
  });

  it("binds a unit-level recipient, and the stat change takes the grant's target", () => {
    const text = SUCH_TEXT.replace("KAPPA models", "KAPPA units");
    const list = placed(text, ...sustained().map((item, index) => index === 1 ? ["KAPPA units", "unit-filter", { side: "friendly", keywords: ["KAPPA"] }] as [string, string, Record<string, unknown>] : item));
    const json = JSON.stringify(mechanicsOf(list, text));
    expect(json).toContain(JSON.stringify({ owner: "friendly", all_of: ["KAPPA"] }));
    expect(json).not.toContain('"level":"model"');
  });

  it("refuses an attack that already names its attacker with unit", () => {
    const result = resultOf(placed(SUCH_TEXT, ...sustained({ unit: "this-unit" })), SUCH_TEXT);
    expect(result.ok ? [] : result.errors.join(" ")).toContain("unit");
  });

  it("refuses an attack that already names its attacker with attacker_filter", () => {
    // attacker_filter is folded in by foldUnitFilters, not authored, so the test adds it as the fold would.
    const list = placed(SUCH_TEXT, ...sustained()).map((leaf) => leaf.family_id === "attack" ? { ...leaf, parameters: { ...leaf.parameters, attacker_filter: { owner: "friendly" } } } : leaf);
    const result = resultOf(list, SUCH_TEXT);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("attacker_filter");
  });

  it("refuses a stated attack_type that conflicts with the granted weapons", () => {
    const list = placed(SUCH_TEXT, ...sustained()).map((leaf) => leaf.family_id === "attack-filter" ? { ...leaf, parameters: { ...leaf.parameters, attack_type: "melee" } } : leaf);
    const result = resultOf(list, SUCH_TEXT);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("conflicts with the granted ranged weapons");
  });

  it("refuses with the existing message when no weapon scope or keyword grant comes before it", () => {
    const text = "Each time an attack made with such a weapon targets a unit within 6\", add 1 to the Strength characteristic of that attack.";
    const result = resultOf(placed(text,
      ["Each time an attack made", "attack", { direction: "makes", unit: "that-unit", attack_type: "any" }],
      ["with such a weapon", "attack-filter", { weapon: "antecedent" }],
      ["targets a unit within 6\"", "unit-position", { kind: "within", inches: 6, of: "attacker", subject: "target", negated: false }],
    ), text);
    expect(result.ok ? [] : result.errors).toEqual([NO_GRANT_ERROR]);
  });

  it("refuses with the existing message when the earlier scope only changes stats", () => {
    const text = "Ranged weapons add 1 to the Strength characteristic, and each time an attack made with such a weapon targets a unit within 6\", add 1 to the Toughness characteristic of that attack.";
    const result = resultOf(placed(text,
      scope("Ranged weapons", "ranged"),
      ["add 1 to the Strength characteristic", "characteristic-modifier", { characteristics: ["S"], operation: "add", value: 1 }],
      ["each time an attack made", "attack", { direction: "makes", unit: "that-unit", attack_type: "any" }],
      ["with such a weapon", "attack-filter", { weapon: "antecedent" }],
    ), text);
    expect(result.ok ? [] : result.errors).toEqual([NO_GRANT_ERROR]);
  });
});
