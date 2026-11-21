import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import type { CompileLeaf } from "../src/semantic-authoring/compile-fragments.js";
import { normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { mapToLatest } from "../src/semantic-authoring/family-versions.js";
import { expectCompiled, expectRefused, placed } from "./semantic-authoring-connective-fixture.js";

// A pool both players hold, a region extended over areas, a section of a rule switched off, and who
// picks destroyed models. Wording is fabricated.

const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters);
const byStart = (...lists: CompileLeaf[][]) => lists.flat().sort((a, b) => a.start_byte - b.start_byte);
const region = { region_id: "the-gloom", owner_faction: "example-faction" };

describe("the families", () => {
  it("reads the opponent's holding only as a bound on what they hold now", () => {
    expect(normalize("resource", { pool: "flux-token-pool", at_least: 1, holder: "opponent" })).toEqual({ pool: "flux-token-pool", at_least: 1, holder: "opponent" });
    expect(() => normalize("resource", { pool: "flux-token-pool", at_least: 1, holder: "opponent", gained_this_turn: true })).toThrow(/holder opponent/u);
    expect(() => normalize("resource", { pool: "flux-token-pool", at_least: 1, holder: "you" })).toThrow();
  });

  it("reads a Flux token spend as a trigger, never as this use", () => {
    expect(normalize("optional-cost-paid", { pool: "flux-token-pool", window: "trigger", subject: "this-unit", tag: "pyrogenesis-flux-spent" })).toMatchObject({ pool: "flux-token-pool", holder: "this-unit" });
    expect(() => normalize("optional-cost-paid", { pool: "flux-token-pool", window: "use", subject: "this-unit" })).toThrow(/window trigger/u);
  });

  it("lets the controlling player pick some destroyed models, never all of them", () => {
    expect(normalize("destroy-models", { recipient: "event-subject", count: "1", chosen_by: "controlling-player" })).toMatchObject({ chosen_by: "controlling-player" });
    expect(() => normalize("destroy-models", { recipient: "event-subject", count: "all", chosen_by: "controlling-player" })).toThrow(/nothing to choose/u);
  });

  it("switches off a section of a suppressed faction rule only, with its aspect", () => {
    const base = { subject: "antecedent", direction: "suppressed", rule_kind: "faction-rule", rule: "example-army-rule" };
    expect(normalize("rule-state", { ...base, sub_rule: "example-terror", aspect: "mortal-wounds" })).toMatchObject({ sub_rule: "example-terror", aspect: "mortal-wounds" });
    expect(() => normalize("rule-state", { ...base, sub_rule: "example-terror" })).toThrow(/together/u);
    expect(() => normalize("rule-state", { ...base, direction: "granted", sub_rule: "example-terror", aspect: "mortal-wounds" })).toThrow(/suppressed faction rule/u);
    expect(() => normalize("rule-state", { ...base, rule_kind: "ability", sub_rule: "example-terror", aspect: "mortal-wounds" })).toThrow(/suppressed faction rule/u);
  });

  it("takes only each area's own keys", () => {
    expect(() => normalize("region-extend", { ...region, area: "territory", territory: "no-mans-land", inches: 6 })).toThrow();
    expect(() => normalize("region-extend", { ...region, area: "selected", territory: "no-mans-land" })).toThrow();
    expect(() => normalize("region-extend", { ...region, area: "objective-range", inches: 6, objective_tag: "not-a-designation" })).toThrow(/registered designation/u);
    expect(() => normalize("area-select", { territories: ["no-mans-land"], select: "one" })).toThrow(/at least two/u);
    expect(() => normalize("area-select", { territories: ["no-mans-land", "no-mans-land"], select: "one" })).toThrow();
  });

  it("tags a secured marker only with a registered designation, never the selected objective", () => {
    expect(normalize("sticky-objective", { tag: "corrupted" })).toEqual({ tag: "corrupted" });
    expect(() => normalize("sticky-objective", { tag: "not-a-designation" })).toThrow(/registered designation/u);
    expect(() => normalize("sticky-objective", { subject: "selected-objective", tag: "corrupted" })).toThrow(/selected objective/u);
  });

  it("maps every earlier leaf of a bumped family unchanged", () => {
    for (const [family, from] of [["resource", 2], ["optional-cost-paid", 2], ["destroy-models", 4], ["rule-state", 4], ["sticky-objective", 4], ["apply-mark", 9]] as const) {
      const parameters = { probe: family };
      expect(mapToLatest(family, from, parameters)).toMatchObject({ family, parameters });
    }
  });
});

