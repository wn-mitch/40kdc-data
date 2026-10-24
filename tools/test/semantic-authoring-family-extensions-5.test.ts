import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import type { CompileLeaf } from "../src/semantic-authoring/compile-fragments.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { foldWeaponKeywords } from "../src/semantic-authoring/compile-weapon-keywords.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";

// Fabricated wording and records only; no GW rule prose.

const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

/** Leaves placed on a fabricated source text, each at its own wording, so sentences group as the compiler sees them. */
function placed(text: string, parts: Array<[string, string, Record<string, unknown>]>): { leaves: CompileLeaf[]; text: string } {
  let from = 0;
  const leaves = parts.map(([wording, family_id, parameters]) => {
    const index = text.indexOf(wording, from);
    if (index < 0) throw new Error(`"${wording}" is not in the fixture text after byte ${from}.`);
    from = index + wording.length;
    const start = Buffer.byteLength(text.slice(0, index));
    const version = currentFamilyVersion(family_id);
    return { role: familyRole(family_id, version), family_id, family_version: version, start_byte: start, end_byte: start + Buffer.byteLength(wording), parameters: normalize(family_id, parameters) };
  });
  return { leaves, text };
}

function nodes(tree: unknown, test: (node: Record<string, unknown>) => boolean): Array<Record<string, unknown>> {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, test));
  if (tree === null || typeof tree !== "object") return [];
  const node = tree as Record<string, unknown>;
  return [...(test(node) ? [node] : []), ...Object.values(node).flatMap((value) => nodes(value, test))];
}
const first = (tree: unknown, type: string) => nodes(tree, (node) => node.type === type)[0];

const POOL_TEXT = [
  "Roll six D6 and spend them to activate up to two Gifts.",
  "Gift One can be activated with any double. This unit has +1 to charge rolls.",
  "Gift Two can be activated with a double 4 or higher, or any triple. At the start of the Fight phase, this unit has +1 to hit rolls.",
].join("\n");

