import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { checkDslShapes } from "../src/integrity-shapes.js";
import { createValidator } from "../src/schema-loader.js";
import type { ValidationResult } from "../src/validate.js";

/**
 * Schema pins for the phase-4 shapes: each accepts its documented form and rejects the
 * misuse its if/then or oneOf exists to stop, plus the referential checks in
 * `integrity-shapes.ts` that JSON Schema cannot express.
 */
const ajv = createValidator();
const BASE = "https://40kdc.dev/schemas";
const effectOk = ajv.getSchema(`${BASE}/enrichment/ability-dsl/effect.schema.json`)!;
const conditionOk = ajv.getSchema(`${BASE}/enrichment/ability-dsl/condition.schema.json`)!;
const abilityOk = ajv.getSchema(`${BASE}/enrichment/ability-dsl/ability.schema.json`)!;
const stratagemOk = ajv.getSchema(`${BASE}/core/stratagem.schema.json`)!;

const leaf = (type: string, modifier: Record<string, unknown>, target: unknown = "this-unit", extra: Record<string, unknown> = {}) => ({ type, target, modifier, ...extra });
const ability = (effect: unknown, extra: Record<string, unknown> = {}) => ({
  ability_id: "shape-probe", name: "Shape probe", authored_by: "40kdc-community",
  game_version: { edition: "11th", dataslate: "pre-launch-provisional" }, effect, scope: { duration: "permanent" }, ...extra,
});
const BATTLE_SIZE = { incursion: 1, "strike-force": 2, onslaught: 3 };

describe("geometry and unit relations", () => {
  it("accepts wholly, embarked_in, member_of, engagement and ability relations on a unit filter", () => {
    const target = {
      owner: "friendly", within: { range: { inches: 6 }, wholly: true }, embarked_in: "this-unit", member_of: "this-unit",
      engaged_with: { owner: "enemy" }, not_engaged_with: { owner: "friendly", excluding: "this-unit" }, has_ability: ["deep-strike"], lacks_ability: ["lone-operative"],
    };
    expect(effectOk(leaf("feel-no-pain", { threshold: 6 }, target))).toBe(true);
  });

  it("requires a designation for designated_by", () => {
    expect(effectOk(leaf("feel-no-pain", { threshold: 6 }, { owner: "enemy", designated: "spotted", designated_by: "this-unit" }))).toBe(true);
    expect(effectOk(leaf("feel-no-pain", { threshold: 6 }, { owner: "enemy", designated_by: "this-unit" }))).toBe(false);
  });

  it("accepts the bearer's Transport and a named Stratagem target as unit-refs", () => {
    expect(effectOk(leaf("ability-grant", { ability: "scouts", value: 9 }, "bearer-transport"))).toBe(true);
    expect(effectOk(leaf("counts-as", { within: "aura", of: { stratagem_target: "abhorrent" } }, { stratagem_target: "war-dogs" }))).toBe(true);
  });

  it("accepts the ability's own unit as a unit-ref inside a selector's eligibility", () => {
    expect(effectOk({ type: "select-units", selector: { owner: "enemy", count: 1, eligibility: { type: "happened", parameters: { event: "after-roll", subject: "ability-unit", object: "this-unit", window: "phase" } } }, effect: { type: "no-effect" } })).toBe(true);
    expect(effectOk(leaf("feel-no-pain", { threshold: 6 }, "ability-units"))).toBe(false);
  });

  it("measures within to the centre of the battlefield", () => {
    expect(conditionOk({ type: "within", parameters: { subject: "this-model", of: "battlefield-centre", range: { inches: 6 } } })).toBe(true);
  });

  it("accepts near / away_from / in_region lists and placement lists; wholly selection needs a range", () => {
    expect(effectOk(leaf("set-up", {
      to: "battlefield", near: [{ of: { marker: "teleport-homer" }, range: { inches: 3 } }], away_from: [{ of: { owner: "enemy" }, range: { inches: 9 } }],
      in_region: { region: { territory: "your-deployment-zone" }, wholly: true }, placement: ["closest-to-original", "on-terrain"],
    }))).toBe(true);
    expect(effectOk(leaf("return-models", { count: 1, placement: ["closest-to-destruction", "unengaged"] }))).toBe(true);
    const sel = (selector: Record<string, unknown>) => ({ type: "select-units", selector: { owner: "friendly", count: 1, ...selector }, effect: { type: "no-effect" } });
    expect(effectOk(sel({ within_inches: 6, wholly: true }))).toBe(true);
    expect(effectOk(sel({ wholly: true }))).toBe(false);
  });
});

