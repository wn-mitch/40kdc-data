import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole } from "../src/round5c/contracts.js";
import { attackOwner, effect } from "../src/round5c/compile-fragments.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";

// Fabricated wording only: the names, keywords and numbers are invented, and the sentence
// structure is what the compiler reads (the punctuation and joining words between leaves).

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
const base = (JSON.parse(readFileSync(join(dataRoot, "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
  .find((entry) => entry.ability_id === "control-edict-adeptus-mechanicus")!;

/** "zero": a zero-width leaf at the first byte of its wording (a frame that precedes the leaf it grants). */
type Item = [wording: string, family: string, parameters: Record<string, unknown>, ("zero" | undefined)?];

/** Leaves on their own wording in `text`, in order. `version` pins a family version other than the current one. */
function placed(text: string, items: Item[], version?: { family: string; version: number }): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, zero]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    const end = zero ? start : start + Buffer.byteLength(wording, "utf8");
    if (!zero) from = end;
    const family_version = version?.family === family ? version.version : currentFamilyVersion(family);
    return { role: familyRole(family, family_version), family_id: family, family_version, parameters, start_byte: start, end_byte: end, fragment: "RAW_TEXT" };
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

  it("refuses a destruction that names the attacks it is destroyed by, since the fold would drop the attack's maker", () => {
    // destroy_filter already names the destroying weapon; the fold is refused rather than combined with it.
    const text = SHOT_TEXT;
    const leaves = placed(text, [ASTRA, destroyed(), makesByEnemy(), FLY, hitRoll()]);
    leaves[1]!.parameters = { kind: "unit-destroyed", destroy_filter: { weapon: "any" } };
    const result = compileLeaves(leaves, text);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("cannot also take its destroyer");
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
    const { mechanics } = compiled("Each time an attack made by a NURGLE LEGIONES DAEMONICA model is allocated to a model in that unit, add 1 to the Damage characteristic of that attack.", [
      ["Each time an attack made by a", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
      ["NURGLE LEGIONES DAEMONICA model", "unit-filter", { side: "friendly", keywords: ["NURGLE", "LEGIONES DAEMONICA"], level: "model" }],
      ["is allocated to a model in that unit", "event", { kind: "damage-allocated" }],
      ["add 1 to the Damage characteristic of that attack", "characteristic-modifier", { subject: "attack", characteristics: ["D"], operation: "add", value: 1, weapon_type: "all" }],
    ]);
    expect(mechanics.trigger).toMatchObject({ event: "damage-allocated", subject: { owner: "friendly", all_of: ["NURGLE", "LEGIONES DAEMONICA"], level: "model" } });
  });

  it("changes the Damage of the allocated attack on the bearer's unit, not on every friendly unit", () => {
    // The makes-attack's maker is the trigger's subject; the modifier targets the unit the attack is allocated to.
    const { mechanics } = compiled("Each time an attack made by a NURGLE LEGIONES DAEMONICA model is allocated to a model in that unit, add 1 to the Damage characteristic of that attack.", [
      ["Each time an attack made by a", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
      ["NURGLE LEGIONES DAEMONICA model", "unit-filter", { side: "friendly", keywords: ["NURGLE", "LEGIONES DAEMONICA"], level: "model" }],
      ["is allocated to a model in that unit", "event", { kind: "damage-allocated" }],
      ["add 1 to the Damage characteristic of that attack", "characteristic-modifier", { subject: "attack", characteristics: ["D"], operation: "add", value: 1, weapon_type: "all" }],
    ]);
    expect(mechanics.effect).toEqual({ type: "stat-modifier", target: "this-unit", modifier: { stat: "D", operation: "add", value: 1 } });
  });

  it("does not widen allocation to one model into reduction for its entire unit", () => {
    const { mechanics } = compiled("Each time an attack is allocated to this model, subtract 1 from the Damage characteristic of that attack.", [
      ["Each time an attack is allocated to this model", "event", { kind: "damage-allocated", object: "this-model" }],
      ["subtract 1 from the Damage characteristic of that attack", "characteristic-modifier", { subject: "attack", characteristics: ["D"], operation: "subtract", value: 1, weapon_type: "all" }],
    ]);
    expect(mechanics.effect).not.toMatchObject({ type: "damage-reduction", target: "this-unit" });
  });

  it("lowers only an allocated attack's fixed Damage subtraction as a defensive reduction", () => {
    const allocatedText = "Each time an attack is allocated to this unit, subtract 1 from the Damage characteristic of that attack.";
    const allocated = compiled(allocatedText, [
      ["Each time an attack is allocated to this unit", "event", { kind: "damage-allocated", object: "this-unit" }],
      ["subtract 1 from the Damage characteristic of that attack", "characteristic-modifier", { subject: "attack", characteristics: ["D"], operation: "subtract", value: 1, weapon_type: "all" }],
    ]);
    expect(allocated.mechanics.effect).toEqual({
      type: "damage-reduction",
      target: "this-unit",
      modifier: { reduction: 1 },
    });

    const outgoingText = "Each time this unit makes an attack, subtract 1 from the Damage characteristic of that attack.";
    const outgoing = compiled(outgoingText, [
      ["Each time this unit makes an attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "any" }],
      ["subtract 1 from the Damage characteristic of that attack", "characteristic-modifier", { subject: "attack", characteristics: ["D"], operation: "subtract", value: 1, weapon_type: "all" }],
    ]);
    expect(outgoing.mechanics.effect).toEqual({
      type: "stat-modifier",
      target: "this-unit",
      modifier: { stat: "D", operation: "subtract", value: 1 },
    });

    const explicitRecipient = compiled(allocatedText, [
      ["Each time an attack is allocated to this unit", "event", { kind: "damage-allocated", object: "this-unit" }],
      ["subtract 1 from the Damage characteristic of that attack", "characteristic-modifier", { subject: "this-unit", characteristics: ["D"], operation: "subtract", value: 1, weapon_type: "all" }],
    ]);
    expect(explicitRecipient.mechanics.effect).toEqual({
      type: "stat-modifier",
      target: "this-unit",
      modifier: { stat: "D", operation: "subtract", value: 1 },
    });
  });
});

describe("Round 5C attack owner for a subject-attack setter (compile-fragments attackOwner)", () => {
  it("names the attacker of an incoming attack", () => {
    expect(attackOwner({ incoming: true, attacker: { owner: "enemy" }, defended: true })).toBe("attacker");
  });

  it("names the bearer's unit for an allocation moment, whatever the attacker's filter says", () => {
    expect(attackOwner({ incoming: false, attacker: { owner: "friendly" }, defended: true })).toBe("this-unit");
  });

  it("names the attacker filter of the bearer's own attack, else this unit", () => {
    expect(attackOwner({ incoming: false, attacker: { owner: "enemy" }, defended: false })).toEqual({ owner: "enemy" });
    expect(attackOwner({ incoming: false, defended: false })).toBe("this-unit");
  });

  it("lowers an incoming subject-attack setter to the attacker, not to the bearer", () => {
    const leaf = placed("change the Damage characteristic of that attack to 1", [
      ["change the Damage characteristic of that attack to 1", "characteristic-set", { subject: "attack", characteristic: "D", value: 1, weapon_type: "all" }],
    ])[0]!;
    expect(effect(leaf, { attached: false, incoming: true, attacker: null })).toMatchObject({ type: "stat-modifier", target: "attacker" });
    expect(effect(leaf, { attached: false, incoming: false, attacker: null })).toMatchObject({ type: "stat-modifier", target: "this-unit" });
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
    expect(currentFamilyVersion("characteristic-set")).toBeGreaterThanOrEqual(7);
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
    expect(mechanics.effect).toMatchObject({ type: "conditional", condition: { type: "matches", parameters: { subject: "attacker", filter: { designated: "wobbled" } } }, effect: { type: "rule-state", target: "defender" } });
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

describe("Round 5C Or: arm with a Character condition on the bearer (10539 shape)", () => {
  // "Have [LETHAL HITS]. Or: If your unit is a Character unit, have [LETHAL HITS] and [LANCE]." The second arm
  // repeats the keyword under the antecedent frame; the player picks one arm, so the result is a choice.
  const TEXT = "Your unit's melee attacks have [LETHAL HITS]. Or: If your unit is a Character unit, have [LETHAL HITS] and [LANCE].";
  const ITEMS: Item[] = [
    ["Your unit's melee attacks", "weapon-ability-grant", { subject: "this-unit", weapon_type: "melee" }],
    ["[LETHAL HITS]", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
    ["Or:", "instead", { choice: true }],
    ["If your unit is a Character unit", "unit-keyword", { keywords: ["CHARACTER"], subject: "this-unit", negated: false }],
    ["[LETHAL HITS]", "weapon-ability-grant", { frame: "antecedent" }, "zero"],
    ["[LETHAL HITS]", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
    ["[LANCE]", "weapon-ability-keyword", { keyword: "Lance" }],
  ] as Item[];

  it("lowers to a choice: the plain arm, or the Character arm under its own condition", () => {
    const { mechanics } = compiled(TEXT, ITEMS);
    expect(mechanics.effect.type).toBe("choice");
    expect(mechanics.effect.options[0]).toEqual({ type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "lethal-hits" }], weapons: { type: "melee" } } });
    expect(mechanics.effect.options[1]).toMatchObject({ type: "conditional", condition: { type: "matches", parameters: { filter: { all_of: ["CHARACTER"] } } }, effect: { modifier: { keywords: [{ keyword_id: "lethal-hits" }, { keyword_id: "lance" }] } } });
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
    expect(mechanics.effect).toMatchObject({ type: "weapon-ability-grant", target: { owner: "friendly", all_of: ["BLOOD CLAWS"] }, modifier: { keywords: [{ keyword_id: "lethal-hits" }] } });
  });
});

