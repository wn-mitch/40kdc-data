import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/round5c/compile.js";
import type { CompileLeaf } from "../src/round5c/compile-fragments.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters, validateFamilySource } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";

// Fabricated wording and records only; no GW rule prose.

const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

/** Leaves placed on a fabricated source text, each at its own wording, in an optional fragment. */
function placed(text: string, parts: Array<[string, string, Record<string, unknown>, string?]>): { leaves: CompileLeaf[]; text: string } {
  let from = 0;
  const leaves = parts.map(([wording, family_id, parameters, fragment]) => {
    const index = text.indexOf(wording, from);
    if (index < 0) throw new Error(`"${wording}" is not in the fixture text after byte ${from}.`);
    from = index + wording.length;
    const start = Buffer.byteLength(text.slice(0, index));
    const version = currentFamilyVersion(family_id);
    return {
      role: familyRole(family_id, version), family_id, family_version: version, start_byte: start, end_byte: start + Buffer.byteLength(wording),
      parameters: normalize(family_id, parameters), ...(fragment ? { fragment } : {}),
    };
  });
  return { leaves, text };
}

function compiled(parts: { leaves: CompileLeaf[]; text: string }) {
  const result = compileLeaves(parts.leaves, parts.text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics;
}

function nodes(tree: unknown, test: (node: Record<string, unknown>) => boolean): Array<Record<string, unknown>> {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, test));
  if (tree === null || typeof tree !== "object") return [];
  const node = tree as Record<string, unknown>;
  return [...(test(node) ? [node] : []), ...Object.values(node).flatMap((value) => nodes(value, test))];
}
const first = (tree: unknown, type: string) => nodes(tree, (node) => node.type === type)[0];

