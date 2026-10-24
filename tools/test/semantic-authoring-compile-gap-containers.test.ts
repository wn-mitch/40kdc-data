import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";
import { selectObjectiveInline } from "../src/translate/effect-bind.js";

/**
 * Batch 7b, containers half: risk-reward, resource-action-menu, persistent-designation,
 * select-objective — each an opener composed like choice-open (see compile-containers.ts).
 * resource-action-menu's actions read their trigger from ordinary `event` leaves (version 9's
 * general owner/move_types/to/action_kind filters) and their eligibility from ordinary
 * unit-keyword/select-unit leaves in the action's own group — not a closed vocabulary of its own.
 */

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");

function authored(factionId: string, abilityId: string): Record<string, unknown> {
  const entries = JSON.parse(readFileSync(join(dataRoot, factionId, "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  const entry = entries.find((item) => item.ability_id === abilityId);
  if (!entry) throw new Error(`Missing ${factionId}/${abilityId}`);
  return entry;
}

let offset = 0;
function leaf(role: string, familyId: string, parameters: Record<string, unknown>, fragment?: string, version = 1): CompileLeaf {
  offset += 10;
  return { role, family_id: familyId, family_version: version, parameters, start_byte: offset, ...(fragment !== undefined ? { fragment } : {}) };
}

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

function rendered(base: Record<string, unknown>, leaves: CompileLeaf[]): string {
  const entry = entryWithMechanics(base, compiled(leaves).mechanics);
  const check = checkEntry(entry);
  expect(check.errors).toEqual([]);
  return check.rendered_text!;
}

describe("Semantic authoring risk-reward compiler", () => {
  const base = () => authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");

  it("reproduces dark-pacts-chaos-space-marines exactly: a leadership risk gating a choice reward", () => {
    const result = compiled([
      leaf("EFFECT", "risk-reward-open", { test: "leadership" }, "A"),
      leaf("EVENT", "on-fail-open", {}, "B"),
      leaf("EFFECT", "mortal-wounds", { recipient: "this-model", count: "D3" }, "B"),
      leaf("EFFECT", "weapon-ability-grant", { subject: "this-unit", keyword: "Lethal Hits" }, "C"),
      leaf("EFFECT", "weapon-ability-grant", { subject: "this-unit", keyword: "Sustained Hits 1" }, "D"),
    ]);
    // Keep the canonical expectation independent of the authored public-data migration.
    expect(result.mechanics.effect).toEqual({
      type: "risk-reward",
      risk: { test: "leadership", on_fail: { type: "mortal-wounds", target: "this-model", modifier: { count: "D3" } } },
      reward: {
        type: "choice",
        options: [
          { type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "lethal-hits" }] } },
          {
            type: "weapon-ability-grant", target: "this-unit",
            modifier: { keywords: [{ keyword_id: "sustained-hits", parameters: { value: 1 } }] },
          },
        ],
      },
    });
    expect(rendered(base(), [
      leaf("EFFECT", "risk-reward-open", { test: "leadership" }, "A"),
      leaf("EVENT", "on-fail-open", {}, "B"),
      leaf("EFFECT", "mortal-wounds", { recipient: "this-model", count: "D3" }, "B"),
      leaf("EFFECT", "weapon-ability-grant", { subject: "this-unit", keyword: "Lethal Hits" }, "C"),
      leaf("EFFECT", "weapon-ability-grant", { subject: "this-unit", keyword: "Sustained Hits 1" }, "D"),
    ]).length).toBeGreaterThan(0);
  });

  it("compiles a single-effect reward (no choice) when only one sentence follows on-fail-open", () => {
    expect(compiled([
      leaf("EFFECT", "risk-reward-open", { test: "hazard" }, "A"),
      leaf("EVENT", "on-fail-open", {}, "B"),
      leaf("EFFECT", "mortal-wounds", { recipient: "this-model", count: "1" }, "B"),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, "C"),
    ]).mechanics.effect).toEqual({
      type: "risk-reward",
      reward: { type: "ability-grant", target: "this-model", modifier: { ability: "fights-first" } },
      risk: { test: "hazard", on_fail: { type: "mortal-wounds", target: "this-model", modifier: { count: 1 } } },
    });
  });

  it("refuses a risk-reward-open whose first sentence has no leading on-fail-open leaf", () => {
    const result = compileLeaves([
      leaf("EFFECT", "risk-reward-open", { test: "leadership" }, "A"),
      leaf("EFFECT", "mortal-wounds", { recipient: "this-model", count: "1" }, "B"),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, "C"),
    ]);
    expect(result.ok).toBe(false);
  });
});

