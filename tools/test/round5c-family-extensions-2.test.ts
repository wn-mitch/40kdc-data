import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileLeaves } from "../src/round5c/compile.js";
import type { CompileLeaf } from "../src/round5c/compile-fragments.js";
import { coreCheckErrors } from "../src/round5c/core-checks.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { mapToLatest } from "../src/round5c/family-versions.js";

let at = 0;
function leaf(family_id: string, parameters: Record<string, unknown>): CompileLeaf {
  const family_version = currentFamilyVersion(family_id);
  at += 10;
  return { role: familyRole(family_id, family_version), family_id, family_version, parameters: normalizeFingerprintParameters(family_id, parameters, family_version), start_byte: at };
}
const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

function nodes(tree: unknown, test: (node: Record<string, unknown>) => boolean): Array<Record<string, unknown>> {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, test));
  if (tree === null || typeof tree !== "object") return [];
  const node = tree as Record<string, unknown>;
  return [...(test(node) ? [node] : []), ...Object.values(node).flatMap((value) => nodes(value, test))];
}
function compiled(leaves: CompileLeaf[]): Record<string, unknown> {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Record<string, unknown>;
}
const first = (tree: unknown, type: string) => nodes(tree, (node) => node.type === type)[0];

const heal = () => leaf("regain-wounds", { subject: "this-unit", amount: "1" });
const target = () => ({ ...leaf("stratagem-target", { count: "one", side: "your-army", selects: "unit", keywords: ["INFANTRY"], match: "all", excluded_keywords: [] }), fragment: "TARGET" });

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Round 5C family extensions, second round", () => {
  it("keeps every earlier leaf of a widened family, which moves across unchanged", () => {
    for (const [family, parameters] of [
      ["roll-modifier", { roll: "charge", operation: "add", value: 1 }],
      ["make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }],
      ["characteristic-modifier", { subject: "this-unit", characteristics: ["S"], operation: "add", value: 1, weapon_type: "melee" }],
      ["unit-activity", { activities: ["advanced-this-turn"], subject: "this-unit", negated: false }],
      ["unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "selected-unit", negated: false }],
      ["leading-unit", { subject: "this-model", attachment: "leading" }],
      ["select-unit", { scope: "enemy", distance: "within", inches: 12, visible: true }],
      ["battle-round", { min: 3 }],
      ["event", { kind: "step-started", step: "battle-shock" }],
      ["weapon-ability-grant", { subject: "this-unit", keyword: "Lethal Hits", weapon_type: "all" }],
      ["feel-no-pain", { subject: "this-unit", threshold: 5, against: "all" }],
    ] as const) {
      const version = currentFamilyVersion(family);
      expect(normalizeFingerprintParameters(family, parameters, version - 1), family).toEqual(normalizeFingerprintParameters(family, parameters, version));
      expect(mapToLatest(family, version - 1, parameters), family).toEqual({ family, version, parameters: normalizeFingerprintParameters(family, parameters, version) });
    }
  });

  it("binds 'that unit' in grants, Feel No Pain, healing and returned models to a Stratagem's target, and refuses a selection it cannot name", () => {
    for (const [family, parameters] of [
      ["weapon-ability-grant", { keyword: "Lethal Hits", weapon_type: "melee" }],
      ["keyword-grant", { keywords: ["FLY"] }],
      ["feel-no-pain", { threshold: 5, against: "all" }],
      ["regain-wounds", { amount: "D3" }],
      ["return-models", { count: "1" }],
    ] as const) {
      const tree = compiled([target(), leaf(family, { subject: "antecedent", ...parameters })]);
      expect(JSON.stringify(tree), family).not.toContain("antecedent");
      // A selected enemy unit is not a unit these families can name: compiling refuses, never guesses.
      const refused = compileLeaves([leaf("select-unit", { scope: "enemy", distance: "any", visible: false }), leaf(family, { subject: "antecedent", ...parameters })]);
      expect(refused, family).toMatchObject({ ok: false, errors: [expect.stringMatching(/cannot name/u)] });
    }
    // unit-has-ability names a selected unit, so its antecedent binds there.
    const has = first(compiled([leaf("select-unit", { scope: "enemy", distance: "any", visible: false }), leaf("unit-has-ability", { subject: "antecedent", ability: "lone-operative", negated: true }), heal()]), "has-ability");
    expect(has).toMatchObject({ parameters: { subject: "selected-unit", ability: "lone-operative" } });
  });

  it("changes Desperate Escape and Hazardous tests, and limits a weapon roll change to melee or ranged", () => {
    expect(first(compiled([leaf("roll-modifier", { roll: "desperate-escape", operation: "subtract", value: 1 })]), "roll-modifier")).toMatchObject({ modifier: { roll: "desperate-escape", operation: "subtract", value: 1 } });
    const melee = first(compiled([leaf("roll-modifier", { roll: "wound", operation: "subtract", value: 1, weapon_type: "melee" })]), "roll-modifier");
    expect(melee!.modifier).toEqual({ roll: "wound", operation: "subtract", value: 1, weapon_type: "melee" });
    // all limits nothing, so it is not written.
    expect(first(compiled([leaf("roll-modifier", { roll: "hit", operation: "add", value: 1, weapon_type: "all" })]), "roll-modifier")!.modifier).not.toHaveProperty("weapon_type");
    expect(() => normalize("roll-modifier", { roll: "charge", operation: "add", value: 1, weapon_type: "melee" })).toThrow(/Hit, Wound or Damage/u);
    expect(() => normalize("roll-modifier", { roll: "deadly-demise", operation: "add", value: 1 })).toThrow();
  });

  it("moves a dice amount plus a number, and refuses a malformed one", () => {
    expect(first(compiled([leaf("make-move", { subject: "this-unit", move_type: "normal", distance: "d3+3" })]), "move")!.modifier).toEqual({ move_type: "normal", distance: "D3+3" });
    expect(() => normalize("make-move", { subject: "this-unit", move_type: "normal", distance: "D4+1" })).toThrow(/dice amount/u);
  });

  it("limits a characteristic change to weapons with one ability, only with a weapon scope", () => {
    const stat = first(compiled([leaf("characteristic-modifier", { subject: "this-unit", characteristics: ["S"], operation: "add", value: 1, weapon_type: "ranged", weapon_keyword: "Torrent" })]), "stat-modifier");
    expect(stat!.modifier).toEqual({ stat: "S", operation: "add", value: 1, weapon_type: "ranged", weapon_keyword: "Torrent" });
    expect(() => normalize("characteristic-modifier", { subject: "this-unit", characteristics: ["S"], operation: "add", value: 1, weapon_keyword: "Torrent" })).toThrow(/weapon_type/u);
    expect(() => normalize("characteristic-modifier", { subject: "this-unit", characteristics: ["S"], operation: "add", value: 1, weapon_type: "all", weapon_keyword: "Flamer" })).toThrow();
  });

  it("reads a declared charge this phase and a Fall Back this turn as history", () => {
    const happened = (activities: string[]) => nodes(compiled([leaf("unit-activity", { activities, subject: "this-unit", negated: false }), heal()]), (node) => node.type === "happened").map((node) => node.parameters);
    expect(happened(["declared-charge-this-phase"])).toEqual([{ event: "targets-selected", filter: { kind: "charge" }, window: "phase" }]);
    expect(happened(["fell-back-this-turn", "advanced-this-turn"])).toHaveLength(2);
    expect(normalize("unit-activity", { activities: ["fell-back-this-turn", "advanced-this-turn"], subject: "this-unit", negated: false }).activities).toEqual(["advanced-this-turn", "fell-back-this-turn"]);
    expect(() => normalize("unit-activity", { activities: ["fell-back-this-turn", "fell-back-this-turn"], subject: "this-unit", negated: false })).toThrow(/twice/u);
  });

  it("measures wholly within, only for a within distance", () => {
    const within = first(compiled([leaf("unit-position", { kind: "within", inches: 6, subject: "this-unit", negated: false, of: "matching-unit", of_keywords: ["HARVESTER"], of_side: "friendly", wholly: true }), heal()]), "within");
    expect(within!.parameters).toMatchObject({ wholly: true, range: { inches: 6 } });
    expect(() => normalize("unit-position", { kind: "beyond", inches: 6, subject: "this-unit", negated: false, of: "this-model", wholly: true })).toThrow(/within distance/u);
  });

  it("measures a distance to any unit of a side, with no keywords", () => {
    const near = leaf("unit-position", { kind: "within", inches: 3, subject: "this-unit", negated: false, of: "matching-unit", of_side: "enemy" });
    expect(near.parameters).not.toHaveProperty("of_keywords");
    expect(first(compiled([near, heal()]), "within")!.parameters).toMatchObject({ of: { owner: "enemy" }, range: { inches: 3 } });
    expect(() => normalize("unit-position", { kind: "within", inches: 3, subject: "this-unit", negated: false, of: "matching-unit" })).toThrow(/of_side/u);
  });

  it("selects several units, exactly or up to a number, and refuses a dice count", () => {
    const select = (parameters: Record<string, unknown>) => leaf("select-unit", { scope: "friendly", distance: "any", visible: false, ...parameters });
    const selector = (parameters: Record<string, unknown>) => first(compiled([select(parameters), leaf("keyword-grant", { subject: "this-unit", keywords: ["FLY"] })]), "select-units")!.selector;
    expect(selector({ count: 2, up_to: true })).toMatchObject({ max_count: 2 });
    expect(selector({ count: 3 })).toMatchObject({ count: 3 });
    expect(selector({})).toMatchObject({ count: 1 });
    expect(selector({ count: 2, up_to: true })).not.toHaveProperty("count");
    expect(() => normalize("select-unit", { distance: "any", visible: false, count: "D3" })).toThrow(/dice count/u);
    expect(() => normalize("select-unit", { distance: "any", visible: false, up_to: true })).toThrow(/needs a count/u);
    expect(() => normalize("select-unit", { distance: "any", visible: false, count: 1 })).toThrow(/by default/u);
  });

  it("names the unit a Leader is attached to", () => {
    const attached = first(compiled([leaf("leading-unit", { subject: "this-model", attachment: "leading", attached_to_keywords: ["dominion squad"] }), heal()]), "attachment");
    expect(attached).toEqual({ type: "attachment", parameters: { subject: "this-model", role: "leading", with: { all_of: ["DOMINION SQUAD"] } } });
  });

  it("holds any one of several battle rounds", () => {
    const rounds = nodes(compiled([leaf("battle-round", { rounds: [5, 1, 3] }), heal()]), (node) => node.type === "battle-round").map((node) => node.parameters);
    expect(rounds).toEqual([{ min: 1, max: 1 }, { min: 3, max: 3 }, { min: 5, max: 5 }]);
    expect(() => normalize("battle-round", { rounds: [1, 3], min: 1 })).toThrow(/not both/u);
    expect(() => normalize("battle-round", { rounds: [1, 6] })).toThrow();
  });

  it("names whose step, whose Stratagem, and who failed which roll", () => {
    const trigger = (parameters: Record<string, unknown>, leaves: CompileLeaf[] = []) => compiled([...leaves, leaf("event", parameters), heal()]).trigger as Record<string, unknown>;
    expect(trigger({ kind: "step-started", step: "battle-shock", turn: "opponent" })).toEqual({ event: "step-started", filter: { step: "battle-shock" }, condition: { type: "player-turn-is", parameters: { turn: "opponent-turn" } } });
    expect(trigger({ kind: "step-started", step: "battle-shock", turn: "either" })).not.toHaveProperty("condition");
    expect(trigger({ kind: "used", activity: "stratagem", owner: "enemy" })).toEqual({ event: "used", filter: { kind: "stratagem" }, subject: { owner: "enemy" } });
    const failed = trigger({ kind: "after-roll", roll: "battle-shock", result: "failure", subject: "antecedent" }, [leaf("select-unit", { scope: "enemy", distance: "any", visible: false })]);
    expect(failed).toEqual({ event: "after-roll", filter: { roll: "battle-shock", result: "failure" }, subject: "selected-unit" });
    expect(() => normalize("event", { kind: "used", activity: "stratagem", result: "failure" })).toThrow(/after-roll only/u);
    expect(() => normalize("event", { kind: "phase-start", phase: "command", turn: "your", owner: "enemy" })).toThrow();
  });

  it("matches a keyword printed with a curly apostrophe against one with a straight apostrophe", () => {
    const root = mkdtempSync(join(tmpdir(), "round5c-extensions-2-"));
    roots.push(root);
    mkdirSync(join(root, "core", "alpha"), { recursive: true });
    // Fabricated fixture record only.
    writeFileSync(join(root, "core", "alpha", "enhancements.json"), JSON.stringify([{ id: "curly", keyword_restriction_groups: [["Emperor’s Children", "Infantry"]] }]));
    const check = (keywords: string[]) => coreCheckErrors(root, "curly", [{ kind: "bearer-eligibility", parameters: { keywords, match: "all", excluded_keywords: [] } }]);
    expect(check(["EMPEROR'S CHILDREN", "INFANTRY"])).toEqual([]);
    expect(check(["EMPEROR'S CHILDREN", "MOUNTED"])).toHaveLength(1);
  });
});
