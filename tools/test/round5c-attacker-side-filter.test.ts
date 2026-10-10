import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";

// Fabricated wording only: the names, keywords and numbers are invented, and the sentence
// structure is what the compiler reads (the punctuation and joining words between leaves).

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
const base = (JSON.parse(readFileSync(join(dataRoot, "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
  .find((entry) => entry.ability_id === "control-edict-adeptus-mechanicus")!;

type Item = [wording: string, family: string, parameters: Record<string, unknown>];

/** Leaves on their own wording in `text`, in order. `version` pins a family version other than the current one. */
function placed(text: string, items: Item[], version?: { family: string; version: number }): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const family_version = version?.family === family ? version.version : currentFamilyVersion(family);
    return { role: familyRole(family, family_version), family_id: family, family_version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

/** The compile result for a text, with the entry checked against the ability schema. */
function compiled(text: string, items: Item[], version?: { family: string; version: number }) {
  const result = compileLeaves(placed(text, items, version), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  const check = checkEntry(entryWithMechanics(base, result.mechanics));
  expect(check.errors).toEqual([]);
  return { mechanics: result.mechanics as unknown as Record<string, any>, rendered: check.rendered_text! };
}

const ASTRA = ["friendly ASTRA MILITARUM unit", "unit-filter", { side: "friendly", keywords: ["ASTRA MILITARUM"] }] as Item;
const destroyed = (): Item => ["is destroyed", "event", { kind: "unit-destroyed" }];
const makesByEnemy = (): Item => ["by an attack made by an", "attack", { direction: "makes", unit: "enemy-unit", attack_type: "any" }];
const FLY = ["enemy unit that can FLY", "unit-filter", { side: "enemy", keywords: ["FLY"] }] as Item;
const hitRoll = (): Item => ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }];
const SHOT_TEXT = "Each time a friendly ASTRA MILITARUM unit is destroyed by an attack made by an enemy unit that can FLY, add 1 to the Hit roll.";

describe("Round 5C attacker-side filter on a destruction by an attack", () => {
  it("names the destroying attack's maker as the destruction's subject, not the roll's target", () => {
    const { mechanics } = compiled(SHOT_TEXT, [ASTRA, destroyed(), makesByEnemy(), FLY, hitRoll()]);
    expect(mechanics.trigger).toMatchObject({
      event: "destroyed",
      subject: { owner: "enemy", all_of: ["FLY"] },
      object: { owner: "friendly", all_of: ["ASTRA MILITARUM"] },
    });
    expect(mechanics.effect).toMatchObject({ type: "roll-modifier", target: "this-unit" });
    expect(JSON.stringify(mechanics.effect)).not.toContain('"FLY"');
  });

  it("refuses a destruction that already names its destroyer", () => {
    const text = SHOT_TEXT;
    const result = compileLeaves(placed(text, [ASTRA, ["is destroyed", "event", { kind: "unit-destroyed", by: "enemy" }], makesByEnemy(), FLY, hitRoll()]), text);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("cannot also take that destroyer");
  });

  it("refuses a destruction that already has a subject filter", () => {
    const text = SHOT_TEXT;
    const leaves = placed(text, [ASTRA, destroyed(), makesByEnemy(), FLY, hitRoll()]);
    leaves[1]!.parameters = { kind: "unit-destroyed", subject_filter: { owner: "enemy" } };
    const result = compileLeaves(leaves, text);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("already has a subject");
  });

  it("refuses a destroying attack that names a weapon, since folding drops the attack leaf", () => {
    const text = SHOT_TEXT;
    const leaves = placed(text, [ASTRA, destroyed(), makesByEnemy(), FLY, hitRoll()]);
    leaves[2]!.parameters = { ...leaves[2]!.parameters, weapon: "any" };
    const result = compileLeaves(leaves, text);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("cannot fold its maker");
  });

  it("leaves a destruction by a friendly-unit attack without a subject, since the filter names the other side", () => {
    // The attack's maker is friendly and the filter is enemy, so the filter does not name the attack's maker.
    const text = "Each time a friendly ASTRA MILITARUM unit is destroyed by an attack made by an enemy unit, add 1 to the Hit roll.";
    const { mechanics } = compiled(text, [ASTRA, destroyed(), ["by an attack made by an", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
      ["enemy unit", "unit-filter", { side: "enemy" }], hitRoll()]);
    expect(mechanics.trigger.subject).toBeUndefined();
  });
});

describe("Round 5C attacker filter on an incoming attack's damage", () => {
  it("makes a friendly model's attack the damage moment's subject, with the model filter", () => {
    // The Damage change is left as the attack's owner for now; only the trigger's subject is pinned here.
    const { mechanics } = compiled("Each time an attack made by a NURGLE LEGIONES DAEMONICA model is allocated to a model in that unit, add 1 to the Damage characteristic of that attack.", [
      ["Each time an attack made by a", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
      ["NURGLE LEGIONES DAEMONICA model", "unit-filter", { side: "friendly", keywords: ["NURGLE", "LEGIONES DAEMONICA"], level: "model" }],
      ["is allocated to a model in that unit", "event", { kind: "damage-allocated" }],
      ["add 1 to the Damage characteristic of that attack", "characteristic-modifier", { subject: "attack", characteristics: ["D"], operation: "add", value: 1, weapon_type: "all" }],
    ]);
    expect(mechanics.trigger).toMatchObject({ event: "damage-allocated", subject: { owner: "friendly", all_of: ["NURGLE", "LEGIONES DAEMONICA"], level: "model" } });
  });
});

describe("Round 5C attacker condition on the damaging attack", () => {
  // The conditions join with "or" in the source between the two condition leaves.
  const TEXT = "Each time an attack is allocated to the bearer, if the attacker is PSYKER or Battle-shocked, add 1 to the Damage characteristic of that attack.";
  const LEAVES: Item[] = [
    ["Each time an attack is allocated to the bearer", "event", { kind: "damage-allocated", object: "this-unit" }],
    ["the attacker is PSYKER", "unit-keyword", { keywords: ["PSYKER"], subject: "attacker", negated: false }],
    ["Battle-shocked", "unit-state", { states: ["battle-shocked"], subject: "attacker", negated: false }],
    ["add 1 to the Damage characteristic of that attack", "characteristic-modifier", { subject: "attack", characteristics: ["D"], operation: "add", value: 1, weapon_type: "all" }],
  ];

  it("joins the two attacker conditions by or when the source says or", () => {
    const { mechanics } = compiled(TEXT, LEAVES);
    expect(mechanics.effect.condition.operator).toBe("or");
    expect(mechanics.effect.effect).toMatchObject({ type: "stat-modifier", modifier: { stat: "D", operation: "add", value: 1 } });
  });

  it("joins them by and when the second leaf starts at the joining word (pitfall: the joiner is the text between leaves)", () => {
    const text = "Each time an attack is allocated to the bearer, if the attacker is PSYKER or Battle-shocked, add 1 to the Damage characteristic of that attack.";
    const shifted: Item[] = [LEAVES[0]!, LEAVES[1]!, ["or Battle-shocked", "unit-state", { states: ["battle-shocked"], subject: "attacker", negated: false }], LEAVES[3]!];
    const { mechanics } = compiled(text, shifted);
    expect(mechanics.effect.condition.operator).toBe("and");
  });
});

describe("Round 5C characteristic setter on the attack (characteristic-set subject attack)", () => {
  const TEXT = "Each time an attack is allocated to the bearer, change the Damage characteristic of that attack to 1.";
  const ITEMS: Item[] = [
    ["Each time an attack is allocated to the bearer", "event", { kind: "damage-allocated", object: "this-unit" }],
    ["change the Damage characteristic of that attack to 1", "characteristic-set", { subject: "attack", characteristic: "D", value: 1, weapon_type: "all" }],
  ];

  it("is the current characteristic-set version, which takes subject attack", () => {
    expect(currentFamilyVersion("characteristic-set")).toBe(7);
  });

  it("lowers to a stat-modifier set on the attack's owner, as the attack's added-to twin does", () => {
    const { mechanics } = compiled(TEXT, ITEMS);
    expect(mechanics.effect).toEqual({ type: "stat-modifier", target: "this-unit", modifier: { stat: "D", operation: "set", value: 1 } });
    const add = compiled(TEXT.replace("change the Damage characteristic of that attack to 1", "change the Damage characteristic of that attack by 1"), [
      ITEMS[0]!, ["change the Damage characteristic of that attack by 1", "characteristic-modifier", { subject: "attack", characteristics: ["D"], operation: "add", value: 1, weapon_type: "all" }],
    ]);
    expect(add.mechanics.effect.target).toBe(mechanics.effect.target);
  });

  it("refuses subject attack on version 6, which predates the attack subject", () => {
    const result = compileLeaves(placed(TEXT, ITEMS, { family: "characteristic-set", version: 6 }), TEXT);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("has no DSL target");
  });
});

describe("Round 5C benefit of cover for a marked unit's targets", () => {
  // Both shapes compile to a passive or reactive grant on the defender. The duration is permanent:
  // the per-attack limit ("against those attacks") is not represented, so the check below pins that gap.
  const COVER: Item = ["its targets have the benefit of cover", "rule-state", { subject: "target", direction: "granted", rule_kind: "core-rule", rule: "benefit-of-cover" }];

  it("grants cover to the targets while the attacking unit is wobbled", () => {
    const { mechanics } = compiled("While a wobbled unit is attacking, its targets have the benefit of cover.", [
      ["While a wobbled unit is attacking", "designated-filter", { tag: "wobbled", subject: "attacker", negated: false }], COVER]);
    expect(mechanics.effect).toMatchObject({ type: "conditional", condition: { type: "designated", parameters: { subject: "attacker", tag: "wobbled" } }, effect: { type: "rule-state", target: "defender" } });
    expect(mechanics.effect.scope ?? mechanics.scope).toEqual({ duration: "permanent" });
  });

  it("triggers on each attack made by a wobbled unit being resolved", () => {
    const { mechanics } = compiled("Each time an attack made by a wobbled unit is resolved, its targets have the benefit of cover.", [
      ["Each time an attack made by a", "attack", { direction: "makes", unit: "enemy-unit", attack_type: "any" }],
      ["wobbled unit", "designated-filter", { tag: "wobbled", subject: "attacker", negated: false }],
      ["is resolved", "event", { kind: "attacks-resolved" }],
      COVER,
    ]);
    expect(mechanics.trigger).toEqual({ event: "attacks-resolved" });
    expect(mechanics.effect).toMatchObject({ type: "conditional", effect: { type: "rule-state", target: "defender" } });
  });
});

describe("Round 5C attacker prefix on a qualified weapon ability (10673 shape)", () => {
  // The qualifier after the keyword is not asserted here: whether it restricts by the target's unit type is open.
  it("grants the keyword to the friendly unit the attacks are made by", () => {
    const { mechanics } = compiled("Attacks made by friendly BLOOD CLAWS units have [LETHAL HITS].", [
      ["Attacks made by", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
      ["friendly BLOOD CLAWS units", "unit-filter", { side: "friendly", keywords: ["BLOOD CLAWS"] }],
      ["[LETHAL HITS]", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
    ]);
    expect(mechanics.effect).toMatchObject({ type: "weapon-ability-grant", target: { owner: "friendly", all_of: ["BLOOD CLAWS"] }, modifier: { abilities: ["Lethal Hits"] } });
  });
});

