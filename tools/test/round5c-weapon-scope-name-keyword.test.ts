import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { resolveAuthoredNames } from "../src/round5c/compile-weapon-names.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { familyExtension } from "../src/round5c/families/index.js";
import type { WeaponCatalog } from "../src/round5c/weapon-catalog.js";
import { keywordRef } from "../src/round5c/compile-fragments.js";

/** The family versions the extensions under test create. */
const WEAPON_SCOPE_NAME_KEYWORD_EXCLUSION_VERSIONS: ReadonlySet<string> = new Set(["weapon-property-scope@8", "characteristic-set@8", "roll-modifier@8"]);

/**
 * A scope that names one weapon, a set that selects weapons by keyword, and a roll modifier for named
 * weapons. Every weapon and sentence is fabricated.
 */

type Piece = [wording: string, family: string, parameters: Record<string, unknown>, fragment?: string];

/** Leaves at the byte offsets of their wording in `text`, in order. */
function placed(text: string, ...pieces: Piece[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return pieces.map(([wording, family, parameters, fragment = "RAW_TEXT"]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment };
  });
}

const FACTION: WeaponCatalog["faction"] = [
  { name: "Zap cannon", type: "ranged" }, { name: "Zap lasgun", type: "ranged" }, { name: "Zap blade", type: "melee" },
  { name: "Fab caster", type: "ranged" }, { name: "Hound's tooth", type: "melee" }, { name: "Twin lash", type: "melee" },
  { name: "Plasma lamp", type: "ranged" }, { name: "Plasma pistol", type: "ranged" },
];
const OWN: WeaponCatalog["faction"] = [
  { name: "Zap cannon", type: "ranged" }, { name: "Fab caster", type: "ranged" }, { name: "Hound's tooth", type: "melee" },
  { name: "Twin lash", type: "melee" }, { name: "Plasma lamp", type: "ranged" }, { name: "Plasma pistol", type: "ranged" },
];
const UNIT = { faction_id: "fab", source_type: "unit", catalog: { faction: FACTION, own: OWN } };
const STRATAGEM = { faction_id: "fab", source_type: "stratagem", catalog: { faction: FACTION } };