describe("movement", () => {
  it("accepts a disembark mode, engagement, counts_as_move and a typed pass-through", () => {
    expect(effectOk(leaf("move", {
      move_type: "disembark", mode: "assault", allow_engagement: true, counts_as_move: "normal",
      passthrough: [{ kind: "models", excluding: ["MONSTER", "VEHICLE"] }, { kind: "terrain", height: "up-to-4" }, "all-terrain"],
      ends_within: { range: "objective-control", of: { objective: {} } },
    }))).toBe(true);
    expect(effectOk(leaf("permission", { activity: "disembark", allow: true, after: ["advance"], counts_as_move: "normal" }))).toBe(true);
  });

  it("rejects an unknown pass-through token and model filters on terrain", () => {
    expect(effectOk(leaf("move-modifier", { passthrough: ["walls-and-stuff"] }))).toBe(false);
    expect(effectOk(leaf("move-modifier", { passthrough: [{ kind: "terrain", excluding: ["TITANIC"] }] }))).toBe(false);
    expect(effectOk(leaf("move-modifier", { passthrough: [{ kind: "models", height: "over-4" }] }))).toBe(false);
  });

  it("accepts mandatory and next-Movement-phase set-ups; allow_first_round needs arrives", () => {
    expect(effectOk(leaf("set-up", { to: "strategic-reserves", mandatory: true }))).toBe(true);
    expect(effectOk(leaf("set-up", { to: "battlefield", arrives: "next-movement-phase", allow_first_round: true }))).toBe(true);
    expect(effectOk(leaf("set-up", { to: "battlefield", allow_first_round: true }))).toBe(false);
  });

  it("adds a moved-over predicate that names the mover", () => {
    expect(conditionOk({ type: "moved-over", parameters: { by: "this-model", window: "event" } })).toBe(true);
    expect(conditionOk({ type: "moved-over", parameters: { window: "event" } })).toBe(false);
  });
});

