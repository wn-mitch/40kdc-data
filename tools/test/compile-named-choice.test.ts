import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkDslContract } from "../src/integrity-dsl-contract.js";
import { compileLeaves } from "../src/semantic-authoring/compile.js";
import { normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { mapToLatest } from "../src/semantic-authoring/family-versions.js";
import type { ValidationResult } from "../src/validate.js";
import { expectCompiled, placed } from "./semantic-authoring-connective-fixture.js";

// A choice other rules name as an option of its record and make happen again, with its range,
// amount and how often one unit receives it changed by those rules. Wording and ids are fabricated.

const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters);
const renew = { ability_id: "the-example-rite", option_id: "renew" };

describe("the families", () => {
  it("names a choice by a kebab-case id, never on an activation's pick", () => {
    expect(normalize("choice-open", { id: "renew", choice_label: "renew" })).toEqual({ id: "renew", choice_label: "renew" });
    expect(() => normalize("choice-open", { id: "Renew Now" })).toThrow(/kebab-case/u);
    expect(() => normalize("choice-open", { id: "renew", ignore_consumed: true })).toThrow(/takes none/u);
  });

  it("resolves an option immediately only when it names that one option", () => {
    const base = { subject: "this-unit", ability: "the-example-rite" };
    expect(normalize("ability-activate", { ...base, option: "renew", immediate: true })).toEqual({ ...base, option: "renew", immediate: true });
    expect(() => normalize("ability-activate", { ...base, immediate: true })).toThrow(/one named option/u);
    expect(() => normalize("ability-activate", { ...base, chosen: true, immediate: true })).toThrow(/one named option/u);
    expect(() => normalize("ability-activate", { ...base, option: "renew", additive: true, immediate: true })).toThrow(/one named option/u);
  });

  it("changes one option of a record, and sets how often one unit receives it", () => {
    const base = { subject: "this-unit", ability: renew, operation: "set" };
    expect(normalize("ability-modifier", { ...base, aspect: "amount", value: 3 })).toMatchObject({ ability: renew, aspect: "amount", value: 3 });
    expect(normalize("ability-modifier", { ...base, aspect: "received", value: 2 })).toMatchObject({ aspect: "received", value: 2 });
    expect(() => normalize("ability-modifier", { ...base, operation: "add", aspect: "received", value: 1 })).toThrow(/operation is set/u);
    expect(() => normalize("ability-modifier", { ...base, aspect: "amount" })).toThrow(/value is required/u);
    expect(() => normalize("ability-modifier", { ...base, ability: { ...renew, extra: true }, aspect: "range", value: 9 })).toThrow();
  });

  it("returns only models without an excluded keyword", () => {
    expect(normalize("return-models", { subject: "antecedent", count: "1", model_keyword: "INFANTRY", exclude_model_keyword: "CHARACTER" }))
      .toMatchObject({ model_keyword: "INFANTRY", exclude_model_keyword: "CHARACTER" });
  });

  it("maps every earlier leaf of a bumped family unchanged", () => {
    for (const [family, from] of [["choice-open", 4], ["ability-activate", 5], ["ability-modifier", 7], ["return-models", 8]] as const) {
      const parameters = { probe: family };
      expect(mapToLatest(family, from, parameters)).toMatchObject({ family, parameters });
    }
  });
});

