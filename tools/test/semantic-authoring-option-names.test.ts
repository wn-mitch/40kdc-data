/**
 * A choice's option names come from its named-option leaves, in the order the compiler builds
 * the options, and publication writes them beside the effect. Fabricated wording throughout.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";
import { choiceOptionNames } from "../src/semantic-authoring/option-names.js";
import { projectRecords } from "../src/semantic-authoring/publication-projection.js";
import { optionNamesError } from "../src/integrity-option-names.js";
import { sourceDigest } from "../src/source-digest.js";

type Item = [string, string, Record<string, unknown>];

function placed(text: string, ...items: Item[]): CompileLeaf[] {
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

const TEXT = "At the start of the battle, select one of the Hexes below. Until the end of the battle, while an enemy unit is Marked, "
  + "subtract 1 from the Toughness characteristic of models in that unit, and that unit has the effect of your chosen Hex. "
  + "Hex of Rust: Each time a model in this unit makes a ranged attack, enemy units have the benefit of cover against the attack. "
  + "Hex of Lead: Worsen the Move characteristic of models in this unit by 1.";

const LEAVES = placed(TEXT,
  ["At the start of the battle", "event", { kind: "battle-formations-declared" }],
  ["select one of the Hexes below", "choice-open", { choice_label: "hex", min_choices: 1, max_choices: 1 }],
  ["Until the end of the battle", "duration", { endpoint: "end-of-battle" }],
  ["enemy unit", "unit-filter", { side: "enemy" }],
  ["Marked", "designated-filter", { tag: "afflicted" }],
  ["subtract 1 from the Toughness characteristic of models in that unit", "characteristic-modifier", { subject: "antecedent", characteristics: ["T"], operation: "subtract", value: 1, weapon_type: "all" }],
  ["that unit has the effect of your chosen Hex", "chosen-option-grant", { holder: "antecedent" }],
  ["Hex of Rust", "named-option", { label: "Hex of Rust", option_id: "hex-of-rust" }],
  ["Each time a model in this unit makes a ranged attack", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged" }],
  ["enemy units have the benefit of cover against the attack", "core-ability-grant", { subject: "target", ability: "benefit-of-cover" }],
  ["Hex of Lead", "named-option", { label: "Hex of Lead", option_id: "hex-of-lead" }],
  ["Worsen the Move characteristic of models in this unit by 1", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "worsen", value: 1, weapon_type: "all" }],
);

function compiledEffect(leaves: readonly CompileLeaf[]): Record<string, any> {
  const result = compileLeaves(leaves, TEXT);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics.effect as Record<string, any>;
}

function choiceOf(effect: Record<string, any>): Record<string, any> {
  const found: Record<string, any>[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      if ((node as Record<string, unknown>).type === "choice") found.push(node as Record<string, any>);
      Object.values(node).forEach(walk);
    }
  };
  walk(effect);
  expect(found).toHaveLength(1);
  return found[0]!;
}

describe("choiceOptionNames", () => {
  it("names each compiled option by the named-option leaf that heads it", () => {
    const effect = compiledEffect(LEAVES);
    const names = choiceOptionNames(LEAVES, effect);
    expect(names).toEqual(["Hex of Rust", "Hex of Lead"]);
    // The second name labels the option the second named-option's leaves compiled into.
    expect(JSON.stringify(choiceOf(effect).options[1])).toContain('"stat":"M"');
    expect(JSON.stringify(choiceOf(effect).options[0])).toContain("benefit-of-cover");
  });

  it("reads the names in source order whatever order the leaves arrive in", () => {
    const effect = compiledEffect(LEAVES);
    expect(choiceOptionNames([...LEAVES].reverse(), effect)).toEqual(["Hex of Rust", "Hex of Lead"]);
  });

  it("gives no names when the effect holds two choices", () => {
    const effect = compiledEffect(LEAVES);
    const choice = choiceOf(effect);
    expect(choiceOptionNames(LEAVES, { type: "sequence", steps: [choice, choice] })).toBeNull();
  });

  it("gives no names when the labels do not number the options", () => {
    const effect = compiledEffect(LEAVES);
    const oneLabel = LEAVES.filter((leaf) => !(leaf.family_id === "named-option" && leaf.parameters.label === "Hex of Lead"));
    expect(choiceOptionNames(oneLabel, effect)).toBeNull();
  });

  it("gives no names when another opener names options of its own", () => {
    const effect = compiledEffect(LEAVES);
    const withStance = [...LEAVES, { ...LEAVES[1]!, family_id: "stance-select-open", start_byte: 0 }];
    expect(choiceOptionNames(withStance, effect)).toBeNull();
  });
});

describe("optionNamesError", () => {
  const choice = { type: "choice", options: [{ type: "a" }, { type: "b" }] };
  it.each([
    [{ effect: choice }, null],
    [{ effect: choice, option_names: ["A", "B"] }, null],
    [{ effect: choice, option_names: ["A"] }, "option_names gives 1 names for a choice of 2 options"],
    [{ effect: choice, option_names: ["A", "A"] }, "option_names repeats a name"],
    [{ effect: { type: "sequence", steps: [choice, choice] }, option_names: ["A", "B"] }, "option_names needs exactly one choice effect; the record has 2"],
    [{ effect: { type: "a" }, option_names: ["A", "B"] }, "option_names needs exactly one choice effect; the record has 0"],
  ])("%j → %s", (row, expected) => {
    expect(optionNamesError(row as Record<string, unknown>)).toBe(expected);
  });
});

describe("projectRecords option_names", () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function root(entry: Record<string, unknown>): string {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "option-names-")));
    directories.push(directory);
    mkdirSync(join(directory, "enrichment", "fixture-faction"), { recursive: true });
    writeFileSync(join(directory, "enrichment", "fixture-faction", "abilities.json"), `${JSON.stringify([entry], null, 2)}\n`);
    return directory;
  }

  const effect = compiledEffect(LEAVES);
  const entry = {
    ability_id: "fixture-hexes", name: "Fixture hexes", faction_id: "fixture-faction", ability_type: "unit",
    authored_by: "40kdc-community", game_version: { edition: "11th", dataslate: "2026-10-14" }, version: "2025-q3",
    effect, scope: { duration: "permanent" },
  };
  const row = (option_names?: string[] | null) => ({
    id: "row", ability_id: "fixture-hexes", core: null, source_digest: sourceDigest(TEXT),
    mechanics: { effect, scope: { duration: "permanent" } } as never,
    ...(option_names === undefined ? {} : { option_names }),
  });

  it("writes the names it is given and reports them in the diff", () => {
    const projection = projectRecords(root(entry), "fixture-faction", [row(["Hex of Rust", "Hex of Lead"])]);
    expect(projection.entries[0]!.option_names).toEqual(["Hex of Rust", "Hex of Lead"]);
    expect(projection.diff[0]!.fields.map((field) => field.field)).toContain("option_names");
  });

  it("removes names a compile can no longer read, and keeps them when given none", () => {
    const named = { ...entry, option_names: ["Hex of Rust", "Hex of Lead"] };
    expect(projectRecords(root(named), "fixture-faction", [row(null)]).entries[0]).not.toHaveProperty("option_names");
    expect(projectRecords(root(named), "fixture-faction", [row()]).entries[0]!.option_names).toEqual(["Hex of Rust", "Hex of Lead"]);
  });
});