describe("dice", () => {
  it("binds one roll for numeric consumers and dice gates", () => {
    const roll = {
      type: "roll", dice: "D3", roll_var: "blessing",
      effect: { type: "sequence", steps: [
        leaf("stat-modifier", { stat: "A", operation: "add", value: { roll_var: "blessing" } }),
        leaf("mortal-wounds", { count: { roll_var: "blessing", successes_on: 4 } }),
        { type: "dice-gated", from: { roll_var: "blessing" }, requirement: { type: "pair", min_value: 3 }, on_success: { type: "no-effect" } },
      ] },
    };
    expect(effectOk(roll)).toBe(true);
    expect(effectOk({ ...roll, roll_var: undefined })).toBe(false);
  });

  it("keeps a dice gate to one source and one test", () => {
    const gate = (g: Record<string, unknown>) => ({ type: "dice-gated", on_success: { type: "no-effect" }, ...g });
    expect(effectOk(gate({ dice: "2D6", kind: "psychic", threshold: 5 }))).toBe(true);
    expect(effectOk(gate({ dice: "D6", from: { roll_var: "x" }, threshold: 4 }))).toBe(false);
    expect(effectOk(gate({ dice: "D6", requirement: { type: "pair", min_value: 2 } }))).toBe(false);
    expect(effectOk(gate({ from: { roll_var: "x" }, threshold: 4, requirement: { type: "pair", min_value: 2 } }))).toBe(false);
    // The D6-only binding moved onto the roll step.
    expect(effectOk(gate({ dice: "D6", threshold: 4, roll_var: "x" }))).toBe(false);
  });

  it("accepts an ability's own dice, manoeuvre and Channel the Warp rolls", () => {
    expect(effectOk(leaf("roll-modifier", { roll: { of_ability: "reanimation-protocols" }, operation: "add", value: 1 }))).toBe(true);
    expect(effectOk(leaf("roll-modifier", { roll: "manoeuvre", operation: "add", value: 1 }))).toBe(true);
    expect(effectOk(leaf("re-roll", { roll: "channelling", result_scope: "any-result", count: 1, mandatory: true }))).toBe(true);
  });

  it("qualifies roll results: unmodified needs a numeric result; fails_on stops below 6", () => {
    expect(effectOk(leaf("roll-result", { roll: "hit", result: 6, unmodified: true }))).toBe(true);
    expect(effectOk(leaf("roll-result", { roll: "hit", result: "pass", unmodified: true }))).toBe(false);
    expect(effectOk(leaf("roll-result", { roll: "hit", fails_on: 3, incoming: true }))).toBe(true);
    expect(effectOk(leaf("roll-result", { roll: "hit", fails_on: 6 }))).toBe(false);
  });

  it("spends pooled dice by face or by requirement, not both", () => {
    expect(effectOk(leaf("resource-spend", { pool: "fate-dice-pool", amount: 1, face: 4 }))).toBe(true);
    expect(effectOk(leaf("resource-spend", { pool: "p", amount: 3, requirement: { type: "triple", min_value: 6 } }))).toBe(true);
    expect(effectOk(leaf("resource-spend", { pool: "p", amount: 3, face: 6, requirement: { type: "triple", min_value: 6 } }))).toBe(false);
  });
});

describe("battle size and counts", () => {
  it("accepts one value per battle size, a count and a bound roll wherever a quantity is", () => {
    expect(effectOk(leaf("resource-gain", { pool: "battle-focus-pool", amount: BATTLE_SIZE }))).toBe(true);
    expect(effectOk(leaf("resource-die", { pool: "fate-dice-pool", operation: "add", value: "rolled", count: BATTLE_SIZE }))).toBe(true);
    expect(effectOk(leaf("return-models", { count: { count_of: "models-in-bearer-unit", keyword: "SPYDER" } }))).toBe(true);
    expect(effectOk(leaf("army-rule", { rule: "composition", measure: "points", max: BATTLE_SIZE }))).toBe(true);
    expect(effectOk({ type: "select-units", selector: { owner: "enemy", max_count: BATTLE_SIZE }, effect: { type: "no-effect" } })).toBe(true);
  });

  it("rejects a battle-size value missing a size, and a wargear count without its wargear", () => {
    expect(effectOk(leaf("resource-gain", { pool: "p", amount: { incursion: 1, "strike-force": 2 } }))).toBe(false);
    expect(effectOk(leaf("re-roll", { roll: "wound", result_scope: "any-result", count: { count_of: "models-equipped-with" } }))).toBe(false);
    expect(effectOk(leaf("re-roll", { roll: "wound", result_scope: "any-result", count: { count_of: "models-in-bearer-unit", wargear: "caltrops" } }))).toBe(false);
  });

  it("scales any named field from the shared sources", () => {
    const scaled = (scaling: Record<string, unknown>) => leaf("test", { test: "battle-shock", modifier: -1 }, "selected-unit", { scaling });
    expect(effectOk(scaled({ per: 10, of: "models-in-bearer-unit", field: "modifier" }))).toBe(true);
    expect(effectOk(scaled({ per: 1, of: "models-equipped-with", wargear: "cluster-caltrops", field: "count" }))).toBe(true);
    expect(effectOk(scaled({ per: 1, of: "models-equipped-with" }))).toBe(false);
  });

  it("adds battle-size and army-faction conditions", () => {
    expect(conditionOk({ type: "battle-size", parameters: { size: "onslaught" } })).toBe(true);
    expect(conditionOk({ type: "army-faction", parameters: { faction: "necrons" } })).toBe(true);
  });
});