function mechanicsOf(list: CompileLeaf[], text: string, weapons = STRATAGEM): Record<string, any> {
  const result = compileLeaves(list, text, { weapons });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function refusalOf(list: CompileLeaf[], text: string, weapons = STRATAGEM): string {
  const result = compileLeaves(list, text, { weapons });
  if (result.ok) throw new Error("expected a refusal");
  return result.errors.join("; ");
}

/** The leaf after name resolution alone; throws the span refusal. */
function resolved(text: string, piece: Piece, weapons = UNIT): CompileLeaf {
  return resolveAuthoredNames(placed(text, piece), text, weapons, undefined)[0]!;
}

describe("family versions: weapon-property-scope weapon_name, characteristic-set weapon_keyword, roll-modifier weapon names", () => {
  const norm = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

  it("tracks the extension as the current version, positionally", () => {
    // Later extensions may sit above this one, so find its version by identity, not as the current one.
    for (const family of ["weapon-property-scope", "characteristic-set", "roll-modifier"]) {
      const versions = Array.from({ length: currentFamilyVersion(family) }, (_, at) => at + 1);
      const extension = versions.map((version) => familyExtension(family, version)).find((found) => found !== undefined && WEAPON_SCOPE_NAME_KEYWORD_EXCLUSION_VERSIONS.has(`${found.family}@${found.version}`));
      expect(extension?.description).toMatch(/^As the previous version, plus weapon_/u);
    }
  });

  it("accepts a scope that names one weapon, and still every value the previous version accepted", () => {
    expect(norm("weapon-property-scope", { subject: "this-unit", weapon_type: "all", weapon_name: "Zap cannon" })).toEqual({ subject: "this-unit", weapon_type: "all", weapon_name: "Zap cannon" });
    expect(norm("weapon-property-scope", { subject: "this-unit", weapon_type: "ranged", weapon_keyword: "Torrent" })).toEqual({ subject: "this-unit", weapon_type: "ranged", weapon_keyword: "Torrent" });
    expect(norm("weapon-property-scope", { subject: "antecedent", weapon_type: "melee", weapon_names: ["Zap blade", "Twin lash"] }).weapon_names).toHaveLength(2);
    expect(norm("weapon-property-scope", { frame: "antecedent" })).toEqual({ frame: "antecedent" });
    expect(norm("weapon-property-scope", { subject: "this-unit", weapon_type: "ranged" })).toEqual({ subject: "this-unit", weapon_type: "ranged" });
  });

  it("refuses a scope weapon_name with no weapon_type, with a second selector, or padded", () => {
    expect(() => norm("weapon-property-scope", { subject: "this-unit", weapon_name: "Zap cannon" })).toThrow(/needs weapon_type/u);
    expect(() => norm("weapon-property-scope", { subject: "this-unit", weapon_type: "all", weapon_name: "Zap cannon", weapon_names: ["A b", "C d"] })).toThrow(/cannot combine with weapon_names/u);
    expect(() => norm("weapon-property-scope", { subject: "this-unit", weapon_type: "all", weapon_name: "Zap cannon", weapon_keyword: "Torrent" })).toThrow(/weapon_keyword/u);
    expect(() => norm("weapon-property-scope", { subject: "this-unit", weapon_type: "all", weapon_name: "Zap cannon", frame: "antecedent" })).toThrow(/frame/u);
    expect(() => norm("weapon-property-scope", { subject: "this-unit", weapon_type: "all", weapon_name: " Zap cannon" })).toThrow(/no padding/u);
    expect(() => norm("weapon-property-scope", { subject: "this-unit", weapon_type: "all", weapon_name: "" })).toThrow();
  });

  it("accepts a set by weapon keyword, and every value the previous version accepted", () => {
    expect(norm("characteristic-set", { subject: "this-unit", characteristic: "A", value: 6, weapon_type: "all", weapon_keyword: "Torrent" }).weapon_keyword).toBe("Torrent");
    expect(norm("characteristic-set", { subject: "this-unit", characteristic: "A", value: 6, weapon_type: "ranged", weapon_name: "Zap cannon" })).toMatchObject({ characteristic: "A", value: 6, weapon_type: "ranged" });
    expect(norm("characteristic-set", { subject: "this-model", characteristic: "M", value: 8 })).toEqual({ subject: "this-model", characteristic: "M", value: 8 });
    expect(norm("characteristic-set", { subject: "this-unit", weapon_type: "all", values: [{ characteristic: "A", value: 6 }, { characteristic: "D", value: 2 }] }).values).toHaveLength(2);
  });

  it("refuses a set by weapon keyword with no weapon_type, a name, a list, a model stat or a keyword outside the enum", () => {
    const base = { subject: "this-unit", characteristic: "A", value: 6, weapon_type: "all", weapon_keyword: "Torrent" };
    expect(() => norm("characteristic-set", { ...base, weapon_type: undefined })).toThrow();
    const { weapon_type: _type, ...noType } = base;
    expect(() => norm("characteristic-set", noType)).toThrow(/needs weapon_type/u);
    expect(() => norm("characteristic-set", { ...base, weapon_name: "Zap cannon" })).toThrow(/weapon_name/u);
    expect(() => norm("characteristic-set", { ...base, characteristic: undefined, values: [{ characteristic: "A", value: 6 }, { characteristic: "D", value: 2 }] })).toThrow(/values/u);
    expect(() => norm("characteristic-set", { ...base, characteristic: "M" })).toThrow(/weapon characteristic/u);
    expect(() => norm("characteristic-set", { ...base, weapon_keyword: "Extra Attacks" })).toThrow(/weapon_keyword/u);
  });

  it("accepts a roll modifier for named weapons, and every value the previous version accepted", () => {
    expect(norm("roll-modifier", { roll: "hazard", operation: "add", value: 1, subject: "this-unit", weapon_names: ["Plasma lamp", "Plasma pistol"] }).weapon_names).toHaveLength(2);
    expect(norm("roll-modifier", { roll: "hit", operation: "subtract", value: 1, weapon_name: "Zap cannon" }).weapon_name).toBe("Zap cannon");
    expect(norm("roll-modifier", { roll: "charge", operation: "add", value: 2 })).toEqual({ roll: "charge", operation: "add", value: 2 });
    expect(norm("roll-modifier", { rolls: ["advance", "charge"], operation: "add", value: 1, subject: "this-unit" }).rolls).toHaveLength(2);
    expect(norm("roll-modifier", { roll: "hit", operation: "add", value: 1, weapon_type: "ranged", subject: "this-unit" }).weapon_type).toBe("ranged");
  });

  it("refuses roll-modifier weapon names with a roll that is not made with weapons, rolls, or both selectors", () => {
    expect(() => norm("roll-modifier", { roll: "save", operation: "add", value: 1, weapon_name: "Zap cannon" })).toThrow(/hit, wound, damage, hazard/u);
    expect(() => norm("roll-modifier", { rolls: ["hit", "wound"], operation: "add", value: 1, weapon_name: "Zap cannon" })).toThrow(/rolls/u);
    expect(() => norm("roll-modifier", { roll: "hit", operation: "add", value: 1, weapon_name: "Zap cannon", weapon_names: ["Zap cannon", "Zap blade"] })).toThrow(/cannot combine/u);
    expect(() => norm("roll-modifier", { roll: "hit", operation: "add", value: 1, weapon_names: ["Zap cannon"] })).toThrow(/2 to 8/u);
    expect(() => norm("roll-modifier", { operation: "add", value: 1, weapon_name: "Zap cannon" })).toThrow();
  });
});

describe("a scope that names one weapon: wording checks", () => {
  const scope = (name: string, extra: Record<string, unknown> = {}): [string, Record<string, unknown>] => ["weapon-property-scope", { subject: "this-unit", weapon_type: "all", weapon_name: name, ...extra }];
  const pass = (wording: string, name: string, printed: string, extra: Record<string, unknown> = {}) => {
    const [family, parameters] = scope(name, extra);
    expect(resolved(`${wording} have Lethal Hits.`, [wording, family, parameters]).parameters.weapon_name).toBe(printed);
  };
  const refuses = (wording: string, name: string, message: RegExp) => {
    const [family, parameters] = scope(name);
    expect(() => resolved(`${wording} have Lethal Hits.`, [wording, family, parameters])).toThrow(message);
  };

  it("passes a possessive, a colon after it, a carriage return, a pronoun lead and a singular noun with its verb", () => {
    pass("Your unit's zap cannon weapons", "zap cannon", "Zap cannon");
    pass("this unit's:\rZap cannon weapons", "Zap cannon", "Zap cannon");
    pass("That unit's fab caster weapon has:", "fab caster", "Fab caster");
    pass("its Twin lash weapon", "Twin lash", "Twin lash", { subject: "this-model" });
    pass("all Zap cannon weapons", "Zap cannon", "Zap cannon");
  });

  it("passes a name that holds an apostrophe-s, because names are read before the lead", () => {
    pass("its Hound's tooth weapon", "Hound's tooth", "Hound's tooth", { subject: "this-model" });
  });

  it("refuses a name whose words are absent, an extra word, the wrong noun, a long lead and a semicolon", () => {
    refuses("Your unit's Zap lasgun weapons", "Zap cannon", /does not name Zap cannon/u);
    refuses("this unit's heavy Zap cannon weapons", "Zap cannon", /not weapons: heavy/u);
    refuses("Your unit's Zap cannon attacks", "Zap cannon", /not weapons: attacks/u);
    refuses("one two three four five's Zap cannon weapons", "Zap cannon", /not weapons/u);
    refuses("this unit's; Zap cannon weapons", "Zap cannon", /not weapons/u);
  });

  it("refuses a name outside the lookup pool and a name of the wrong weapon type", () => {
    const text = "Your unit's Zap lasgun weapons have Lethal Hits.";
    const [family, parameters] = scope("Zap lasgun");
    expect(() => resolved(text, ["Your unit's Zap lasgun weapons", family, parameters])).toThrow(/No weapon named Zap lasgun/u);
    expect(() => resolved("Your unit's Zap blade weapons have Lethal Hits.", ["Your unit's Zap blade weapons", family, { ...parameters, weapon_type: "ranged", weapon_name: "Zap blade" }], { ...UNIT, catalog: { faction: FACTION, own: [...OWN, { name: "Zap blade", type: "melee" }] } })).toThrow(/not a ranged weapon/u);
  });
});

describe("a scope that names one weapon: compilation", () => {
  it("grants a keyword to the one printed weapon, whatever case the leaf spells it in", () => {
    const text = "Your unit's zap cannon weapons have the [LETHAL HITS] ability.";
    const mechanics = mechanicsOf(placed(text,
      ["Your unit's zap cannon weapons", "weapon-property-scope", { subject: "this-unit", weapon_type: "all", weapon_name: "zap cannon" }],
      ["have the [LETHAL HITS] ability", "weapon-ability-keyword", { keyword: "Lethal Hits" }]), text, UNIT);
    expect(mechanics.effect.type).toBe("weapon-ability-grant");
    expect(mechanics.effect).toMatchObject({ modifier: { weapons: { name: "Zap cannon" } } });
  });

  it("refuses a name that is not a weapon of the lookup pool", () => {
    const text = "Your unit's zap lasgun weapons have the [LETHAL HITS] ability.";
    expect(refusalOf(placed(text,
      ["Your unit's zap lasgun weapons", "weapon-property-scope", { subject: "this-unit", weapon_type: "all", weapon_name: "zap lasgun" }],
      ["have the [LETHAL HITS] ability", "weapon-ability-keyword", { keyword: "Lethal Hits" }]), text, UNIT)).toMatch(/No weapon named zap lasgun/u);
  });

  it("carries the name to the grant, a Hit roll and the keyword of one weapon, and no roll to the whole unit", () => {
    const text = "That unit's fab caster weapon has the [LETHAL HITS] ability and +1 to Hit rolls.";
    const mechanics = mechanicsOf(placed(text,
      ["That unit's fab caster weapon has", "weapon-property-scope", { subject: "this-unit", weapon_type: "all", weapon_name: "fab caster" }],
      ["the [LETHAL HITS] ability", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
      ["+1 to Hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), text);
    const steps = mechanics.effect.steps as Array<{ type: string; modifier: Record<string, unknown> }>;
    const roll = steps.find((step) => step.type === "roll-modifier")!;
    expect(roll.modifier).toMatchObject({ roll: "hit", operation: "add", value: 1, weapons: { name: "Fab caster" } });
    expect(steps.find((step) => step.type === "weapon-ability-grant")).toMatchObject({ modifier: { weapons: { name: "Fab caster" } } });
  });

  it("carries the name onto a set and both keywords of its own weapon, with the leaf's own name refused as a conflict", () => {
    const text = "Its Twin lash weapon has a Damage characteristic of 3 and the [LETHAL HITS] and [PRECISION] abilities.";
    const pieces = (setParameters: Record<string, unknown>): Piece[] => [
      ["Its Twin lash weapon has", "weapon-property-scope", { subject: "this-model", weapon_type: "all", weapon_name: "Twin lash" }],
      ["a Damage characteristic of 3", "characteristic-set", { subject: "this-model", characteristic: "D", value: 3, weapon_type: "all", ...setParameters }],
      ["[LETHAL HITS]", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
      ["[PRECISION]", "weapon-ability-keyword", { keyword: "Precision" }],
    ];
    const mechanics = mechanicsOf(placed(text, ...pieces({})), text, UNIT);
    const json = JSON.stringify(mechanics);
    expect(json.match(/"weapons":\{"name":"Twin lash"/gu)).toHaveLength(2);
    expect(json).toMatch(/"stat":"D"/u);
    expect(refusalOf(placed(text, ...pieces({ weapon_name: "Twin lash" })), text, UNIT)).toMatch(/weapon selection conflicts/u);
  });

  it("refuses a keyword-selected roll or a removal under a scope that names a weapon, and a roll with a name of its own", () => {
    const text = "Your unit's zap cannon weapons have +1 to Hit rolls made for its Zap cannon weapon.";
    expect(refusalOf(placed(text,
      ["Your unit's zap cannon weapons have", "weapon-property-scope", { subject: "this-unit", weapon_type: "all", weapon_name: "zap cannon" }],
      ["+1 to Hit rolls made for its Zap cannon weapon", "roll-modifier", { roll: "hit", operation: "add", value: 1, weapon_name: "Zap cannon" }]), text, UNIT)).toMatch(/own weapon name conflicts/u);
    const removal = "Your unit's zap cannon weapons do not have the [BLAST] ability.";
    expect(refusalOf(placed(removal,
      ["Your unit's zap cannon weapons", "weapon-property-scope", { subject: "this-unit", weapon_type: "all", weapon_name: "zap cannon" }],
      ["the [BLAST] ability", "weapon-ability-removal", { keyword: "Blast" }]), removal, UNIT)).toMatch(/removal cannot be scoped to named weapons/u);
  });
});

describe("a set by weapon keyword", () => {
  it("lowers characteristic-set with a weapon keyword to a stat-modifier that carries the keyword", () => {
    const text = "Change the Attacks characteristic of Torrent weapons to 6.";
    const mechanics = mechanicsOf(placed(text,
      ["the Attacks characteristic of Torrent weapons to 6", "characteristic-set", { subject: "this-unit", characteristic: "A", value: 6, weapon_type: "all", weapon_keyword: "Torrent" }]), text);
    expect(mechanics.effect).toMatchObject({ type: "stat-modifier", target: "this-unit", modifier: { stat: "A", operation: "set", value: 6, weapons: { keyword: { keyword_id: "torrent" } } } });
    expect(mechanics.effect).not.toHaveProperty("modifier.weapons.type");
  });

  it("keeps the keyword a keyword scope hands a set (a set under it was lowered without the keyword)", () => {
    const text = "Your unit's Torrent weapons have a Attacks characteristic of 6.";
    const mechanics = mechanicsOf(placed(text,
      ["Your unit's Torrent weapons have", "weapon-property-scope", { subject: "this-unit", weapon_type: "all", weapon_keyword: "Torrent" }],
      ["a Attacks characteristic of 6", "characteristic-set", { subject: "this-unit", characteristic: "A", value: 6, weapon_type: "all" }]), text);
    expect(mechanics.effect.modifier).toMatchObject({ stat: "A", operation: "set", value: 6, weapons: { keyword: { keyword_id: "torrent" } } });
  });
});

describe("a roll modifier for named weapons", () => {
  const TEXT = "This unit has +1 to **hazard rolls** made for its Plasma lamp and Plasma pistol weapons.";
  const WORDING = "+1 to **hazard rolls** made for its Plasma lamp and Plasma pistol weapons";
  const roll = (parameters: Record<string, unknown> = {}): Piece => [WORDING, "roll-modifier", { roll: "hazard", operation: "add", value: 1, subject: "this-unit", weapon_names: ["Plasma lamp", "plasma pistol"], ...parameters }];

  it("lowers two names to one hazard roll modifier each, printed", () => {
    const mechanics = mechanicsOf(placed(TEXT, roll()), TEXT, UNIT);
    const steps = mechanics.effect.steps as Array<{ type: string; modifier: Record<string, unknown> }>;
    expect(steps.map((step) => step.type)).toEqual(["roll-modifier", "roll-modifier"]);
    expect(steps.map((step) => step.modifier.weapons)).toEqual([{ name: "Plasma lamp" }, { name: "Plasma pistol" }]);
    expect(steps.every((step) => step.modifier.roll === "hazard" && step.modifier.value === 1)).toBe(true);
  });

  it("lowers one name to one modifier carrying it", () => {
    const text = "This unit has +1 to **hit rolls** made with its Zap cannon weapon.";
    const wording = "+1 to **hit rolls** made with its Zap cannon weapon";
    const mechanics = mechanicsOf(placed(text, [wording, "roll-modifier", { roll: "hit", operation: "add", value: 1, subject: "this-unit", weapon_type: "all", weapon_name: "zap cannon" }]), text, UNIT);
    expect(mechanics.effect).toMatchObject({ type: "roll-modifier", modifier: { roll: "hit", weapons: { name: "Zap cannon" } } });
  });

  it("refuses a span that stops at the roll phrase, so the names are not in the leaf's wording", () => {
    const only = "This unit has +1 to **hazard rolls** made for its Plasma lamp and Plasma pistol weapons.";
    expect(refusalOf(placed(only, ["+1 to **hazard rolls**", "roll-modifier", roll()[2]]), only, UNIT)).toMatch(/does not name Plasma lamp/u);
  });

  const refusesWording = (wording: string, parameters: Record<string, unknown>, message: RegExp) => {
    const text = `This unit has ${wording}.`;
    expect(() => resolved(text, [wording, "roll-modifier", { roll: "hazard", operation: "add", value: 1, subject: "this-unit", weapon_names: ["Plasma lamp", "Plasma pistol"], ...parameters }])).toThrow(message);
  };

  it("refuses a wording whose roll word, connective, owner, amount or sign differs from the leaf", () => {
    refusesWording("+1 to wound rolls made for its Plasma lamp and Plasma pistol weapons", {}, /wound roll, not the leaf's hazard/u);
    refusesWording("+1 to hazard rolls made against its Plasma lamp and Plasma pistol weapons", {}, /names weapons as/u);
    refusesWording("+1 to hazard rolls made for Plasma lamp and Plasma pistol weapons", {}, /names weapons as/u);
    refusesWording("+2 to hazard rolls made for its Plasma lamp and Plasma pistol weapons", {}, /amount does not match/u);
    refusesWording("-1 to hazard rolls made for its Plasma lamp and Plasma pistol weapons", {}, /sign does not match/u);
    refusesWording("+1 to hazard rolls made for its Plasma lamp and Plasma pistol weapons", { operation: "subtract" }, /sign does not match/u);
    refusesWording("\u22121 to hazard rolls made for its Plasma lamp and Plasma pistol weapons", { operation: "subtract" }, /names weapons as/u);
    refusesWording("+1 to hazard rolls made for its heavy Plasma lamp and Plasma pistol weapons", {}, /not weapons: heavy/u);
  });

  it("passes the same wording with every emphasis mark removed", () => {
    const wording = "+1 to hazard rolls made for its Plasma lamp and Plasma pistol weapons";
    const text = `This unit has ${wording}.`;
    expect(resolved(text, [wording, "roll-modifier", { roll: "hazard", operation: "add", value: 1, subject: "this-unit", weapon_names: ["Plasma lamp", "Plasma pistol"] }]).parameters.weapon_names).toEqual(["Plasma lamp", "Plasma pistol"]);
  });
});

describe("reviewed source keyword lowering", () => {
  it("emits catalog references without depending on a runtime string parser", () => {
    expect(keywordRef("Anti-Infantry 3PLUS")).toEqual({ keyword_id: "anti", parameters: { target_keyword: "INFANTRY", threshold: 3 } });
    expect(keywordRef("Anti-Vehicle")).toEqual({ keyword_id: "anti", parameters: { target_keyword: "VEHICLE" } });
    expect(keywordRef("Sustained Hits D3")).toEqual({ keyword_id: "sustained-hits", parameters: { value: "D3" } });
    expect(keywordRef("Blast 1")).toEqual({ keyword_id: "blast", parameters: { value: 1 } });
    expect(keywordRef("Twin Linked")).toEqual({ keyword_id: "twin-linked" });
  });
});