/** A real authored entry, so a compiled body is checked against the full DSL schema. */
function authored(faction: string, abilityId: string): Record<string, unknown> {
  const enrichment = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
  return (JSON.parse(readFileSync(join(enrichment, faction, "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
    .find((item) => item.ability_id === abilityId)!;
}
const schemaErrors = (mechanics: unknown) => checkEntry(entryWithMechanics(authored("world-eaters", "blessings-of-khorne-world-eaters"), mechanics as never)).errors;

const FRIENDLY = { side: "friendly", keywords: ["ADEPTUS ASTARTES"] };

describe("unit-filters that name who acts or what a moment happens to", () => {
  it("names the unit of a moment its own side owns, past a \"from your army\"", () => {
    const parts = placed("Your Movement phase, just after an ADEPTUS ASTARTES unit from your army Falls Back. Until the end of the turn, your unit can shoot.", [
      ["ADEPTUS ASTARTES unit", "unit-filter", FRIENDLY],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["Falls Back", "event", { kind: "move-ended", owner: "friendly", move_types: ["fall-back"] }],
      ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }],
      ["your unit can shoot", "eligibility-permission", { subject: "this-unit", activity: "shoot", allow: true }],
    ]);
    expect(compiled(parts).trigger).toMatchObject({ event: "move-ended", subject: { owner: "friendly", all_of: ["ADEPTUS ASTARTES"] } });
  });

  it("does not fold a filter into a moment the other side owns", () => {
    const parts = placed("Each time an ADEPTUS ASTARTES unit ends a move, this unit has +1 to hit rolls.", [
      ["ADEPTUS ASTARTES unit", "unit-filter", FRIENDLY],
      ["ends a move", "event", { kind: "move-ended", owner: "enemy" }],
      ["this unit has +1 to hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ]);
    expect(compileLeaves(parts.leaves, parts.text)).toMatchObject({ ok: false, errors: [expect.stringMatching(/unit-filter needs/u)] });
  });

  it("makes the filtered units the attackers, not this unit", () => {
    const parts = placed("Until the end of the phase, each time a friendly ADEPTUS ASTARTES unit makes an attack, add 1 to the Wound roll.", [
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["friendly ADEPTUS ASTARTES unit", "unit-filter", FRIENDLY],
      ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ]);
    const mechanics = compiled(parts);
    expect(first(mechanics.effect, "roll-modifier")!.target).toEqual({ owner: "friendly", all_of: ["ADEPTUS ASTARTES"] });
    expect(schemaErrors(mechanics)).toEqual([]);
  });

  it("makes any friendly unit the attacker when no filter names one", () => {
    const parts = placed("Each time a friendly unit makes an attack, add 1 to the Wound roll.", [
      ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }],
    ]);
    expect(first(compiled(parts).effect, "roll-modifier")!.target).toEqual({ owner: "friendly" });
  });

  it("keeps a model-level filter before this unit's attack to this unit's models", () => {
    const parts = placed("Each time a PENITENT model in your unit makes a melee attack, add 1 to the Hit roll.", [
      ["PENITENT model", "unit-filter", { side: "friendly", keywords: ["PENITENT"], level: "model" }],
      ["in your unit makes a melee attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "melee" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ]);
    expect(first(compiled(parts).effect, "roll-modifier")!.target).toEqual({ level: "model", member_of: "this-unit", all_of: ["PENITENT"] });
  });

  it("gives a subjectless re-roll to the filtered units", () => {
    const parts = placed("Friendly ADEPTUS ASTARTES units can re-roll hit rolls of 1.", [
      ["Friendly ADEPTUS ASTARTES units", "unit-filter", FRIENDLY],
      ["can re-roll hit rolls of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }],
    ]);
    const mechanics = compiled(parts);
    expect(first(mechanics.effect, "re-roll")!.target).toEqual({ owner: "friendly", all_of: ["ADEPTUS ASTARTES"] });
    expect(schemaErrors(mechanics)).toEqual([]);
  });

  it("names what damage was allocated to, and the friendly unit that destroyed a unit", () => {
    const allocated = placed("Just after a mortal wound is allocated to an ADEPTUS ASTARTES unit from your army, your unit has the Feel No Pain 6+ ability.", [
      ["Just after a mortal wound is allocated to an", "event", { kind: "damage-allocated" }],
      ["ADEPTUS ASTARTES unit", "unit-filter", FRIENDLY],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["your unit has the Feel No Pain 6+ ability", "feel-no-pain", { subject: "this-unit", threshold: 6, against: "all" }],
    ]);
    expect(compiled(allocated).trigger).toMatchObject({ event: "damage-allocated", object: { owner: "friendly", all_of: ["ADEPTUS ASTARTES"] } });
    const destroyed = placed("Each time a unit is destroyed by an ADEPTUS ASTARTES unit, this unit has +1 to hit rolls.", [
      ["Each time a unit is destroyed", "event", { kind: "unit-destroyed" }],
      ["ADEPTUS ASTARTES unit", "unit-filter", FRIENDLY],
      ["this unit has +1 to hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ]);
    // The filter after "destroyed by an" is the destroyer (compile-destroying-attack.ts), so the trigger names it as the subject.
    expect(compiled(destroyed).trigger).toMatchObject({ event: "destroyed", subject: { owner: "friendly", all_of: ["ADEPTUS ASTARTES"] } });
  });
});

describe("weapon ability spelling", () => {
  it("matches a granted ability through the non-breaking hyphen the source prints", () => {
    expect(() => validateFamilySource("weapon-ability-grant", { keyword: "Anti-Monster 2+" }, "that weapon has the [ANTI‑MONSTER 2+] ability")).not.toThrow();
    expect(() => validateFamilySource("weapon-ability-grant", { keyword: "Anti-Monster 2+" }, "that weapon has the [ANTI-VEHICLE 2+] ability")).toThrow(/must occur/u);
  });
});

describe("named tests", () => {
  const TEST = "Take a Psychic test. If passed, that unit suffers D3 mortal wounds. If failed, this unit suffers 1 mortal wound.";

  it("rolls a Psychic test as a 2D6 roll with its kind, gated at the Warp Charge", () => {
    const parts = placed(TEST, [
      ["Take a Psychic test", "dice-roll", { dice: "2D6", kind: "psychic" }],
      ["If passed", "roll-result", { from: 7 }],
      ["that unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "this-unit", count: "D3" }],
    ]);
    const roll = first(compiled(parts).effect, "roll")!;
    expect(roll).toMatchObject({ dice: "2D6", kind: "psychic", roll_var: "psychic-test", effect: { type: "dice-gated", threshold: 7, from: { roll_var: "psychic-test" } } });
  });

  it("gives a 2D6 pass/fail pair both branches of one gate", () => {
    const parts = placed(TEST, [
      ["Take a Psychic test", "dice-roll", { dice: "2D6", kind: "psychic" }],
      ["If passed", "roll-result", { from: 7 }],
      ["that unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "this-unit", count: "D3" }],
      ["If failed", "roll-result", { from: 1, to: 6 }],
      ["this unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }],
    ]);
    const mechanics = compiled(parts);
    const gate = first(mechanics.effect, "dice-gated")!;
    expect(gate.threshold).toBe(7);
    expect(first(gate.on_success, "mortal-wounds")).toMatchObject({ modifier: { count: "D3" } });
    expect(String((first(gate.on_fail, "mortal-wounds")!.modifier as { count: unknown }).count)).toBe("1");
    expect(schemaErrors(mechanics)).toEqual([]);
  });

  it("still refuses bands on 2D6 that do not split pass from fail", () => {
    const parts = placed("Roll 2D6. On a 2-4, this unit suffers 1 mortal wound. On a 10+, this unit has +1 to hit rolls.", [
      ["Roll 2D6", "dice-roll", { dice: "2D6" }],
      ["On a 2-4", "roll-result", { from: 2, to: 4 }],
      ["this unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }],
      ["On a 10+", "roll-result", { from: 10 }],
      ["this unit has +1 to hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ]);
    expect(compileLeaves(parts.leaves, parts.text)).toMatchObject({ ok: false, errors: [expect.stringMatching(/2D6/u)] });
  });
});

describe("army and pool limits", () => {
  it("counts an allied limit in points, per battle size or per unit", () => {
    const points = normalize("army-construction", { rule: "composition", with_keywords: ["DEATHWATCH"], max: 500, measure: "points" });
    expect(points).toMatchObject({ max: 500, measure: "points" });
    const parts = placed("You can include DEATHWATCH units in your army up to 500 points.", [
      ["You can include DEATHWATCH units in your army up to 500 points", "army-construction", points],
    ]);
    const mechanics = compiled(parts);
    expect(first(mechanics.effect, "army-rule")).toMatchObject({ modifier: { rule: "composition", with: { all_of: ["DEATHWATCH"] }, max: 500, measure: "points" } });
    expect(schemaErrors(mechanics)).toEqual([]);
    expect(normalize("army-construction", { rule: "composition", with_keywords: ["AGENT"], max: { incursion: 1, "strike-force": 2, onslaught: 3 }, per_keywords: ["INQUISITOR"] }))
      .toMatchObject({ max: { incursion: 1, "strike-force": 2, onslaught: 3 }, per_keywords: ["INQUISITOR"] });
  });

  it("refuses a points-sized max counted in units and points on a non-composition rule", () => {
    expect(() => normalize("army-construction", { rule: "composition", with_keywords: ["DEATHWATCH"], max: 500 })).toThrow(/measure: points/u);
    expect(() => normalize("army-construction", { rule: "unique", measure: "points", max: 500 })).toThrow(/rule: composition/u);
    expect(() => normalize("army-construction", { rule: "composition", max: { incursion: 1, onslaught: 3 } })).toThrow(/exactly incursion/u);
  });

  it("gains a pool amount per battle size", () => {
    const amount = { incursion: 6, "strike-force": 10, onslaught: 14 };
    const parts = placed("You start the battle with 6/10/14 Gift points.", [
      ["You start the battle with 6/10/14 Gift points", "resource-gain", { pool: "gift-points", amount }],
    ]);
    const mechanics = compiled(parts);
    expect(first(mechanics.effect, "resource-gain")).toMatchObject({ modifier: { pool: "gift-points", amount } });
    expect(schemaErrors(mechanics)).toEqual([]);
  });
});

describe("a menu that may be rolled for instead", () => {
  const MENU = ["Select one Gift below, or randomly select two by rolling two D6."]
    .concat(["One", "Two", "Three", "Four", "Five", "Six"].map((name, at) => `Gift ${name}: this unit has +${at + 1} to charge rolls.`)).join(" ");
  const menu = (count: number) => placed(MENU, [
    ["Select one Gift below, or randomly select two by rolling two D6", "choice-open", { or_random: { dice: "D6", count: 2 } }],
    ...Array.from({ length: count }, (_, at): [string, string, Record<string, unknown>] => [`this unit has +${at + 1} to charge rolls`, "roll-modifier", { roll: "charge", operation: "add", value: at + 1 }]),
  ]);

  it("chooses between selecting and rolling two dice on the numbered options", () => {
    const mechanics = compiled(menu(6));
    const outer = first(mechanics.effect, "choice")!;
    const [selection, table] = outer.options as Array<Record<string, unknown>>;
    expect(selection!.type).toBe("choice");
    expect((selection!.options as unknown[]).length).toBe(6);
    expect(table).toMatchObject({ type: "dice-table", dice: "D6", count: 2 });
    expect((table!.outcomes as Array<{ results: number[] }>).map((outcome) => outcome.results)).toEqual([[1], [2], [3], [4], [5], [6]]);
    expect(schemaErrors(mechanics)).toEqual([]);
  });

  it("refuses a random pick whose options do not number the die's faces", () => {
    const parts = menu(5);
    expect(compileLeaves(parts.leaves, parts.text)).toMatchObject({ ok: false, errors: [expect.stringMatching(/exactly 6 numbered options/u)] });
  });
});