describe("abilities, usage and expiry", () => {
  it("limits cap_per and not_same to uses; select excludes a fixed option", () => {
    const mod = (m: Record<string, unknown>) => leaf("ability-modifier", { ability: "overkill", operation: "set", value: 2, ...m });
    expect(effectOk(mod({ aspect: "uses", cap_per: { count: 1, period: "battle-round" }, consumes_shared_use: false }))).toBe(true);
    expect(effectOk(mod({ aspect: "range", cap_per: { count: 1, period: "battle-round" } }))).toBe(false);
    expect(effectOk(mod({ aspect: "end-round" }))).toBe(true);
    expect(effectOk(leaf("ability-activate", { ability: "blessings-of-khorne", select: { by: "roll" }, ignore_consumed: true }))).toBe(true);
    expect(effectOk(leaf("ability-activate", { ability: "blessings-of-khorne", select: { by: "roll" }, option: "Total Carnage" }))).toBe(false);
  });

  it("accepts a usage list of two or more limits, not a list of one", () => {
    const limits = [{ frequency: "n-per-battle", count: 1, per: "model" }, { frequency: "once-per-battle-round", per: "army" }];
    expect(abilityOk(ability({ type: "no-effect" }, { usage: limits }))).toBe(true);
    expect(abilityOk(ability({ type: "no-effect" }, { usage: limits.slice(0, 1) }))).toBe(false);
  });

  it("shares one expiry vocabulary between scope and designate, keeping the retired designate spellings", () => {
    expect(abilityOk(ability({ type: "no-effect" }, { scope: { duration: "until-next-shooting-phase" } }))).toBe(true);
    const designate = (clears_on: string) => leaf("designate", { subject: "selected-unit", tag: "spotted", by: "this-unit", clears_on });
    expect(effectOk(designate("until-end-of-opponent-next-turn"))).toBe(true);
    expect(effectOk(designate("control-lost"))).toBe(true);
    expect(effectOk(designate("phase-end"))).toBe(true);
    expect(effectOk(designate("whenever"))).toBe(false);
  });

  it("retires the terrain-area-control condition", () => {
    expect(conditionOk({ type: "terrain-area-control", parameters: { footprint_ref: "ruins", min_models: 3 } })).toBe(false);
  });

  it("names several Stratagem targets only as a list of two or more named targets", () => {
    const strat = (target_restrictions: unknown) => ({
      id: "probe", name: "Probe", category: "detachment", cp_cost: 1, phases: ["command"], player_turn: "your-turn", timing: "once-per-phase",
      game_version: { edition: "11th", dataslate: "pre-launch-provisional" }, target_restrictions,
    });
    expect(stratagemOk(strat([{ name: "psyker", selects: "model" }, { name: "tzaangors", side: "your-army" }]))).toBe(true);
    expect(stratagemOk(strat([{ name: "psyker" }, { side: "your-army" }]))).toBe(false);
    expect(stratagemOk(strat({ side: "your-army" }))).toBe(true);
  });
});