describe("Semantic authoring resource-action-menu compiler", () => {
  const base = () => authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");

  it("compiles a menu with one action, its own trigger, cost and effect", () => {
    expect(compiled([
      leaf("EFFECT", "resource-action-menu-open", { menu_id: "agile-manoeuvres", pool_id: "battle-focus-pool" }, "A"),
      leaf("EVENT", "menu-action", { action_id: "swift-as-the-wind", label: "Swift as the Wind", cost_amount: 1, duration: "until-end-of-phase" }, "B"),
      leaf("EVENT", "event", { kind: "phase-start", phase: "movement", turn: "your" }, "B"),
      leaf("EFFECT", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: 2, weapon_type: "all" }, "B", 3),
    ]).mechanics.effect).toEqual({
      type: "resource-action-menu", menu_id: "agile-manoeuvres", pool_id: "battle-focus-pool",
      actions: [{
        id: "swift-as-the-wind", label: "Swift as the Wind",
        when: { event: "phase-started", condition: { operator: "and", operands: [{ type: "phase-is", parameters: { phase: "movement" } }, { type: "player-turn-is", parameters: { turn: "your-turn" } }] } },
        cost: { pool_id: "battle-focus-pool", amount: 1 },
        effect: { type: "stat-modifier", target: "this-unit", modifier: { stat: "M", operation: "add", value: 2 } },
        duration: "phase",
      }],
    });
    expect(rendered(base(), [
      leaf("EFFECT", "resource-action-menu-open", { menu_id: "agile-manoeuvres", pool_id: "battle-focus-pool" }, "A"),
      leaf("EVENT", "menu-action", { action_id: "swift-as-the-wind", label: "Swift as the Wind", cost_amount: 1 }, "B"),
      leaf("EVENT", "event", { kind: "phase-start", phase: "movement", turn: "your" }, "B"),
      leaf("EFFECT", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: 2, weapon_type: "all" }, "B", 3),
    ]).length).toBeGreaterThan(0);
  });

  it("compiles an action's eligibility from ordinary keyword and select-unit leaves into filter and count bounds", () => {
    expect(compiled([
      leaf("EFFECT", "resource-action-menu-open", { menu_id: "m", pool_id: "p" }, "A"),
      leaf("EVENT", "menu-action", { action_id: "vehicle-only", label: "Vehicle Only", cost_amount: 1 }, "B"),
      leaf("CONDITION", "unit-keyword", { keywords: ["VEHICLE"], negated: false, subject: "this-unit" }, "B"),
      leaf("EVENT", "event", { kind: "selected", owner: "friendly", to: "move" }, "B", 9),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, "B"),
      leaf("EVENT", "menu-action", { action_id: "not-titanic", label: "Not Titanic", cost_amount: 1 }, "C"),
      leaf("EVENT", "select-unit", { scope: "friendly", distance: "any", visible: false }, "C"),
      leaf("CONDITION", "unit-keyword", { keywords: ["TITANIC"], negated: true, subject: "this-unit" }, "C"),
      leaf("EVENT", "event", { kind: "move-ended", owner: "enemy", move_types: ["fall-back"] }, "C", 9),
      leaf("EFFECT", "invulnerable-save", { subject: "this-model", threshold: 4 }, "C"),
    ]).mechanics.effect).toMatchObject({
      actions: [
        { id: "vehicle-only", eligibility: { filter: { all_of: ["VEHICLE"] } } },
        { id: "not-titanic", eligibility: { filter: { none_of: ["TITANIC"] }, count: { min: 1, max: 1 } } },
      ],
    });
  });

  it("refuses a menu action with no leading trigger leaf", () => {
    const result = compileLeaves([
      leaf("EFFECT", "resource-action-menu-open", { menu_id: "m", pool_id: "p" }, "A"),
      leaf("EVENT", "menu-action", { action_id: "a", label: "A", cost_amount: 1 }, "B"),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, "B"),
    ]);
    expect(result.ok).toBe(false);
  });

  it("reproduces battle-focus-aeldari exactly, all six actions", () => {
    const cost = { cost_pool_id: "battle-focus-pool", cost_resource_label: "Battle Focus token" };
    const move = (owner: string, moveTypes: string[], fragment: string) => leaf("EVENT", "event", { kind: "move-ended", owner, move_types: moveTypes }, fragment, 9);
    const result = compiled([
      leaf("EFFECT", "resource-action-menu-open", {
        menu_id: "agile-manoeuvres", pool_id: "battle-focus-pool", unit_max_manoeuvres_per_phase: 1, default_manoeuvre_max_per_phase: 1,
        pool_gain: { trigger: "round-started", amount: "variable", label: "Battle Focus token" },
        pool_spend: { trigger: "round-ended", amount: "all", label: "Battle Focus token" },
      }, "A", 2),
      leaf("EVENT", "menu-action", { action_id: "swift-as-the-wind", label: "Swift as the Wind", cost_amount: 1, ...cost, repeatable_if_different_unit: true, duration: "until-end-of-phase" }, "B", 2),
      move("friendly", ["normal"], "B"), move("friendly", ["advance"], "B"), move("friendly", ["fall-back"], "B"),
      leaf("EFFECT", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: 2, weapon_type: "all" }, "B", 3),
      leaf("EVENT", "menu-action", { action_id: "flitting-shadows", label: "Flitting Shadows", cost_amount: 1, ...cost, duration: "until-end-of-turn" }, "C", 2),
      move("friendly", ["normal"], "C"), move("friendly", ["advance"], "C"), move("friendly", ["fall-back"], "C"),
      leaf("EVENT", "event", { kind: "set-up", owner: "friendly" }, "C", 9),
      leaf("EVENT", "event", { kind: "targets-selected", owner: "friendly", action_kind: "charge" }, "C", 9),
      leaf("EFFECT", "rule-state", { subject: "this-unit", direction: "suppressed", rule_kind: "core-rule", rule: "overwatch-against-bearer" }, "C"),
      leaf("EVENT", "menu-action", { action_id: "star-engines", label: "Star Engines", cost_amount: 1, ...cost, duration: "until-end-of-turn" }, "D", 2),
      leaf("CONDITION", "unit-keyword", { keywords: ["VEHICLE"], negated: false, subject: "this-unit" }, "D"),
      leaf("EVENT", "event", { kind: "selected", owner: "friendly", to: "move", move_types: ["advance"] }, "D", 9),
      leaf("EFFECT", "weapon-ability-grant", { subject: "this-unit", keyword: "Assault", weapon_type: "ranged" }, "D"),
      leaf("EVENT", "menu-action", { action_id: "sudden-strike", label: "Sudden Strike", cost_amount: 1, ...cost, duration: "until-end-of-phase" }, "E", 2),
      leaf("EVENT", "event", { kind: "selected", owner: "friendly", to: "fight" }, "E", 9),
      leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "pile-in", distance: 6 }, "E"),
      leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "consolidation", distance: 6 }, "E"),
      leaf("EVENT", "menu-action", { action_id: "opportunity-seized", label: "Opportunity Seized", cost_amount: 1, ...cost, duration: "immediate", binds_event_variable: "triggering-enemy", eligibility_engaged_with_bound_at_phase_start: true }, "F", 2),
      leaf("EVENT", "select-unit", { scope: "friendly", distance: "any", visible: false }, "F"),
      leaf("CONDITION", "unit-keyword", { keywords: ["TITANIC"], negated: true, subject: "this-unit" }, "F"),
      move("enemy", ["fall-back"], "F"),
      leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6+1" }, "F"),
      leaf("EVENT", "menu-action", { action_id: "fade-back", label: "Fade Back", cost_amount: 1, ...cost, duration: "immediate", binds_event_variable: "triggering-shooter", eligibility_after_bound_hit_roll: true }, "G", 2),
      leaf("EVENT", "select-unit", { scope: "friendly", distance: "any", visible: false }, "G"),
      leaf("CONDITION", "unit-keyword", { keywords: ["TITANIC"], negated: true, subject: "this-unit" }, "G"),
      leaf("EVENT", "event", { kind: "attacks-resolved", owner: "enemy", action_kind: "shoot" }, "G", 9),
      leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6+1" }, "G"),
    ]);
    const moveTriggers = ["normal", "advance", "fall-back"].map((moveType) => ({
      event: "move-ended",
      subject: { owner: "friendly" },
      filter: { move_types: [moveType] },
    }));
    const actionCost = { pool_id: "battle-focus-pool", amount: 1, resource_label: "Battle Focus token" };
    const reactiveMove = { type: "move", target: "this-unit", modifier: { move_type: "normal", distance: "D6+1" } };
    expect(result.mechanics.effect).toEqual({
      type: "sequence",
      steps: [
        {
          type: "ability-part",
          trigger: { event: "round-started" },
          effect: {
            type: "resource-gain", target: "this-model",
            modifier: { pool: "battle-focus-pool", amount: "variable", label: "Battle Focus token" },
          },
        },
        {
          type: "resource-action-menu",
          menu_id: "agile-manoeuvres",
          pool_id: "battle-focus-pool",
          shared_usage: { unit_max_manoeuvres_per_phase: 1, default_manoeuvre_max_per_phase: 1 },
          actions: [
            {
              id: "swift-as-the-wind", label: "Swift as the Wind", cost: actionCost,
              duration: "phase", usage: { repeatable_if_different_unit: true },
              when: moveTriggers,
              effect: { type: "stat-modifier", target: "this-unit", modifier: { stat: "M", operation: "add", value: 2 } },
            },
            {
              id: "flitting-shadows", label: "Flitting Shadows", cost: actionCost,
              duration: "turn",
              when: [
                ...moveTriggers,
                { event: "set-up", subject: { owner: "friendly" } },
                { event: "targets-selected", subject: { owner: "friendly" }, filter: { kind: "charge" } },
              ],
              effect: {
                type: "rule-state", target: "this-unit",
                modifier: { direction: "suppressed", rule_kind: "core-rule", rule: "overwatch-against-bearer" },
              },
            },
            {
              id: "star-engines", label: "Star Engines", cost: actionCost,
              duration: "turn", eligibility: { filter: { all_of: ["VEHICLE"] } },
              when: { event: "selected", subject: { owner: "friendly" }, filter: { to: "move", move_types: ["advance"] } },
              effect: {
                type: "weapon-ability-grant", target: "this-unit",
                modifier: { weapons: { type: "ranged" }, keywords: [{ keyword_id: "assault" }] },
              },
            },
            {
              id: "sudden-strike", label: "Sudden Strike", cost: actionCost,
              duration: "phase",
              when: { event: "selected", subject: { owner: "friendly" }, filter: { to: "fight" } },
              effect: {
                type: "sequence",
                steps: [
                  { type: "move", target: "this-unit", modifier: { move_type: "pile-in", distance: 6 } },
                  { type: "move", target: "this-unit", modifier: { move_type: "consolidation", distance: 6 } },
                ],
              },
            },
            {
              id: "opportunity-seized", label: "Opportunity Seized", cost: actionCost,
              duration: "resolution",
              when: {
                event: "move-ended", subject: { owner: "enemy" }, filter: { move_types: ["fall-back"] },
                binds_event_variable: "triggering-enemy",
              },
              eligibility: {
                filter: { none_of: ["TITANIC"] }, count: { min: 1, max: 1 },
                requires: [{
                  type: "unit-state",
                  parameters: { subject: "selected-unit", state: "engaged", at: "phase-start", with: { event_var: "triggering-enemy" } },
                }],
              },
              effect: reactiveMove,
            },
            {
              id: "fade-back", label: "Fade Back", cost: actionCost,
              duration: "resolution",
              when: {
                event: "attacks-resolved", subject: { owner: "enemy" }, filter: { kind: "shoot" },
                binds_event_variable: "triggering-shooter",
              },
              eligibility: {
                filter: { none_of: ["TITANIC"] }, count: { min: 1, max: 1 },
                requires: [
                  { type: "phase-is", parameters: { phase: "shooting" } },
                  { type: "player-turn-is", parameters: { turn: "opponent-turn" } },
                  {
                    type: "happened",
                    parameters: {
                      event: "after-roll", object: "selected-unit", window: "event",
                      filter: { by: { event_var: "triggering-shooter" }, result: "success", roll: "hit" },
                    },
                  },
                ],
              },
              effect: reactiveMove,
            },
          ],
        },
        {
          type: "ability-part",
          trigger: { event: "round-ended" },
          effect: {
            type: "resource-spend", target: "this-model",
            modifier: { pool: "battle-focus-pool", amount: "all", label: "Battle Focus token" },
          },
        },
      ],
    });
  });
});

