import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { compileLeaves, leafFragment, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { previewLeaf } from "../src/round5c/leaf-preview.js";
import { canonicalAbilityId, ownAbilityIds, type AbilityIdentity } from "../src/round5c/own-abilities.js";

// Fabricated wording, keywords and ability ids only; no GW rule prose.

// Vite cannot resolve the node:sqlite builtin by import; require it, as the other workbench tests do.
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };

type Item = [string, string, Record<string, unknown>];
const OWN = "dread-howl";

/** Leaves on their own wording in `text`, in order, normalized at the current version of their family. */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

/** `abilityId` null compiles with no record id. */
function mechanicsOf(list: CompileLeaf[], text: string, abilityId: string | null = OWN): Record<string, any> {
  const result = compileLeaves(list, text, abilityId === null ? {} : { abilityId });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(list: CompileLeaf[], text: string, abilityId: string | null = OWN): string {
  const result = compileLeaves(list, text, abilityId === null ? {} : { abilityId });
  if (result.ok) throw new Error(`compiled: ${JSON.stringify(result.mechanics)}`);
  return result.errors.join("; ");
}

/** Every canonical ability-membership condition node in a tree. */
function hasAbilityNodes(tree: unknown): Array<Record<string, any>> {
  if (Array.isArray(tree)) return tree.flatMap(hasAbilityNodes);
  if (tree === null || typeof tree !== "object") return [];
  const node = tree as Record<string, any>;
  return [...(node.type === "matches" && Array.isArray(node.parameters?.filter?.has_ability) ? [node] : []), ...Object.values(node).flatMap(hasAbilityNodes)];
}

const thisAbility: Item = ["with this ability", "unit-has-ability", { subject: "antecedent", own: true }];
const engagedWith = (wording: string): Item => [wording, "unit-state", { states: ["engaged"], subject: "antecedent", negated: false, with: "following-filter" }];
const battleShock = (wording: string, target: string): Item => [wording, "test", { target, test: "battle-shock" }];

describe("Round 5C holder abilities: the other unit of an engagement or distance", () => {
  it("puts \"one or more units with this ability\" on the engagement's other unit, friendly when no owner is printed", () => {
    const text = "In your Command phase, each enemy unit within Engagement Range of one or more units with this ability must take a Battle-shock test.";
    const mechanics = mechanicsOf(placed(text,
      ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
      ["each", "for-each-unit-select", {}],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      engagedWith("within Engagement Range of one or more"),
      ["units", "unit-filter", { side: "any" }],
      thisAbility,
      battleShock("must take a Battle-shock test", "antecedent")), text);
    const loop = mechanics.effect.effect;
    expect(loop.type).toBe("for-each-unit");
    expect(loop.effect.condition).toEqual({ type: "matches", parameters: { subject: "recipient", filter: { engaged_with: { owner: "friendly", has_ability: [OWN] } } } });
    // The ability is the holder's, never asked of the enemy unit.
    expect(hasAbilityNodes(mechanics)).toEqual([]);
    // Once for the army: one test per enemy unit per phase, however many holders there are.
    expect(mechanics.usage).toEqual({ frequency: "once-per-phase", per: "army" });
  });

  it("binds a moment's condition to the moment's unit through an exclusion, and gives a recurring moment no allowance", () => {
    const text = "Each time an enemy unit (excluding TITANS) within Engagement Range of one or more units from your army with this ability Falls Back, that unit must take a Battle-shock test.";
    const mechanics = mechanicsOf(placed(text,
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["(excluding TITANS)", "unit-filter", { side: "enemy", excluded_keywords: ["TITAN"] }],
      engagedWith("within Engagement Range of one or more"),
      ["units", "unit-filter", { side: "friendly" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      thisAbility,
      ["Falls Back", "event", { kind: "move-ended", move_types: ["fall-back"] }],
      battleShock("that unit must take a Battle-shock test", "antecedent")), text);
    expect(mechanics.trigger.subject).toEqual({ owner: "enemy", none_of: ["TITAN"] });
    expect(mechanics.effect.condition.parameters).toEqual({ subject: "event-subject", filter: { engaged_with: { owner: "friendly", has_ability: [OWN] } } });
    expect(mechanics.effect.effect.target).toBe("event-subject");
    expect(mechanics.usage).toBeUndefined();
  });

  it("measures a distance to the army's models with the ability", () => {
    const text = "At the start of your Shooting phase, each enemy unit within 9\" of one or more models with this ability suffers 1 mortal wound.";
    const mechanics = mechanicsOf(placed(text,
      ["At the start of your Shooting phase", "event", { kind: "phase-start", phase: "shooting", turn: "your" }],
      ["each", "for-each-unit-select", {}],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["within 9\" of one or more", "unit-position", { kind: "within", inches: 9, of: "following-filter", subject: "antecedent", negated: false }],
      ["models", "unit-filter", { side: "any", level: "model" }],
      thisAbility,
      ["suffers 1 mortal wound", "mortal-wounds", { recipient: "antecedent", count: "1" }]), text);
    expect(mechanics.effect.effect.condition).toEqual({ type: "matches", parameters: { subject: "recipient", filter: { within: { of: { owner: "friendly", level: "model", has_ability: [OWN] }, range: { inches: 9 } } } } });
    expect(mechanics.usage).toEqual({ frequency: "once-per-phase", per: "army" });
  });

  it("names another ability by its id, keeping the printed side", () => {
    const text = "Each enemy unit within Engagement Range of one or more enemy units with the Gloom Veil ability must take a Battle-shock test.";
    const mechanics = mechanicsOf(placed(text,
      ["Each", "for-each-unit-select", {}],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      engagedWith("within Engagement Range of one or more"),
      ["enemy units", "unit-filter", { side: "enemy" }],
      ["with the Gloom Veil ability", "unit-has-ability", { subject: "antecedent", ability: "gloom-veil" }],
      battleShock("must take a Battle-shock test", "antecedent")), text);
    expect(mechanics.effect.effect.condition.parameters.filter.engaged_with).toEqual({ owner: "enemy", has_ability: ["gloom-veil"] });
    // Not the record's own holders: no army allowance.
    expect(mechanics.usage).toBeUndefined();
  });
});

describe("Round 5C holder abilities: presence, moments and recipients", () => {
  it("gates on a holder being on the battlefield, once for the army", () => {
    const text = "In your Command phase, if one or more models from your army with this ability are on the battlefield, you gain 1CP.";
    const mechanics = mechanicsOf(placed(text,
      ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
      ["models", "unit-filter", { side: "friendly", level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      thisAbility,
      ["are on the battlefield", "unit-state", { states: ["on-battlefield"], subject: "antecedent", negated: false }],
      ["you gain 1CP", "resource-gain", { pool: "cp", amount: 1 }]), text);
    expect(mechanics.effect.condition.operands[1]).toEqual({ type: "matches", parameters: { subject: { owner: "friendly", level: "model", has_ability: [OWN] }, filter: { state: "on-battlefield" } } });
    expect(hasAbilityNodes(mechanics)).toEqual([]);
    expect(mechanics.usage).toEqual({ frequency: "once-per-phase", per: "army" });
  });

  it("makes a printed \"Once per turn\" about a holder's moment a whole-army allowance", () => {
    const text = "Once per turn, after one model from your army with this ability has shot, that unit must take a Battle-shock test.";
    const mechanics = mechanicsOf(placed(text,
      ["Once per turn", "usage-limit", { frequency: "once-per-turn" }],
      ["model", "unit-filter", { side: "friendly", level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      thisAbility,
      ["has shot", "event", { kind: "after-shooting" }],
      battleShock("that unit must take a Battle-shock test", "event-subject")), text);
    expect(mechanics.trigger.subject).toEqual({ owner: "friendly", level: "model", has_ability: [OWN] });
    expect(mechanics.usage).toEqual({ frequency: "once-per-turn", per: "army" });
  });

  it("refuses a printed per-unit limit on a holder's moment rather than overriding it", () => {
    const text = "Once per turn per unit, after one model from your army with this ability has shot, that unit must take a Battle-shock test.";
    expect(errorsOf(placed(text,
      ["Once per turn per unit", "usage-limit", { frequency: "once-per-turn", per: "unit" }],
      ["model", "unit-filter", { side: "friendly", level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      thisAbility,
      ["has shot", "event", { kind: "after-shooting" }],
      battleShock("that unit must take a Battle-shock test", "event-subject")), text)).toMatch(/Conflicting usage scopes/u);
  });

  it("filters a grant's recipients by the ability, with no allowance", () => {
    const text = "Friendly ALPHA units with this ability can re-roll Advance rolls.";
    const mechanics = mechanicsOf(placed(text,
      ["Friendly ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      thisAbility,
      ["re-roll Advance rolls", "reroll", { roll: "advance", subset: "all", weapon_type: "all" }]), text);
    expect(mechanics.effect.target).toEqual({ owner: "friendly", all_of: ["ALPHA"], has_ability: [OWN] });
    expect(mechanics.usage).toBeUndefined();
  });

  it("puts \"without this ability\" in lacks_ability", () => {
    const text = "Friendly ALPHA units without this ability can re-roll Advance rolls.";
    const mechanics = mechanicsOf(placed(text,
      ["Friendly ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["without this ability", "unit-has-ability", { subject: "antecedent", own: true, negated: true }],
      ["re-roll Advance rolls", "reroll", { roll: "advance", subset: "all", weapon_type: "all" }]), text);
    expect(mechanics.effect.target).toEqual({ owner: "friendly", all_of: ["ALPHA"], lacks_ability: [OWN] });
  });

  it("requires the ability of every alternative", () => {
    const text = "**ALPHA** or **BETA** units with this ability can re-roll Advance rolls.";
    const mechanics = mechanicsOf(placed(text,
      ["**ALPHA**", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["**BETA** units", "unit-filter", { side: "friendly", keywords: ["BETA"] }],
      thisAbility,
      ["re-roll Advance rolls", "reroll", { roll: "advance", subset: "all", weapon_type: "all" }]), text);
    expect(mechanics.effect.target).toMatchObject({ owner: "friendly", any_of: ["ALPHA", "BETA"], has_ability: [OWN] });
  });

  it("binds \"this ability\" on a duplicate record to the canonical id it is given", () => {
    const text = "Friendly ALPHA units with this ability can re-roll Advance rolls.";
    const mechanics = mechanicsOf(placed(text,
      ["Friendly ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      thisAbility,
      ["re-roll Advance rolls", "reroll", { roll: "advance", subset: "all", weapon_type: "all" }]), text, "dread-howl-canonical");
    expect(mechanics.effect.target.has_ability).toEqual(["dread-howl-canonical"]);
  });
});

describe("Round 5C holder abilities: what still does not fold", () => {
  const advance: Item = ["re-roll Advance rolls", "reroll", { roll: "advance", subset: "all", weapon_type: "all" }];

  it("refuses \"this ability\" when the compiler is given no record id", () => {
    const text = "Friendly ALPHA units with this ability can re-roll Advance rolls.";
    expect(errorsOf(placed(text, ["Friendly ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }], thisAbility, advance), text, null))
      .toMatch(/no record id/u);
  });

  it("refuses a \"from your army\" that contradicts the filter's side", () => {
    const text = "Enemy units from your army with this ability can re-roll Advance rolls.";
    expect(errorsOf(placed(text,
      ["Enemy units", "unit-filter", { side: "enemy" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      thisAbility, advance), text)).toMatch(/side other than its unit-filter/u);
  });

  it("refuses a filter that both requires and excludes the ability", () => {
    const text = "ALPHA units with this ability without this ability can re-roll Advance rolls.";
    expect(errorsOf(placed(text,
      ["ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      thisAbility,
      ["without this ability", "unit-has-ability", { subject: "antecedent", own: true, negated: true }],
      advance), text)).toMatch(/both requires and excludes/u);
  });

  it("preserves the ability requirement on an aura's recipient filter", () => {
    const text = "While a friendly ALPHA unit with this ability is within 6\" of this model, re-roll Advance rolls.";
    const mechanics = mechanicsOf(placed(text,
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      thisAbility,
      ["is within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      advance), text);
    expect(mechanics.effect).toMatchObject({ type: "aura", modifier: { eligible: { owner: "friendly", all_of: ["ALPHA"], has_ability: [OWN] } } });
  });

  it("leaves a has-ability with its own subject as a condition on that subject", () => {
    const text = "Friendly ALPHA units can re-roll Advance rolls while this unit has the Gloom Veil ability.";
    const mechanics = mechanicsOf(placed(text,
      ["Friendly ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      advance,
      ["this unit has the Gloom Veil ability", "unit-has-ability", { subject: "this-unit", ability: "gloom-veil" }]), text);
    expect(mechanics.effect.effect.target).toEqual({ owner: "friendly", all_of: ["ALPHA"] });
    expect(hasAbilityNodes(mechanics)).toEqual([{ type: "matches", parameters: { subject: "this-unit", filter: { has_ability: ["gloom-veil"] } } }]);
  });

  it("does not fold across other wording between the filter and \"with this ability\"", () => {
    const text = "Friendly ALPHA units, while within range of a unit with this ability, can re-roll Advance rolls.";
    const list = placed(text,
      ["Friendly ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["with this ability", "unit-has-ability", { subject: "antecedent", own: true }],
      advance);
    // The leaf stays an anaphor about the filtered units, which it cannot name: no fold, no guess.
    expect(errorsOf(list, text)).toMatch(/points back to the filtered-units/u);
  });

  it("keeps a select's \"from your army with this ability\" bound to the selected unit", () => {
    const text = "Select one unit from your army with this ability. That unit can re-roll Advance rolls.";
    const mechanics = mechanicsOf(placed(text,
      ["Select one unit", "select-unit", { scope: "friendly", distance: "any", visible: false }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      thisAbility, advance), text);
    expect(hasAbilityNodes(mechanics)).toEqual([{ type: "matches", parameters: { subject: "selected-unit", filter: { has_ability: [OWN] } } }]);
  });
});

describe("Round 5C unit-has-ability own", () => {
  const normalize = (parameters: Record<string, unknown>, version = currentFamilyVersion("unit-has-ability")) => normalizeFingerprintParameters("unit-has-ability", parameters, version);

  it("accepts own: true in place of an ability id, and every previous leaf unchanged", () => {
    expect(normalize({ subject: "antecedent", own: true })).toEqual({ subject: "antecedent", own: true });
    expect(normalize({ subject: "antecedent", ability: "gloom-veil" })).toEqual(normalize({ subject: "antecedent", ability: "gloom-veil" }, currentFamilyVersion("unit-has-ability") - 1));
  });

  it("previews as \"this ability\", and refuses to lower before its record binds it", () => {
    expect(previewLeaf({ family_id: "unit-has-ability", parameters: { subject: "this-unit", own: true, negated: true } }))
      .toEqual({ text: "the unit does not have this ability", problem: null });
    const version = currentFamilyVersion("unit-has-ability");
    expect(() => leafFragment({ role: familyRole("unit-has-ability", version), family_id: "unit-has-ability", family_version: version, parameters: { subject: "this-unit", own: true }, start_byte: 0 }))
      .toThrow(/binds to an id only when its record compiles/u);
  });

  it("refuses both, neither, or an own that is not true", () => {
    expect(() => normalize({ subject: "antecedent", own: true, ability: "gloom-veil" })).toThrow(/not both/u);
    expect(() => normalize({ subject: "antecedent" })).toThrow(/names an ability/u);
    expect(() => normalize({ subject: "antecedent", own: false })).toThrow(/own is true/u);
    expect(() => normalize({ subject: "antecedent", own: true }, currentFamilyVersion("unit-has-ability") - 1)).toThrow();
  });
});

describe("Round 5C canonical ability for \"this ability\"", () => {
  const record = (ability_id: string, overrides: Partial<AbilityIdentity> = {}): AbilityIdentity => ({ ability_id, faction_id: "alpha-host", source_hash: "h1", mfm_refs: ["ref-1"], carried: false, ...overrides });
  const canonical = record("roar", { carried: true });

  it("names the carried record a stub duplicates by text and MFM references", () => {
    const stub = record("roar-stub");
    expect(canonicalAbilityId(stub, [stub, canonical])).toBe("roar");
  });

  it("keeps a record's own id when a datasheet carries it, or nothing carried duplicates it", () => {
    expect(canonicalAbilityId(canonical, [canonical, record("roar-stub")])).toBe("roar");
    for (const other of [
      record("roar", { carried: true, source_hash: "h2" }),
      record("roar", { carried: true, mfm_refs: ["ref-2"] }),
      record("roar", { carried: true, faction_id: "beta-host" }),
      record("roar"),
    ]) expect(canonicalAbilityId(record("roar-stub"), [other])).toBe("roar-stub");
    expect(canonicalAbilityId(record("unsourced", { mfm_refs: [] }), [record("roar", { carried: true, mfm_refs: [] })])).toBe("unsourced");
  });

  it("reads MFM references as a set, whatever their order", () => {
    const stub = record("roar-stub", { mfm_refs: ["ref-2", "ref-1"] });
    expect(canonicalAbilityId(stub, [stub, record("roar", { carried: true, mfm_refs: ["ref-1", "ref-2", "ref-1"] })])).toBe("roar");
  });

  it("refuses to pick between two carried duplicates", () => {
    const stub = record("roar-stub");
    expect(() => canonicalAbilityId(stub, [stub, canonical, record("roar-two", { carried: true })])).toThrow(/no one canonical record/u);
  });
});

describe("Round 5C own ability ids from the workbench and the data root", () => {
  it("maps a stub to the record a datasheet carries, and leaves out an ambiguous one", () => {
    const root = mkdtempSync(join(tmpdir(), "own-abilities-"));
    try {
      mkdirSync(join(root, "core", "alpha-host"), { recursive: true });
      mkdirSync(join(root, "enrichment", "alpha-host"), { recursive: true });
      writeFileSync(join(root, "core", "alpha-host", "units.json"), JSON.stringify([{ id: "brute", ability_ids: ["roar", { id: "howl" }, { id: "howl-two" }] }]));
      writeFileSync(join(root, "enrichment", "alpha-host", "abilities.json"), JSON.stringify([{ ability_id: "growl", unit_ids: ["brute"] }]));
      const db = new DatabaseSync(":memory:");
      db.exec("CREATE TABLE abilities (id INTEGER PRIMARY KEY, faction_id TEXT, ability_id TEXT, source_hash TEXT, metadata_json TEXT, current INTEGER)");
      const source = (ref: string) => JSON.stringify({ source: { kind: "mfm", refs: [`dump.json#${ref}`] } });
      const insert = db.prepare("INSERT INTO abilities VALUES (?, 'alpha-host', ?, ?, ?, ?)");
      insert.run(1, "roar", "h1", source("a"), 1);
      insert.run(2, "roar-stub", "h1", source("a"), 1);
      insert.run(3, "howl", "h2", source("b"), 1);
      insert.run(4, "howl-two", "h2", source("b"), 1);
      insert.run(5, "howl-stub", "h2", source("b"), 1);
      insert.run(6, "growl", "h3", source("c"), 1);
      insert.run(7, "growl-stub", "h3", source("c"), 1);
      insert.run(8, "roar-old", "h1", source("a"), 0);
      const own = ownAbilityIds(db, root);
      expect(Object.fromEntries(own)).toEqual({ 1: "roar", 2: "roar", 3: "howl", 4: "howl-two", 6: "growl", 7: "growl" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