describe("rules, army and the adopted D18 shapes", () => {
  it("accepts the new core-rule slugs", () => {
    for (const rule of ["engaged-shooting-hit-penalty", "charge-bonus", "hidden", "orders-end-on-battle-shock"]) {
      expect(effectOk(leaf("rule-state", { direction: "suppressed", rule_kind: "core-rule", rule }))).toBe(true);
    }
  });

  it("requires each army rule's own field and keeps composition fields on composition", () => {
    expect(effectOk(leaf("army-rule", { rule: "detachment-forbidden", detachment: "1st-company-task-force" }))).toBe(true);
    expect(effectOk(leaf("army-rule", { rule: "detachment-forbidden" }))).toBe(false);
    expect(effectOk(leaf("army-rule", { rule: "detachment-tag-exclusive" }))).toBe(false);
    expect(effectOk(leaf("army-rule", { rule: "attachment", attach_as: { all_of: ["BATTLE SISTERS SQUAD"] } }))).toBe(true);
    expect(effectOk(leaf("army-rule", { rule: "composition", attach_as: { all_of: ["X"] } }))).toBe(false);
    expect(effectOk(leaf("army-rule", { rule: "unique", per: { all_of: ["INQUISITOR"] } }))).toBe(false);
  });

  it("gates redirect and the Core-Stratagem exception", () => {
    const t = (m: Record<string, unknown>) => leaf("targeting", m, "attacker");
    expect(effectOk(t({ may: "redirect", target: { owner: "friendly" }, to: "this-unit", if_eligible: true }))).toBe(true);
    expect(effectOk(t({ may: "redirect", target: { owner: "friendly" } }))).toBe(false);
    expect(effectOk(t({ may: "must-target", target: "this-unit", to: "this-unit" }))).toBe(false);
    expect(effectOk(t({ may: "cannot-target", target: "this-model", kind: "stratagem", except: "core-stratagems" }))).toBe(true);
    expect(effectOk(t({ may: "target", target: "this-model", kind: "stratagem", except: "core-stratagems" }))).toBe(false);
  });

  it("accepts datasheet swap, characteristic majority (tie required), Firing Deck borrowing and weapon bindings", () => {
    expect(effectOk(leaf("datasheet-swap", { datasheet: "blue-horrors" }))).toBe(true);
    expect(effectOk(leaf("characteristic-resolution", { stat: "T", rule: "majority", tie: "highest", applies_to: "wound-roll", incoming: true }))).toBe(true);
    expect(effectOk(leaf("characteristic-resolution", { stat: "T", rule: "majority" }))).toBe(false);
    expect(effectOk(leaf("characteristic-resolution", { stat: "T", rule: "highest", tie: "lowest" }))).toBe(false);
    expect(effectOk(leaf("borrow-weapons", { from: { embarked_in: "this-unit" }, max_models: 2, weapon_type: "ranged", exclude_weapon_keyword: ["ONE SHOT"], until: "attack-sequence" }))).toBe(true);
    expect(effectOk(leaf("select-weapon", { count: 1, weapon_type: "melee", bind_as: "blade" }, "this-model"))).toBe(true);
    expect(effectOk(leaf("stat-modifier", { stat: "A", operation: "add", value: 1, weapon_ref: { weapon_var: "blade" } }))).toBe(true);
    expect(effectOk(leaf("roll-modifier", { roll: "hit", operation: "add", value: 1, weapon_ref: { selected_by: { ability: "firing-deck" } } }))).toBe(true);
    expect(effectOk(leaf("stat-modifier", { stat: "psyker-level", operation: "set", value: 2 }, "this-model"))).toBe(true);
  });

  it("binds objectives with select-objective; range and range_inches are exclusive", () => {
    const so = (selector: Record<string, unknown>) => ({ type: "select-objective", selector: { bind_as: "o", ...selector }, effect: leaf("designate", { subject: { objective: { selection_var: "o" } }, tag: "mutated" }) });
    expect(effectOk(so({ count: 1, range: "objective-control", origin: "bearer-unit", controlled_by: "your-army" }))).toBe(true);
    expect(effectOk(so({ count: "each", filter: { controlled_by: "friendly" } }))).toBe(true);
    expect(effectOk(so({ count: 1, range: "objective-control", range_inches: 6 }))).toBe(false);
  });

  it("caps an aura's range and adds the D14 designation predicates", () => {
    expect(effectOk({ type: "aura", target: "enemy-within-aura", modifier: { range: 3, range_cap: 12, effect: { type: "no-effect" } } })).toBe(true);
    expect(conditionOk({ type: "guided", parameters: {} })).toBe(true);
    expect(conditionOk({ type: "designated", parameters: { subject: "defender", tag: "spotted", by: { designated: "observer", all_of: ["MARKERLIGHT"] } } })).toBe(true);
  });
});