describe("a named choice after a selection", () => {
  const text = "In your Command phase, this unit can Renew one friendly unit. Each time a unit renews, do one of the following:\n■ One model in that unit regains up to D3 lost wounds.\n■ One destroyed model is returned to that unit. If that unit is a SWARM unit, up to 3 destroyed models are returned instead.";
  const leaves = (select: boolean, id?: string) => placed(text,
    ["In your Command phase", "phase-window", { phase: "command", turn: "your" }],
    ...(select ? [["Renew one", "select-unit", { distance: "within", inches: 6, visible: false, scope: "friendly" }] as const] : []),
    ["friendly unit", "unit-filter", { side: "friendly" }],
    ["do one of the following", "choice-open", { choice_label: "renew", ...(id ? { id } : {}) }],
    ["One model in that unit regains up to D3 lost wounds", "regain-wounds", { subject: "antecedent", amount: "D3", per: "one-model" }],
    ["One destroyed model is returned to that unit", "return-models", { subject: "antecedent", count: "1", exclude_model_keyword: "CHARACTER" }],
    ["that unit is a SWARM unit", "unit-keyword", { keywords: ["SWARM"], subject: "antecedent", negated: false }],
    ["up to 3 destroyed models are returned", "return-models", { subject: "antecedent", count: "3" }],
    ["instead", "instead", {}],
  );

  it("names the choice by its id and lets an option with its own condition read the outer selection", () => {
    const result = compileLeaves(leaves(true, "renew"), text);
    expectCompiled(result);
    const json = JSON.stringify(result.mechanics.effect);
    expect(json).toContain('"type":"choice","options":');
    expect(json).toContain('"choice_label":"renew","id":"renew"');
    expect(json).toContain('"member_of":"selected-unit","none_of":["CHARACTER"]');
    expect(json).toContain('"type":"return-models","target":"selected-unit","modifier":{"count":3}');
  });

  it("keeps an option's that unit on this unit when nothing selected one", () => {
    const result = compileLeaves(leaves(false, "renew").filter((leaf) => leaf.family_id !== "unit-filter"), text);
    expectCompiled(result);
    const json = JSON.stringify(result.mechanics.effect);
    expect(json).not.toContain("selected-unit");
    expect(json).toContain('"type":"return-models","target":"this-unit","modifier":{"count":3}');
  });
});

describe("activating a named choice", () => {
  const text = "Your unit immediately Renews (see the Rite). If your unit is a SWARM unit, that model regains up to 3 lost wounds instead of D3.";
  it("resolves the option once without replacing an active option, and sets its amount", () => {
    const result = compileLeaves(placed(text,
      ["Your unit immediately Renews (see the Rite)", "ability-activate", { subject: "this-unit", ability: "the-example-rite", option: "renew", immediate: true }],
      ["your unit is a SWARM unit", "unit-keyword", { keywords: ["SWARM"], subject: "this-unit", negated: false }],
      ["that model regains up to 3 lost wounds instead of D3", "ability-modifier", { subject: "this-unit", ability: renew, aspect: "amount", operation: "set", value: 3 }],
    ), text);
    expectCompiled(result);
    const json = JSON.stringify(result.mechanics.effect);
    expect(json).toContain('{"type":"ability-activate","target":"this-unit","modifier":{"ability":"the-example-rite","option":"renew","immediate":true}}');
    expect(json).not.toContain('"exclusive"');
    expect(json).toContain('"modifier":{"ability":{"ability_id":"the-example-rite","option_id":"renew"},"aspect":"amount","operation":"set","value":3}');
  });
});

describe("integrity of a named choice", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
  const rite = (id: string | undefined, nested?: unknown) => ({
    ability_id: "the-example-rite",
    effect: { type: "sequence", steps: [
      { type: "choice", ...(id ? { id } : {}), options: [{ type: "no-effect" }, { type: "no-effect" }] },
      ...(nested ? [nested] : []),
    ] },
  });
  const user = (effect: unknown) => ({ ability_id: "renewing-strike", effect });
  async function issues(abilities: unknown[]) {
    const root = mkdtempSync(join(tmpdir(), "named-choice-"));
    roots.push(root);
    const file = join(root, "enrichment/example/abilities.json");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(abilities));
    const result: ValidationResult = { totalFiles: 0, totalItems: 0, passed: 0, failed: 0, errors: [] };
    await checkDslContract(root, result);
    return result.errors.flatMap((entry) => entry.errors).map((error) => error.message);
  }
  const activate = { type: "ability-activate", target: "this-unit", modifier: { ability: "the-example-rite", option: "renew", immediate: true } };
  const modify = { type: "ability-modifier", target: "this-unit", modifier: { ability: renew, aspect: "received", operation: "set", value: 2 } };

  it("resolves an activation and a modifier to the choice's id", async () => {
    expect(await issues([rite("renew"), user(activate), user(modify)])).toEqual([]);
  });

  it("refuses both when the choice carries no id", async () => {
    expect(await issues([rite(undefined), user(activate), user(modify)])).toEqual([
      'option "renew" is absent from ability "the-example-rite"',
      'option "renew" is absent from ability "the-example-rite"',
    ]);
  });

  it("refuses two choices with one id in a record", async () => {
    const twin = { type: "choice", id: "renew", options: [{ type: "no-effect" }, { type: "no-effect" }] };
    expect(await issues([rite("renew", twin)])).toEqual(['duplicate option id "renew" within this ability']);
  });
});