describe("Semantic authoring persistent-designation compiler", () => {
  const base = () => authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");

  it("reproduces unbridled-ardour-the-angelic-host-blood-angels exactly", () => {
    // Frozen authored DSL: the detachment left the dump at MFM data version 963.
    const entry = {
      effect: {
        type: "persistent-designation", designation: "unbridled-ardour-slayer", duration: "battle",
        select: { kind: "unit", selector: { filter: { owner: "enemy" }, count: { min: 1, max: 1 }, bind_as: "unbridled-ardour-slayer-selection" } },
        selection_policy: "one-time",
        consumer: {
          beneficiary: "this-model", relation: "attacks-selected-unit",
          effect: { type: "sequence", steps: [
            { type: "re-roll", target: "this-model", modifier: { roll: "hit", result_scope: "any-result" } },
            { type: "re-roll", target: "this-model", modifier: { roll: "wound", result_scope: "any-result" } },
          ] },
        },
      },
    };
    const result = compiled([
      leaf("EFFECT", "persistent-designation-open", { designation: "unbridled-ardour-slayer", scope: "enemy-unit", timing: "on-unit-destroyed", beneficiary: "this-model" }, "A"),
      leaf("EFFECT", "reroll", { roll: "hit", subset: "any", weapon_type: "all" }, "B"),
      leaf("EFFECT", "reroll", { roll: "wound", subset: "any", weapon_type: "all" }, "B"),
    ]);
    expect(result.mechanics.effect).toEqual(entry.effect);
    expect(rendered(base(), [
      leaf("EFFECT", "persistent-designation-open", { designation: "unbridled-ardour-slayer", scope: "enemy-unit", timing: "on-unit-destroyed", beneficiary: "this-model" }, "A"),
      leaf("EFFECT", "reroll", { roll: "hit", subset: "any", weapon_type: "all" }, "B"),
      leaf("EFFECT", "reroll", { roll: "wound", subset: "any", weapon_type: "all" }, "B"),
    ]).length).toBeGreaterThan(0);
  });

  it("retains the establishing selection's zero allowance and keyword alternatives", () => {
    const result = compiled([
      leaf("EVENT", "select-unit", { distance: "any", visible: false, count: 1, up_to: true }, "A", 6),
      leaf("CONDITION", "unit-filter", { side: "enemy", any_keywords: ["ALPHA", "BETA"] }, "A", 16),
      leaf("EFFECT", "persistent-designation-open", { designation: "example-prey", scope: "enemy-unit", timing: "start-of-first-battle-round", beneficiary: "this-unit" }, "A"),
      leaf("EFFECT", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }, "B"),
    ]);
    expect(result.mechanics.effect).toMatchObject({ type: "ability-part", effect: {
      type: "persistent-designation",
      select: { kind: "unit", selector: { filter: { owner: "enemy", any_of: ["ALPHA", "BETA"] }, count: { min: 0, max: 1 }, bind_as: "example-prey-selection" } },
      consumer: { beneficiary: "this-unit" },
    } });
  });

  it("compiles the objective-marker scope with the matching within-selected-marker relation", () => {
    expect(compiled([
      leaf("EFFECT", "persistent-designation-open", { designation: "singular-purpose-marker", scope: "objective-marker", timing: "start-of-first-battle-round", beneficiary: "this-model" }, "A"),
      leaf("EFFECT", "feel-no-pain", { subject: "this-model", threshold: 5 }, "B"),
    ]).mechanics.effect).toMatchObject({ type: "ability-part", trigger: { event: "round-started" }, effect: { select: { kind: "objective", selector: { filter: {}, count: { min: 1, max: 1 }, bind_as: "singular-purpose-marker-selection" } }, selection_policy: "one-time", consumer: { relation: "within-selected-marker", beneficiary: "this-model" } } });
  });
});