describe("integrity: phase-4 bindings", () => {
  const root = mkdtempSync(join(tmpdir(), "p4-shapes-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "enrichment/probe"), { recursive: true });
  mkdirSync(join(root, "core/probe"), { recursive: true });
  const run = async (effect: unknown, stratagems: unknown[] = []): Promise<string[]> => {
    writeFileSync(join(root, "enrichment/probe/abilities.json"), JSON.stringify([ability(effect)]));
    writeFileSync(join(root, "core/probe/stratagems.json"), JSON.stringify(stratagems));
    const result: ValidationResult = { totalFiles: 0, totalItems: 0, passed: 0, failed: 0, errors: [] };
    await checkDslShapes(root, result);
    return result.errors.flatMap((e) => e.errors.map((x) => x.message));
  };

  it("rejects an unregistered designation but folds legacy spellings and skips Detachment tags", async () => {
    expect(await run(leaf("designate", { subject: "selected-unit", tag: "made-up-mark" }))).toEqual([
      'designation "made-up-mark" is not in the registry (tools/src/translate/designations.ts)',
    ]);
    expect(await run(leaf("designate", { subject: "selected-unit", tag: "RILED UP" }))).toEqual([]);
    expect(await run(leaf("army-rule", { rule: "detachment-tag-exclusive", tag: "flyblown" }))).toEqual([]);
  });

  it("requires a bound roll inside the roll step that binds it", async () => {
    const mw = leaf("mortal-wounds", { count: { roll_var: "r" } });
    expect(await run(mw)).toEqual(['{roll_var: "r"} is not inside a roll step that binds it']);
    expect(await run({ type: "roll", dice: "D3", roll_var: "r", effect: mw })).toEqual([]);
    expect(await run({ type: "sequence", steps: [{ type: "roll", dice: "D3", roll_var: "r", effect: { type: "no-effect" } }, mw] })).toEqual([
      '{roll_var: "r"} is not inside a roll step that binds it',
    ]);
  });

  it("requires bound objectives, bound weapons and one binding per split unit", async () => {
    expect(await run(leaf("designate", { subject: { objective: { selection_var: "o" } }, tag: "mutated" }))).toEqual([
      'objective {selection_var: "o"} is not inside a select-objective that binds it',
    ]);
    expect(await run(leaf("stat-modifier", { stat: "A", operation: "add", value: 1, weapon_ref: { weapon_var: "blade" } }))).toEqual([
      'weapon_ref "blade" is bound by no select-weapon in this ability',
    ]);
    expect(await run(leaf("split-unit", { model_counts: [5, 5], bind_as: ["a", "b", "c"] }))).toEqual(["split-unit names 3 bindings for 2 resulting units"]);
  });

  it("requires a stratagem_target to be a named target of the ability's Stratagem", async () => {
    const effect = leaf("return-models", { count: "D3+1" }, { stratagem_target: "tzaangors" });
    const strat = (targets: unknown) => [{ id: "probe-strat", ability_id: "shape-probe", target_restrictions: targets }];
    expect(await run(effect, strat([{ name: "psyker" }, { name: "tzaangors" }]))).toEqual([]);
    expect(await run(effect, strat([{ name: "psyker" }, { name: "cultists" }]))).toEqual([
      'stratagem_target "tzaangors" is not a named target of this ability\'s Stratagem',
    ]);
    expect(await run(effect)).toEqual(['stratagem_target "tzaangors" is not a named target of any Stratagem using this ability']);
  });
});