function poolLeaves(secondRequirement: Record<string, unknown>) {
  return placed(POOL_TEXT, [
    ["Roll six D6 and spend them to activate up to two Gifts", "dice-pool-allocation-open", { pool_count: 6, pool_die: "D6", max_activations: 2 }],
    ["Gift One can be activated with any double", "named-option", { label: "Gift One", requirement_type: "pair", requirement_min_value: 1 }],
    ["This unit has +1 to charge rolls", "roll-modifier", { roll: "charge", operation: "add", value: 1 }],
    ["Gift Two can be activated with a double 4 or higher, or any triple", "named-option", { label: "Gift Two", ...secondRequirement }],
    ["At the start of the Fight phase", "event", { kind: "phase-start", phase: "fight", turn: "either" }],
    ["this unit has +1 to hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
  ]);
}

describe("dice-pool options", () => {
  const anyOf = { requirement_any_of: [{ type: "pair", min_value: 4 }, { type: "triple", min_value: 1 }] };

  it("activates an option on any one of several dice requirements", () => {
    const { leaves, text } = poolLeaves(anyOf);
    const result = compileLeaves(leaves, text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const pool = first(result.mechanics, "dice-pool-allocation")!;
    const options = pool.options as Array<Record<string, unknown>>;
    expect(options.map((option) => option.requirement)).toEqual([{ type: "pair", min_value: 1 }, { any_of: [{ type: "pair", min_value: 4 }, { type: "triple", min_value: 1 }] }]);
  });

  it("compiles an option with its own moment as an ability-part, and a plain option as its effect", () => {
    const { leaves, text } = poolLeaves(anyOf);
    const result = compileLeaves(leaves, text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const [plain, timed] = (first(result.mechanics, "dice-pool-allocation")!.options as Array<{ effect: Record<string, unknown> }>);
    expect(plain!.effect.type).not.toBe("ability-part");
    expect(timed!.effect.type).toBe("ability-part");
    expect(timed!.effect.trigger).toBeDefined();
    expect(first(timed!.effect, "roll-modifier") ?? first(timed!.effect, "modifier")).toBeDefined();
  });

  it("passes the DSL schema with both kinds of option", () => {
    const enrichment = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
    const authored = (JSON.parse(readFileSync(join(enrichment, "world-eaters", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
      .find((item) => item.ability_id === "blessings-of-khorne-world-eaters")!;
    const { leaves, text } = poolLeaves(anyOf);
    const result = compileLeaves(leaves, text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(checkEntry(entryWithMechanics(authored, result.mechanics)).errors).toEqual([]);
  });

  it("refuses a requirement given both ways, a one-item any_of and a repeated requirement", () => {
    expect(() => normalize("named-option", { label: "Gift", requirement_type: "pair", requirement_min_value: 1, ...anyOf })).toThrow(/not both/u);
    expect(() => normalize("named-option", { label: "Gift", requirement_any_of: [{ type: "pair", min_value: 4 }] })).toThrow(/two or more/u);
    expect(() => normalize("named-option", { label: "Gift", requirement_any_of: [{ type: "pair", min_value: 4 }, { type: "pair", min_value: 4 }] })).toThrow(/twice/u);
    expect(() => normalize("named-option", { label: "Gift", requirement_any_of: [{ type: "pair", min_value: 7 }, { type: "triple", min_value: 1 }] })).toThrow();
  });
});

describe("container option bounds", () => {
  it("starts each named option at its marker, past a missing full stop and through a colon", () => {
    const text = [
      "Roll six D6 and spend them to activate up to two Gifts. Each Gift lasts until the end of the battle round.",
      "Gift One can be activated with any double. Weapons equipped by models in this unit have the [LETHAL HITS] ability",
      "Gift Two can be activated with any triple. At the start of the Fight phase: this unit has +1 to hit rolls.",
    ].join("\n");
    const { leaves } = placed(text, [
      ["Roll six D6 and spend them to activate up to two Gifts", "dice-pool-allocation-open", { pool_count: 6, pool_die: "D6", max_activations: 2 }],
      ["until the end of the battle round", "duration", { endpoint: "end-of-battle-round" }],
      ["Gift One can be activated with any double", "named-option", { label: "Gift One", requirement_type: "pair", requirement_min_value: 1 }],
      ["Weapons equipped by models in this unit have the", "weapon-ability-grant", { subject: "this-unit", weapon_type: "all" }],
      ["LETHAL HITS", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
      ["Gift Two can be activated with any triple", "named-option", { label: "Gift Two", requirement_type: "triple", requirement_min_value: 1 }],
      ["At the start of the Fight phase", "event", { kind: "phase-start", phase: "fight", turn: "either" }],
      ["this unit has +1 to hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ]);
    const result = compileLeaves(leaves, text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const options = first(result.mechanics, "dice-pool-allocation")!.options as Array<{ name: string; effect: Record<string, unknown> }>;
    expect(options.map((option) => option.name)).toEqual(["Gift One", "Gift Two"]);
    expect(first(options[0]!.effect, "named-option")).toBeUndefined();
    expect(options[1]!.effect.type).toBe("ability-part");
    // The ability-wide sentence before the first option leaves the container: its duration is the ability's.
    expect((result.mechanics as { scope: Record<string, unknown> }).scope.duration).toBe("battle-round");
  });

  it("folds weapon keywords once, so an option compiled again keeps its grant", () => {
    const text = "Melee weapons equipped by models in this unit have the [LETHAL HITS] ability.";
    const { leaves } = placed(text, [
      ["Melee weapons equipped by models in this unit have the", "weapon-ability-grant", { subject: "this-unit", weapon_type: "melee" }],
      ["LETHAL HITS", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
    ]);
    const once = foldWeaponKeywords(leaves, text);
    expect(foldWeaponKeywords(once, text)).toEqual(once);
  });

  it("keeps refusing a non-effect leaf in a sentence-split choice, which may cut one option in two", () => {
    const text = "You can choose one of the following: Gain 1CP. Take a Leadership test for this model; if that test is passed, gain 1CP.";
    const { leaves } = placed(text, [
      ["choose one of the following", "choice-open", { min_choices: 1, max_choices: 1 }],
      ["Gain 1CP", "resource-gain", { pool: "command-point", amount: 1 }],
      ["Take a Leadership test for this model", "test", { target: "this-model", test: "leadership" }],
      ["if that test is passed", "roll-outcome", { roll: "leadership", result: "success" }],
      ["gain 1CP", "resource-gain", { pool: "command-point", amount: 1 }],
    ]);
    const result = compileLeaves(leaves, text);
    expect(result.ok ? "compiled" : result.errors.join()).toMatch(/only hold effect leaves/u);
  });
});

describe("Cult Ambush", () => {
  it("measures a distance to a named marker", () => {
    const { leaves, text } = placed("This unit is within 8\" of a hidden marker. This unit has +1 to hit rolls.", [
      ["This unit is within 8\" of a hidden marker", "unit-position", { kind: "within", inches: 8, subject: "this-unit", of: "marker", of_marker: "cult-ambush-marker", negated: false }],
      ["This unit has +1 to hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1 }],
    ]);
    const result = compileLeaves(leaves, text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(nodes(result.mechanics, (node) => node.type === "matches")[0]!.parameters)
      .toEqual({ filter: { within: { of: { marker: "cult-ambush-marker" }, range: { inches: 8 } } } });
  });

  it("names the marker only with of: marker", () => {
    expect(() => normalize("unit-position", { kind: "within", inches: 8, subject: "this-unit", of: "marker", negated: false })).toThrow(/kebab-case/u);
    expect(() => normalize("unit-position", { kind: "within", inches: 8, subject: "this-unit", of: "this-unit", of_marker: "cult-ambush-marker", negated: false })).toThrow(/of: marker/u);
  });

  it("names units in Cult Ambush by their own state, not as Strategic Reserves", () => {
    for (const [held, state] of [["cult-ambush", "in-cult-ambush"], ["strategic-reserves", "in-strategic-reserves"]] as const) {
      const { leaves, text } = placed("Units held aside cannot be targeted with the Swift Arrival Stratagem.", [
        ["Units held aside", "unit-filter", { side: "friendly", held_in: held }],
        ["cannot be targeted with the Swift Arrival Stratagem", "targeting-restriction", { may: "cannot-target", kind: "stratagem", weapon_type: "all", target: "antecedent", stratagem: "rapid-ingress" }],
      ]);
      const result = compileLeaves(leaves, text);
      if (!result.ok) throw new Error(result.errors.join("; "));
      expect(first(result.mechanics, "targeting")!.modifier).toMatchObject({ target: { owner: "friendly", state }, stratagem: "rapid-ingress" });
    }
  });

  it("keeps everything an added copy carries, Cult Ambush included", () => {
    const copy = { source: "copy-of-destroyed", count: "1" };
    expect(() => normalize("add-unit", { source: "datasheet", datasheet: "alpha-squad", count: "1", copy_excluded_keywords: ["CHARACTER"] })).toThrow(/copy/u);
    expect(normalize("add-unit", { ...copy, copy_excluded_keywords: ["character"], at_starting_strength: true, reset_one_shot: true, held_in: "cult-ambush" }))
      .toEqual({ ...copy, copy_excluded_keywords: ["CHARACTER"], at_starting_strength: true, reset_one_shot: true, held_in: "cult-ambush" });
    const compile = (parameters: Record<string, unknown>) => compileLeaves(placed("Add a new unit to your army.", [["Add a new unit to your army", "add-unit", parameters]]).leaves, "Add a new unit to your army.");
    const whole = compile({ ...copy, copy_excluded_keywords: ["CHARACTER"], at_starting_strength: true, reset_one_shot: true, held_in: "cult-ambush" });
    if (!whole.ok) throw new Error(whole.errors.join("; "));
    const modifier = first(whole.mechanics, "add-unit")!.modifier as Record<string, unknown>;
    expect(modifier).toEqual({ copy_of: "event-object", count: 1, excluded_keywords: ["CHARACTER"], at_starting_strength: true, reset_one_shot: true, placement: "cult-ambush" });
    // The lowered copy passes the DSL schema, carried on any authored entry.
    const host = (JSON.parse(readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment"), "world-eaters", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)[0]!;
    expect(checkEntry(entryWithMechanics(host, whole.mechanics)).errors).toEqual([]);
    const reserves = compile({ ...copy, held_in: "strategic-reserves" });
    if (!reserves.ok) throw new Error(reserves.errors.join("; "));
    expect(first(reserves.mechanics, "add-unit")!.modifier).toEqual({ copy_of: "event-object", count: 1, placement: "strategic-reserves" });
  });
});