describe("Semantic authoring select-objective compiler", () => {
  const base = () => authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");

  it("compiles a bound objective wrapping an effect", () => {
    expect(compiled([
      leaf("EFFECT", "select-objective-open", { bind_as: "target_objective", range_inches: 6 }, "A"),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, "B"),
    ]).mechanics.effect).toEqual({
      type: "select-objective",
      selector: { filter: { within: { range: { inches: 6 }, of: "this-model" } }, bind_as: "target_objective", count: { min: 1, max: 1 } },
      effect: { type: "ability-grant", target: "this-model", modifier: { ability: "fights-first" } },
    });
    expect(rendered(base(), [
      leaf("EFFECT", "select-objective-open", { bind_as: "target_objective" }, "A"),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, "B"),
    ]).length).toBeGreaterThan(0);
  });

  it("iterates every eligible objective without selection bounds", () => {
    const effect = compiled([
      leaf("EFFECT", "select-objective-open", { bind_as: "x", each: true }, "A"),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, "B"),
    ]).mechanics.effect as Record<string, any>;
    expect(effect.selector).not.toHaveProperty("count");

    const text = selectObjectiveInline(effect, () => "nested effect");
    expect(text).toMatch(/for each objective marker/iu);
    expect(text).not.toMatch(/at least one objective marker/iu);
  });
});