describe("selected areas of a region", () => {
  const text = "Any phase. Select the Wastes or the far zone, or spend one Glim token and select both. Until the end of the phase, the selected areas are within your army's Gloom.";
  const one = ["Select the Wastes or the far zone", "area-select", { territories: ["no-mans-land", "enemy-deployment-zone"], select: "one" }] as const;
  const spend = ["spend one Glim token", "resource-spend", { pool: "flux-token-pool", amount: 1 }] as const;
  const all = (territories: string[]) => ["select both", "area-select", { territories, select: "all" }] as const;
  const duration = ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }] as const;
  const extend = ["the selected areas are within your army's Gloom", "region-extend", { ...region, area: "selected" }] as const;

  it("offers each area alone, or every area for the spend before the select all", () => {
    const result = compileLeaves(placed(text, one, spend, all(["no-mans-land", "enemy-deployment-zone"]), duration, extend), text);
    expectCompiled(result);
    const json = JSON.stringify(result.mechanics.effect);
    const area = (value: unknown) => JSON.stringify({ type: "region-extend", target: { owner: "friendly" }, modifier: { region, area: value } });
    expect(json).toContain(`"type":"choice","options":[${area({ territory: "no-mans-land" })},${area({ territory: "enemy-deployment-zone" })},{"type":"sequence","steps":[{"type":"resource-spend"`);
    expect(json).toContain(area({ territories: ["no-mans-land", "enemy-deployment-zone"] }));
    // The spend lives only inside its option: nothing is spent for a single area.
    expect(json.match(/"type":"resource-spend"/gu)?.length).toBe(1);
  });

  it("refuses a select all of other areas than the select one", () => {
    const result = compileLeaves(placed(text, one, spend, all(["no-mans-land", "your-deployment-zone"]), duration, extend), text);
    expectRefused(result);
    expect(result.errors.join(" ")).toMatch(/same areas/u);
  });

  it("refuses a select all no spend pays for", () => {
    const result = compileLeaves(placed(text, one, all(["no-mans-land", "enemy-deployment-zone"]), duration, extend), text);
    expectRefused(result);
    expect(result.errors.join(" ")).toMatch(/resource-spend right before it/u);
  });

  it("refuses an area-select nothing reads", () => {
    const result = compileLeaves(placed(text, one, duration), text);
    expectRefused(result);
    expect(result.errors.join(" ")).toMatch(/one region-extend with area selected/u);
  });

  it("lowers an objective range to a filter on the tag and your control", () => {
    const own = "While a marker is Tainted and under your control, the area within 6\" of it is within your army's Gloom.";
    const result = compileLeaves(placed(own, ["While a marker is Tainted and under your control, the area within 6\" of it is within your army's Gloom", "region-extend",
      { ...region, area: "objective-range", inches: 6, objective_tag: "corrupted", controlled_by: "you" }]), own);
    expectCompiled(result);
    expect(JSON.stringify(result.mechanics.effect)).toContain('"area":{"objective_range":{"objective":{"designated":"corrupted","controlled_by":"friendly"},"inches":6}}');
  });
});

describe("an optional spend inside the sentence it replaces", () => {
  const text = "Until the end of the phase, add 2 to the Strength characteristic of weapons equipped by models in your unit, or spend one Glim token and add 3 to the Strength characteristic of those weapons and improve the Armour Penetration characteristic of those weapons by 1 instead.";
  const read = { pool: "flux-token-pool", window: "trigger", subject: "this-unit", tag: "pyrogenesis-flux-spent", holder: "this-unit" };
  const plus3 = "add 3 to the Strength characteristic of those weapons";
  const ap = "improve the Armour Penetration characteristic of those weapons by 1";
  const leaves = (withReads: boolean) => byStart(
    placed(text,
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["add 2 to the Strength characteristic of weapons equipped by models in your unit", "characteristic-modifier", { subject: "this-unit", characteristics: ["S"], operation: "add", value: 2, weapon_type: "all" }],
      ["spend one Glim token", "resource-spend", { pool: "flux-token-pool", amount: 1 }],
      [plus3, "characteristic-modifier", { subject: "this-unit", characteristics: ["S"], operation: "add", value: 3, weapon_type: "all" }],
      [ap, "characteristic-modifier", { subject: "this-unit", characteristics: ["AP"], operation: "improve", value: 1, weapon_type: "all" }],
      ["instead", "instead", {}]),
    placed(text, ["spend one Glim token", "optional-use", { who: "you" }]),
    withReads ? placed(text, [plus3, "optional-cost-paid", read], [ap, "optional-cost-paid", read]) : []);

  it("gates the effects before the spend off when it is paid, and the effects after it on", () => {
    const result = compileLeaves(leaves(true), text);
    expectCompiled(result);
    const json = JSON.stringify(result.mechanics.effect);
    const spent = '{"type":"matches","parameters":{"subject":"this-unit","filter":{"designated":"pyrogenesis-flux-spent"}}}';
    expect(json).toContain(`"condition":{"operator":"not","operands":[${spent}]},"effect":{"type":"stat-modifier","target":"this-unit","modifier":{"stat":"S","operation":"add","value":2`);
    expect(json.match(new RegExp(`"condition":${spent.replace(/[{}[\]]/gu, "\\$&")},"effect":\\{"type":"stat-modifier"`, "gu"))?.length).toBe(2);
    expect(json).toContain('"type":"ability-part","optional":true');
  });

  it("refuses the replacement when nothing says the spend was paid", () => {
    expectRefused(compileLeaves(leaves(false), text));
  });
});
