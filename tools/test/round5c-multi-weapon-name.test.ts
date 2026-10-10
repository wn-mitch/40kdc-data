import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import type { WeaponCatalog } from "../src/round5c/weapon-catalog.js";

/**
 * Named weapons: a scope, a stat change or a grant that names each weapon it covers, and "those
 * weapons" bound to the names an earlier leaf gave. Every weapon is fabricated; the wording and the
 * catalog are invented for the tests.
 */

/** Leaves on their own wording in `text`, in order. */
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

const FACTION: WeaponCatalog["faction"] = [
  { name: "Zap lascannon", type: "ranged" }, { name: "Zap lasgun", type: "ranged" }, { name: "Zap pistol", type: "ranged" },
  { name: "Zap marksman rifle", type: "ranged" }, { name: "Zap volley‐gun", type: "ranged" }, { name: "Zap sentry volley‐gun", type: "ranged" },
  { name: "Zap cannon", type: "ranged" }, { name: "Zap missile", type: "ranged" }, { name: "Zap blade", type: "melee" },
  { name: "Zap stompers", type: "melee" }, { name: "Zap crushers", type: "melee" },
  { name: "Zap rifle", type: "ranged" }, { name: "Zap Rifle", type: "ranged" },
  { name: "Fab lance of dawn", type: "melee" }, { name: "Fab caster", type: "ranged" },
  { name: "Ion carbine", type: "ranged" }, { name: "Ion lance", type: "ranged" },
];
/** A unit's own weapons: the datasheets that carry the record's ability. */
const OWN: WeaponCatalog["faction"] = [
  { name: "Zap cannon", type: "ranged" }, { name: "Zap missile", type: "ranged" }, { name: "Zap blade", type: "melee" },
  { name: "Fab lance of dawn", type: "melee" }, { name: "Fab caster", type: "ranged" },
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

const ENEMY_RANGE = [
  ["an enemy unit", "unit-filter", { side: "enemy" }],
  ["within 12\"", "unit-position", { kind: "within", inches: 12, of: "attacker", subject: "target", negated: false }],
] as Array<[string, string, Record<string, unknown>]>;

// 7164: six named weapons, a target gate, and a stat change on each weapon named.
const SIX_NAMED = "Your unit's Zap lascannons, Zap lasguns, Zap pistols, Zap marksman rifles, Zap volley‑guns and Zap sentry volley‑guns weapons";
const SIX_NAMES = ["Zap lascannon", "Zap lasgun", "Zap pistol", "Zap marksman rifle", "Zap volley‑gun", "Zap sentry volley‑gun"];

function sixNamedText(scope: string): string {
  return `${scope} that targeted an enemy unit within 12" have +1 S and AP.`;
}

describe("Round 5C named weapons: scope over a target gate", () => {
  it("lowers six named weapons under one attacker-distance gate, one stat step per weapon and stat", () => {
    const text = sixNamedText(SIX_NAMED);
    const mechanics = mechanicsOf(placed(text,
      [SIX_NAMED, "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged", weapon_names: SIX_NAMES }],
      ["that targeted", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ...ENEMY_RANGE.map(([w, f, p]) => [w, f, p] as [string, string, Record<string, unknown>]),
      ["+1 S and AP", "characteristic-modifier", { characteristics: ["S", "AP"], operation: "improve", value: 1, weapon_type: "ranged" }]), text);
    expect(mechanics.effect.type).toBe("conditional");
    expect(mechanics.effect.condition).toEqual({ type: "within", parameters: { subject: "defender", of: "attacker", range: { inches: 12 } } });
    const steps = mechanics.effect.effect.steps as Array<{ modifier: Record<string, unknown> }>;
    expect(steps).toHaveLength(12);
    expect(steps.map((step) => `${String(step.modifier.stat)}:${String(step.modifier.weapon_name)}`)).toContain("AP:Zap sentry volley‐gun");
    expect(steps.every((step) => step.modifier.weapon_type === "ranged")).toBe(true);
  });

  it("emits the printed spelling of a name, not the spelling the wording uses", () => {
    const text = sixNamedText(SIX_NAMED);
    const mechanics = mechanicsOf(placed(text,
      [SIX_NAMED, "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged", weapon_names: SIX_NAMES }],
      ["that targeted", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ...ENEMY_RANGE.map(([w, f, p]) => [w, f, p] as [string, string, Record<string, unknown>]),
      ["+1 S and AP", "characteristic-modifier", { characteristics: ["S", "AP"], operation: "improve", value: 1, weapon_type: "ranged" }]), text);
    const names = (mechanics.effect.effect.steps as Array<{ modifier: { weapon_name: string } }>).map((step) => step.modifier.weapon_name);
    expect(names).toContain("Zap volley‐gun");
    expect(names).not.toContain("Zap volley‑gun");
  });

  it("refuses a five-name list whose sixth weapon is still in the wording", () => {
    const text = sixNamedText(SIX_NAMED);
    const message = refusalOf(placed(text,
      [SIX_NAMED, "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged", weapon_names: SIX_NAMES.slice(0, 5) }],
      ["that targeted", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ...ENEMY_RANGE.map(([w, f, p]) => [w, f, p] as [string, string, Record<string, unknown>]),
      ["+1 S and AP", "characteristic-modifier", { characteristics: ["S", "AP"], operation: "improve", value: 1, weapon_type: "ranged" }]), text);
    expect(message).toMatch(/words that are not weapons: zap, sentry, volley-guns\./u);
  });

  it("refuses an attack gate whose unit is not the scope's own unit", () => {
    const text = sixNamedText(SIX_NAMED);
    const message = refusalOf(placed(text,
      [SIX_NAMED, "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged", weapon_names: SIX_NAMES }],
      ["that targeted", "attack", { direction: "makes", unit: "enemy-unit", attack_type: "any" }],
      ...ENEMY_RANGE.map(([w, f, p]) => [w, f, p] as [string, string, Record<string, unknown>]),
      ["+1 S and AP", "characteristic-modifier", { characteristics: ["S", "AP"], operation: "improve", value: 1, weapon_type: "ranged" }]), text);
    expect(message).toMatch(/needs a following weapon property/u);
  });

  it("keeps the side-only enemy refusal for a unit-filter that is not a scope's gate", () => {
    const text = "An enemy unit is affected.";
    const message = refusalOf(placed(text, ["An enemy unit", "unit-filter", { side: "enemy" }]), text);
    expect(message).toMatch(/A unit-filter needs a select-unit or attack right before it/u);
  });
});

describe("Round 5C named weapons: lookup and spelling", () => {
  it("refuses a name that is not a weapon of the lookup scope", () => {
    const text = "Your unit's Zap cannons and Ion carbines weapons have +1 A.";
    const message = refusalOf(placed(text,
      ["Your unit's Zap cannons and Ion carbines weapons", "weapon-property-scope", { subject: "this-model", weapon_type: "ranged", weapon_names: ["Zap cannon", "Ion carbine"] }],
      ["have +1 A", "characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1, weapon_type: "ranged" }]), text, UNIT);
    expect(message).toMatch(/No weapon named Ion carbine in this lookup scope/u);
  });

  it("refuses two printed spellings of one name", () => {
    const text = "Your unit's zap rifles and Zap cannons weapons have Lethal Hits.";
    const message = refusalOf(placed(text,
      ["Your unit's zap rifles and Zap cannons weapons", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged", weapon_names: ["Zap rifle", "Zap cannon"] }],
      ["have Lethal Hits", "weapon-ability-keyword", { keyword: "Lethal Hits" }]), text);
    expect(message).toMatch(/printed with 2 spellings/u);
  });

  it("refuses a three-name list whose one folded name has two printed spellings", () => {
    const text = "Your unit's zap rifles, Zap cannons and Zap missiles weapons have Lethal Hits.";
    const message = refusalOf(placed(text,
      ["Your unit's zap rifles, Zap cannons and Zap missiles weapons", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged", weapon_names: ["Zap rifle", "Zap cannon", "Zap missile"] }],
      ["have Lethal Hits", "weapon-ability-keyword", { keyword: "Lethal Hits" }]), text);
    expect(message).toMatch(/printed with 2 spellings/u);
  });

  it("refuses a melee name under a ranged weapon type", () => {
    const text = "Your unit's Zap blades and Zap lasguns weapons have +1 A.";
    const message = refusalOf(placed(text,
      ["Your unit's Zap blades and Zap lasguns weapons", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged", weapon_names: ["Zap blade", "Zap lasgun"] }],
      ["have +1 A", "characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1, weapon_type: "ranged" }]), text);
    expect(message).toMatch(/Zap blade is not a ranged weapon/u);
  });

  it("refuses a name whose words are absent from the wording", () => {
    const text = "Your unit's Zap lasguns and Zap pistols weapons have +1 A.";
    const message = refusalOf(placed(text,
      ["Your unit's Zap lasguns and Zap pistols weapons", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged", weapon_names: ["Zap lasgun", "Zap cannon"] }],
      ["have +1 A", "characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1, weapon_type: "ranged" }]), text);
    expect(message).toMatch(/does not name Zap cannon/u);
  });

  it("refuses a joined name that matches no weapon", () => {
    const text = "This model's Zap cannon and Zap missiles weapons have Lethal Hits.";
    const message = refusalOf(placed(text,
      ["This model's Zap cannon and Zap missiles weapons", "weapon-property-scope", { subject: "this-model", weapon_type: "ranged", weapon_names: ["Zap cannon and Zap missile", "Zap cannon"] }],
      ["have Lethal Hits", "weapon-ability-keyword", { keyword: "Lethal Hits" }]), text, UNIT);
    expect(message).toMatch(/No weapon named Zap cannon and Zap missile|words that are not weapons/u);
  });

  it("looks a unit's own weapons up for a this-model subject on a unit ability, and the faction otherwise", () => {
    const text = "This model's Ion carbine and Ion lance have Lethal Hits.";
    const own = refusalOf(placed(text,
      ["This model's Ion carbine and Ion lance", "weapon-property-scope", { subject: "this-model", weapon_type: "ranged", weapon_names: ["Ion carbine", "Ion lance"] }],
      ["have Lethal Hits", "weapon-ability-keyword", { keyword: "Lethal Hits" }]), text, UNIT);
    expect(own).toMatch(/No weapon named Ion carbine/u);
    const faction = mechanicsOf(placed(text,
      ["This model's Ion carbine and Ion lance", "weapon-property-scope", { subject: "this-model", weapon_type: "ranged", weapon_names: ["Ion carbine", "Ion lance"] }],
      ["have Lethal Hits", "weapon-ability-keyword", { keyword: "Lethal Hits" }]), text, { ...UNIT, source_type: "enhancement" });
    expect(faction.effect.type).toBe("sequence");
  });

  it("refuses named weapons with no faction context to look them up in", () => {
    const text = "Your unit's Zap lasguns and Zap pistols weapons have +1 A.";
    const result = compileLeaves(placed(text,
      ["Your unit's Zap lasguns and Zap pistols weapons", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged", weapon_names: ["Zap lasgun", "Zap pistol"] }],
      ["have +1 A", "characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1, weapon_type: "ranged" }]), text);
    expect(result.ok).toBe(false);
  });
});

describe("Round 5C named weapons: stat change, grant and binder", () => {
  it("puts a named stat change inside the optional-use gate of the record (the 'If you do' wording)", () => {
    const text = "Each time this model's unit is selected to shoot, you can discard 1 Miracle dice. If you do, until the end of the phase, add 3 to the Attacks characteristic of Zap blade and Fab lance of dawn.";
    const mechanics = mechanicsOf(placed(text,
      ["Each time this model's unit is selected to shoot", "event", { kind: "selected", to: "shoot", subject: "this-unit" }],
      ["you can", "optional-use", { who: "you" }],
      ["discard 1 Miracle dice", "resource-spend", { pool: "miracle-dice-pool", amount: 1 }],
      ["until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["Zap blade and Fab lance of dawn", "characteristic-modifier", { characteristics: ["A"], operation: "add", value: 3, subject: "this-model", weapon_type: "all", weapon_names: ["Zap blade", "Fab lance of dawn"] }]), text, UNIT);
    expect(mechanics.trigger.optional).toBe(true);
    expect(mechanics.effect.steps[0].type).toBe("resource-spend");
    const stats = mechanics.effect.steps[1].steps as Array<{ modifier: Record<string, unknown> }>;
    expect(stats.map((step) => step.modifier.weapon_name)).toEqual(["Zap blade", "Fab lance of dawn"]);
    expect(stats.every((step) => step.modifier.weapon_type === undefined)).toBe(true);
  });

  it("gives a named enhancement change to the disembarked unit, looking the names up in the faction only", () => {
    const text = "When a friendly unit embarked within this unit disembarks, that friendly unit's Zap lasguns and Zap pistols weapons have +1 A.";
    const mechanics = mechanicsOf(placed(text,
      ["a friendly unit", "unit-filter", { side: "friendly" }],
      ["embarked within this unit disembarks", "event", { kind: "disembarked" }],
      ["that friendly unit's Zap lasguns and Zap pistols weapons", "weapon-property-scope", { subject: "antecedent", weapon_type: "ranged", weapon_names: ["Zap lasgun", "Zap pistol"] }],
      ["have +1 A", "characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1 }]), text,
    { faction_id: "fab", source_type: "enhancement", catalog: { faction: FACTION, own: [] } });
    expect(mechanics.trigger.event).toBe("disembarked");
    const stats = mechanics.effect.steps as Array<{ target: unknown; modifier: Record<string, unknown> }>;
    expect(stats.map((step) => step.modifier.weapon_name)).toEqual(["Zap lasgun", "Zap pistol"]);
    expect(stats.every((step) => step.target === "event-subject")).toBe(true);
  });

  it("emits no duration for a named enhancement change the record prints no duration for", () => {
    const text = "When a friendly unit embarked within this unit disembarks, that friendly unit's Zap lasguns and Zap pistols weapons have +1 A.";
    const mechanics = mechanicsOf(placed(text,
      ["a friendly unit", "unit-filter", { side: "friendly" }],
      ["embarked within this unit disembarks", "event", { kind: "disembarked" }],
      ["that friendly unit's Zap lasguns and Zap pistols weapons", "weapon-property-scope", { subject: "antecedent", weapon_type: "ranged", weapon_names: ["Zap lasgun", "Zap pistol"] }],
      ["have +1 A", "characteristic-modifier", { characteristics: ["A"], operation: "improve", value: 1 }]), text,
    { faction_id: "fab", source_type: "enhancement", catalog: { faction: FACTION, own: [] } });
    // "permanent" is the compiler's no-duration scope; an inferred end-of-phase or end-of-turn would fail here.
    expect(mechanics.scope.duration).toBe("permanent");
    expect(JSON.stringify(mechanics)).not.toMatch(/end-of-phase|end-of-turn|"duration":"(phase|turn|battle)"/u);
  });

  it("takes both names of a half-range condition as one conditional over two grants", () => {
    const text = "This model's Zap cannon and Zap missiles have Lethal Hits while targeting a unit within half range.";
    const mechanics = mechanicsOf(placed(text,
      ["This model's Zap cannon and Zap missiles", "weapon-property-scope", { subject: "this-model", weapon_type: "ranged", weapon_names: ["Zap cannon", "Zap missile"] }],
      ["have Lethal Hits", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
      ["while targeting a unit within half range", "unit-position", { kind: "within", distance: "half-weapon", of: "attacker", subject: "target", negated: false }]), text, UNIT);
    expect(mechanics.effect.condition).toEqual({ type: "within", parameters: { subject: "defender", of: "attacker", range: "half-weapon" } });
    const grants = mechanics.effect.effect.steps as Array<{ type: string; modifier: Record<string, unknown> }>;
    expect(grants.map((grant) => grant.modifier.weapon_name)).toEqual(["Zap cannon", "Zap missile"]);
    expect(grants.every((grant) => grant.type === "weapon-ability-grant" && grant.modifier.abilities !== undefined)).toBe(true);
  });

  it("grants the ability to each named weapon, never to every weapon of the type", () => {
    const text = "Until the end of the phase, all Zap cannons, Zap missiles and Zap lascannons equipped by models in your unit have the [PSYCHIC] ability.";
    const mechanics = mechanicsOf(placed(text,
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["all Zap cannons, Zap missiles and Zap lascannons equipped by models in your unit", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged", weapon_names: ["Zap cannon", "Zap missile", "Zap lascannon"] }],
      ["have the [PSYCHIC] ability", "weapon-ability-keyword", { keyword: "Psychic" }]), text);
    const grants = mechanics.effect.steps as Array<{ modifier: Record<string, unknown> }>;
    expect(grants.map((grant) => grant.modifier.weapon_name)).toEqual(["Zap cannon", "Zap missile", "Zap lascannon"]);
    expect(grants.every((grant) => grant.modifier.weapon_type === "ranged" && grant.modifier.abilities !== undefined)).toBe(true);
  });

  it("gives 'those weapons' the names of the earlier named-weapon leaves, printed", () => {
    const text = "Fight phase. The Attacks characteristic of Zap stompers is 8. The Attacks characteristic of Zap crushers is 12. Improve the Armour Penetration characteristic of those weapons by 1.";
    const mechanics = mechanicsOf(placed(text,
      ["Fight phase", "use-window", { your_phases: [], opponent_phases: [], either_phases: ["fight"] }],
      ["The Attacks characteristic of Zap stompers is 8", "characteristic-set", { subject: "this-model", characteristic: "A", value: 8, weapon_type: "melee", weapon_name: "zap stompers" }],
      ["The Attacks characteristic of Zap crushers is 12", "characteristic-set", { subject: "this-model", characteristic: "A", value: 12, weapon_type: "melee", weapon_name: "zap crushers" }],
      ["Improve the Armour Penetration characteristic of those weapons by 1", "characteristic-modifier", { characteristics: ["AP"], operation: "improve", value: 1, subject: "this-model", weapon_type: "melee", weapon: "earlier-named" }]), text);
    const steps = JSON.stringify(mechanics);
    expect(steps).toContain('"weapon_name":"Zap stompers"');
    expect(steps).toContain('"weapon_name":"Zap crushers"');
  });

  it("refuses 'those weapons' with no earlier named-weapon leaf, or with earlier leaves of two recipients", () => {
    const text = "Improve the Armour Penetration characteristic of those weapons by 1.";
    const alone = refusalOf(placed(text,
      ["Improve the Armour Penetration characteristic of those weapons by 1", "characteristic-modifier", { characteristics: ["AP"], operation: "improve", value: 1, subject: "this-model", weapon_type: "melee", weapon: "earlier-named" }]), text);
    expect(alone).toMatch(/has no earlier named-weapon leaf/u);
    const mixed = "Set A to 8 for Zap stompers. Set A to 12 for Zap crushers. Improve AP of those weapons by 1.";
    const message = refusalOf(placed(mixed,
      ["Set A to 8 for Zap stompers", "characteristic-set", { subject: "this-model", characteristic: "A", value: 8, weapon_type: "melee", weapon_name: "zap stompers" }],
      ["Set A to 12 for Zap crushers", "characteristic-set", { subject: "this-unit", characteristic: "A", value: 12, weapon_type: "melee", weapon_name: "zap crushers" }],
      ["Improve AP of those weapons by 1", "characteristic-modifier", { characteristics: ["AP"], operation: "improve", value: 1, subject: "this-model", weapon_type: "melee", weapon: "earlier-named" }]), mixed);
    expect(message).toMatch(/different recipients or weapon types/u);
  });

  it("refuses a weapon roll after a named scope, since the roll modifier takes no weapon name", () => {
    const text = "Your unit's Zap lasguns and Zap pistols weapons have +1 to Hit rolls.";
    const message = refusalOf(placed(text,
      ["Your unit's Zap lasguns and Zap pistols weapons", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged", weapon_names: ["Zap lasgun", "Zap pistol"] }],
      ["have +1 to Hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), text);
    expect(message).toMatch(/A roll modifier cannot be scoped to named weapons/u);
  });

  it("refuses a weapon ability removal after a named scope, since the removal takes no weapon name", () => {
    const text = "Your unit's Zap lasguns and Zap pistols weapons do not have Blast.";
    const message = refusalOf(placed(text,
      ["Your unit's Zap lasguns and Zap pistols weapons", "weapon-property-scope", { subject: "this-unit", weapon_type: "ranged", weapon_names: ["Zap lasgun", "Zap pistol"] }],
      ["do not have Blast", "weapon-ability-removal", { keyword: "Blast" }]), text);
    expect(message).toMatch(/A weapon ability removal cannot be scoped to named weapons/u);
  });
});

describe("Round 5C named weapons: family versions refuse what they cannot say", () => {
  const scope = { subject: "this-unit", weapon_type: "ranged", weapon_names: ["Zap lasgun", "Zap pistol"] };
  const version = (family: string) => currentFamilyVersion(family);

  it("weapon-property-scope takes two to eight names with a weapon_type, and nothing else that names weapons", () => {
    const v = version("weapon-property-scope");
    expect(normalizeFingerprintParameters("weapon-property-scope", scope, v)).toMatchObject({ weapon_names: ["Zap lasgun", "Zap pistol"] });
    expect(normalizeFingerprintParameters("weapon-property-scope", { ...scope, weapon_type: "all" }, v)).toMatchObject({ weapon_type: "all" });
    expect(() => normalizeFingerprintParameters("weapon-property-scope", { ...scope, weapon_name: "Zap lasgun" }, v)).toThrow();
    expect(() => normalizeFingerprintParameters("weapon-property-scope", { ...scope, weapon_keyword: "Blast" }, v)).toThrow();
    expect(() => normalizeFingerprintParameters("weapon-property-scope", { ...scope, weapon: "antecedent" }, v)).toThrow();
    expect(() => normalizeFingerprintParameters("weapon-property-scope", { ...scope, weapon_names: ["Zap lasgun"] }, v)).toThrow();
    expect(() => normalizeFingerprintParameters("weapon-property-scope", { ...scope, weapon_names: ["Zap lasgun", "Zap lasgun"] }, v)).toThrow();
    expect(() => normalizeFingerprintParameters("weapon-property-scope", { subject: "this-unit", weapon_names: ["Zap lasgun", "Zap pistol"] }, v)).toThrow();
  });

  it("characteristic-modifier takes names or earlier-named, each with a weapon_type, and never with a single weapon name", () => {
    const v = version("characteristic-modifier");
    const base = { subject: "this-model", characteristics: ["A"], operation: "add", value: 3 };
    expect(normalizeFingerprintParameters("characteristic-modifier", { ...base, weapon_type: "all", weapon_names: ["Zap lasgun", "Zap pistol"] }, v)).toMatchObject({ weapon_names: ["Zap lasgun", "Zap pistol"] });
    expect(normalizeFingerprintParameters("characteristic-modifier", { ...base, weapon_type: "melee", weapon: "earlier-named" }, v)).toMatchObject({ weapon: "earlier-named" });
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { ...base, weapon_names: ["Zap lasgun", "Zap pistol"] }, v)).toThrow();
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { ...base, weapon_type: "all", weapon_name: "Zap lasgun", weapon_names: ["Zap lasgun", "Zap pistol"] }, v)).toThrow();
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { ...base, weapon_type: "melee", weapon: "earlier-named", weapon_name: "Zap blade" }, v)).toThrow();
    expect(() => normalizeFingerprintParameters("characteristic-modifier", { ...base, weapon_type: "all", weapon_names: ["Zap lasgun", "Zap pistol"], weapon: "antecedent" }, v)).toThrow();
  });

  it("unit-position takes half-weapon only as a within distance measured from the attacker", () => {
    const v = version("unit-position");
    const half = { kind: "within", distance: "half-weapon", of: "attacker", subject: "target", negated: false };
    expect(normalizeFingerprintParameters("unit-position", half, v)).toEqual({ kind: "within", distance: "half-weapon", of: "attacker", subject: "target", negated: false });
    expect(() => normalizeFingerprintParameters("unit-position", { ...half, inches: 6 }, v)).toThrow();
    expect(() => normalizeFingerprintParameters("unit-position", { ...half, range_ref: "synapse" }, v)).toThrow();
    expect(() => normalizeFingerprintParameters("unit-position", { ...half, kind: "beyond" }, v)).toThrow();
    expect(() => normalizeFingerprintParameters("unit-position", { ...half, of: "this-unit" }, v)).toThrow();
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "within", distance: "half-weapon", subject: "target", negated: false }, v)).toThrow();
    expect(() => normalizeFingerprintParameters("unit-position", { ...half, distance: "quarter-weapon" }, v)).toThrow();
  });

  it("refuses a weapon distance in a record with no weapon to measure it with", () => {
    const text = "Within half range of the attacker.";
    const message = refusalOf(placed(text,
      ["Within half range of the attacker", "unit-position", { kind: "within", distance: "half-weapon", of: "attacker", subject: "target", negated: false }]), text);
    expect(message).toMatch(/needs a weapon in the same ability/u);
  });
});

describe("Round 5C named weapons: a choice of keywords over named weapons", () => {
  it("makes each keyword option a sequence over the named weapons", () => {
    const text = "Your unit's Zap cannons and Zap missiles weapons have Lethal Hits or Sustained Hits.";
    const mechanics = mechanicsOf(placed(text,
      ["Your unit's Zap cannons and Zap missiles weapons have Lethal Hits or Sustained Hits", "weapon-ability-grant", { subject: "this-unit", weapon_type: "ranged", weapon_names: ["Zap cannon", "Zap missile"], keywords: ["Lethal Hits", "Sustained Hits"], keyword_choice: true }]), text, UNIT);
    expect(mechanics.effect.type).toBe("choice");
    for (const option of mechanics.effect.options as Array<{ type: string; steps: Array<{ modifier: Record<string, unknown> }> }>) {
      expect(option.type).toBe("sequence");
      expect(option.steps.map((step) => step.modifier.weapon_name)).toEqual(["Zap cannon", "Zap missile"]);
    }
  });
});
