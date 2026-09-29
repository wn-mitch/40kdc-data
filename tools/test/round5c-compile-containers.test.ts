import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters, REVIEWED_FAMILY_REGISTRY } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";
import { prefillFromSource, type PrefillFamily } from "../src/round5c/leaf-prefill.js";
import { previewLeaf } from "../src/round5c/leaf-preview.js";

/**
 * Batch 5 (containers): the wrapping leaves (aura-range, leader-target, for-each-unit-select,
 * rules-bundle-marker) and the leading containers (choice-open, stance-select-open,
 * issue-orders-open, dice-pool-allocation-open, with named-option), plus the roll_var binding
 * on dice-roll@2. Split out per the leaf-family batching brief.
 */

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");

function authored(factionId: string, abilityId: string): Record<string, unknown> {
  const entries = JSON.parse(readFileSync(join(dataRoot, factionId, "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  const entry = entries.find((item) => item.ability_id === abilityId);
  if (!entry) throw new Error(`Missing ${factionId}/${abilityId}`);
  return entry;
}

let offset = 0;
function leaf(role: string, familyId: string, parameters: Record<string, unknown>, familyVersion = 1, fragment?: string): CompileLeaf {
  offset += 10;
  return { role, family_id: familyId, family_version: familyVersion, parameters, start_byte: offset, ...(fragment !== undefined ? { fragment } : {}) };
}

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

/** The compiled entry on a real authored base must validate against the ability schema, lint, and render. */
function rendered(base: Record<string, unknown>, leaves: CompileLeaf[]): string {
  const entry = entryWithMechanics(base, compiled(leaves).mechanics);
  const check = checkEntry(entry);
  expect(check.errors).toEqual([]);
  return check.rendered_text!;
}

describe("Round 5C container-wrap compiler", () => {
  const base = () => authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");

  it("wraps a plain effect in an aura, side and keywords folded in only when authored", () => {
    expect(compiled([
      leaf("CONDITION", "aura-range", { side: "enemy", inches: 6 }),
      leaf("EFFECT", "characteristic-modifier", { subject: "attack", characteristics: ["S"], operation: "add", value: 1, weapon_type: "all" }, 3),
    ]).mechanics.effect).toEqual({
      type: "aura", target: "enemy-within-aura",
      modifier: { range: 6, effect: { type: "stat-modifier", target: "this-unit", modifier: { stat: "S", operation: "add", value: 1 } } },
    });
    expect(compiled([
      leaf("CONDITION", "aura-range", { side: "friendly", inches: 3, keywords: ["CHARACTER"] }),
      leaf("EFFECT", "regain-wounds", { subject: "this-unit", amount: "1" }, 3),
    ]).mechanics.effect).toEqual({
      type: "aura", target: "friendly-within-aura",
      modifier: { range: 3, eligible: { required_keywords: ["CHARACTER"] }, effect: { type: "heal", target: "this-unit", modifier: { amount: 1 } } },
    });
    expect(rendered(base(), [
      leaf("CONDITION", "aura-range", { side: "enemy", inches: 6 }),
      leaf("EFFECT", "regain-wounds", { subject: "this-unit", amount: "1" }, 3),
    ]).length).toBeGreaterThan(0);
  });

  it("reads the ability's behavior as aura when an aura-range leaf is present", () => {
    expect(compiled([
      leaf("CONDITION", "aura-range", { side: "enemy", inches: 6 }),
      leaf("EFFECT", "regain-wounds", { subject: "this-unit", amount: "1" }, 3),
    ]).mechanics.behavior).toBe("aura");
  });

  it("wraps a plain effect onto the attached leader model", () => {
    expect(compiled([
      leaf("CONDITION", "leader-target", {}),
      leaf("EFFECT", "fights-first", { subject: "this-model" }),
    ]).mechanics.effect).toEqual({
      type: "leader-model-ability-grant", source: "bearer-unit", beneficiary: "leading-leader-model",
      attached_unit_filter: null, duration: "while-leading",
      grant: { recipient: "beneficiary", effect: { type: "ability-grant", modifier: { ability: "fights-first" } } },
      recipient_binding: "beneficiary-only",
    });
    expect(compiled([
      leaf("CONDITION", "leader-target", { leader_keywords: ["INFANTRY"] }),
      leaf("EFFECT", "fights-first", { subject: "this-model" }),
    ]).mechanics.effect).toMatchObject({ leader_filter: { keywords: ["INFANTRY"] } });
    expect(rendered(base(), [
      leaf("CONDITION", "leader-target", {}),
      leaf("EFFECT", "fights-first", { subject: "this-model" }),
    ]).length).toBeGreaterThan(0);
  });

  it("wraps the whole body in a rules-bundle when the marker is present", () => {
    expect(compiled([
      leaf("RESTRICTION", "rules-bundle-marker", {}),
      leaf("EFFECT", "fights-first", { subject: "this-model" }),
    ]).mechanics.effect).toEqual({ type: "rules-bundle", steps: [{ type: "ability-grant", target: "this-model", modifier: { ability: "fights-first" } }] });
    expect(compiled([
      leaf("RESTRICTION", "rules-bundle-marker", {}),
      leaf("EFFECT", "fights-first", { subject: "this-model" }),
      leaf("EFFECT", "invulnerable-save", { subject: "this-model", threshold: 4 }),
    ]).mechanics.effect).toEqual({
      type: "rules-bundle",
      steps: [
        { type: "ability-grant", target: "this-model", modifier: { ability: "fights-first" } },
        { type: "invulnerable-save", target: "this-model", modifier: { invuln_sv: 4 } },
      ],
    });
    expect(rendered(base(), [
      leaf("RESTRICTION", "rules-bundle-marker", {}),
      leaf("EFFECT", "fights-first", { subject: "this-model" }),
    ]).length).toBeGreaterThan(0);
  });

  it("loops an effect for each matching unit instead of selecting one", () => {
    expect(compiled([
      leaf("EVENT", "for-each-unit-select", { scope: "enemy", distance: "any" }),
      leaf("EFFECT", "mortal-wounds", { recipient: "this-unit", count: "1" }),
    ]).mechanics.effect).toEqual({
      type: "for-each-unit", selector: { owner: "enemy" },
      effect: { type: "mortal-wounds", target: "this-unit", modifier: { count: 1 } },
    });
    expect(compiled([
      leaf("EVENT", "for-each-unit-select", { scope: "friendly", distance: "within", inches: 6 }),
      leaf("EFFECT", "mortal-wounds", { recipient: "this-unit", count: "1" }),
    ]).mechanics.effect).toMatchObject({ selector: { owner: "friendly", within_inches: 6 } });
    expect(rendered(base(), [
      leaf("EVENT", "for-each-unit-select", { scope: "enemy", distance: "any" }),
      leaf("EFFECT", "mortal-wounds", { recipient: "this-unit", count: "1" }),
    ]).length).toBeGreaterThan(0);
  });

  it("refuses a for-each-unit-select alongside a select-unit", () => {
    const result = compileLeaves([
      leaf("EVENT", "for-each-unit-select", { scope: "enemy", distance: "any" }),
      leaf("EVENT", "select-unit", { scope: "enemy", distance: "any", visible: false }),
      leaf("EFFECT", "mortal-wounds", { recipient: "that-unit", count: "1" }),
    ]);
    expect(result.ok).toBe(false);
  });
});

describe("Round 5C leading-container compiler", () => {
  const base = () => authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");

  it("compiles choice-open into a choice of the option effects, one per sentence", () => {
    expect(compiled([
      leaf("EFFECT", "choice-open", {}, 1, "A"),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
      leaf("EFFECT", "invulnerable-save", { subject: "this-model", threshold: 4 }, 1, "C"),
    ]).mechanics.effect).toEqual({
      type: "choice",
      options: [
        { type: "ability-grant", target: "this-model", modifier: { ability: "fights-first" } },
        { type: "invulnerable-save", target: "this-model", modifier: { invuln_sv: 4 } },
      ],
    });
    expect(compiled([
      leaf("EFFECT", "choice-open", { choice_label: "Doctrine", min_choices: 1, max_choices: 2 }, 1, "A"),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
      leaf("EFFECT", "invulnerable-save", { subject: "this-model", threshold: 4 }, 1, "C"),
    ]).mechanics.effect).toMatchObject({ choice_label: "Doctrine", min_choices: 1, max_choices: 2 });
    expect(rendered(base(), [
      leaf("EFFECT", "choice-open", {}, 1, "A"),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
      leaf("EFFECT", "invulnerable-save", { subject: "this-model", threshold: 4 }, 1, "C"),
    ]).length).toBeGreaterThan(0);
  });

  it("refuses a choice-open with fewer than two options", () => {
    const result = compileLeaves([leaf("EFFECT", "choice-open", {}, 1, "A"), leaf("EFFECT", "fights-first", { subject: "this-model" }, 1, "A")]);
    expect(result.ok).toBe(false);
  });

  it("compiles stance-select-open into named options, each opened by a named-option leaf", () => {
    expect(compiled([
      leaf("EFFECT", "stance-select-open", { scope: "army", mode: "re-selectable" }, 1, "A"),
      leaf("EVENT", "named-option", { label: "Conqueror Doctrine" }, 1, "B"),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
      leaf("EVENT", "named-option", { label: "Ballistic Doctrine" }, 1, "C"),
      leaf("EFFECT", "invulnerable-save", { subject: "this-model", threshold: 4 }, 1, "C"),
    ]).mechanics.effect).toEqual({
      type: "stance-select", mode: "re-selectable", scope: "army",
      options: [
        { name: "Conqueror Doctrine", effect: { type: "ability-grant", target: "this-model", modifier: { ability: "fights-first" } } },
        { name: "Ballistic Doctrine", effect: { type: "invulnerable-save", target: "this-model", modifier: { invuln_sv: 4 } } },
      ],
    });
    expect(rendered(base(), [
      leaf("EFFECT", "stance-select-open", { scope: "army", mode: "consumable" }, 1, "A"),
      leaf("EVENT", "named-option", { label: "Conqueror Doctrine" }, 1, "B"),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
      leaf("EVENT", "named-option", { label: "Ballistic Doctrine" }, 1, "C"),
      leaf("EFFECT", "invulnerable-save", { subject: "this-model", threshold: 4 }, 1, "C"),
    ]).length).toBeGreaterThan(0);
  });

  it("refuses a stance-select-open option with no leading named-option leaf", () => {
    const result = compileLeaves([
      leaf("EFFECT", "stance-select-open", { scope: "unit", mode: "consumable" }, 1, "A"),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
      leaf("EVENT", "named-option", { label: "Ballistic Doctrine" }, 1, "C"),
      leaf("EFFECT", "invulnerable-save", { subject: "this-model", threshold: 4 }, 1, "C"),
    ]);
    expect(result.ok).toBe(false);
  });

  it("compiles issue-orders-open into named Orders", () => {
    expect(compiled([
      leaf("EFFECT", "issue-orders-open", { count: 1, range: 6, eligible_keyword: "INFANTRY" }, 1, "A"),
      leaf("EVENT", "named-option", { label: "First Rank, Fire!" }, 1, "B"),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
      leaf("EVENT", "named-option", { label: "Take Aim!" }, 1, "C"),
      leaf("EFFECT", "invulnerable-save", { subject: "this-model", threshold: 4 }, 1, "C"),
    ]).mechanics.effect).toEqual({
      type: "issue-orders", count: 1, range: 6, eligible: { keyword: "INFANTRY" },
      options: [
        { name: "First Rank, Fire!", effect: { type: "ability-grant", target: "this-model", modifier: { ability: "fights-first" } } },
        { name: "Take Aim!", effect: { type: "invulnerable-save", target: "this-model", modifier: { invuln_sv: 4 } } },
      ],
    });
    expect(rendered(base(), [
      leaf("EFFECT", "issue-orders-open", {}, 1, "A"),
      leaf("EVENT", "named-option", { label: "First Rank, Fire!" }, 1, "B"),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
      leaf("EVENT", "named-option", { label: "Take Aim!" }, 1, "C"),
      leaf("EFFECT", "invulnerable-save", { subject: "this-model", threshold: 4 }, 1, "C"),
    ]).length).toBeGreaterThan(0);
  });

  it("compiles dice-pool-allocation-open into options gated by a dice requirement", () => {
    expect(compiled([
      leaf("EFFECT", "dice-pool-allocation-open", { pool_count: 6, pool_die: "D6", max_activations: 1 }, 1, "A"),
      leaf("EVENT", "named-option", { label: "Path of Slaughter", requirement_type: "pair", requirement_min_value: 3 }, 1, "B"),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
      leaf("EVENT", "named-option", { label: "Path of Rage", requirement_type: "triple", requirement_min_value: 4 }, 1, "C"),
      leaf("EFFECT", "invulnerable-save", { subject: "this-model", threshold: 4 }, 1, "C"),
    ]).mechanics.effect).toEqual({
      type: "dice-pool-allocation", pool: { count: 6, die: "D6" }, max_activations: 1,
      options: [
        { name: "Path of Slaughter", requirement: { type: "pair", min_value: 3 }, effect: { type: "ability-grant", target: "this-model", modifier: { ability: "fights-first" } } },
        { name: "Path of Rage", requirement: { type: "triple", min_value: 4 }, effect: { type: "invulnerable-save", target: "this-model", modifier: { invuln_sv: 4 } } },
      ],
    });
    expect(rendered(base(), [
      leaf("EFFECT", "dice-pool-allocation-open", { pool_count: 6, pool_die: "D6", max_activations: 1 }, 1, "A"),
      leaf("EVENT", "named-option", { label: "Path of Slaughter", requirement_type: "pair", requirement_min_value: 3 }, 1, "B"),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
      leaf("EVENT", "named-option", { label: "Path of Rage", requirement_type: "triple", requirement_min_value: 4 }, 1, "C"),
      leaf("EFFECT", "invulnerable-save", { subject: "this-model", threshold: 4 }, 1, "C"),
    ]).length).toBeGreaterThan(0);
  });

  it("refuses a dice-pool-allocation option whose named-option leaf carries no requirement", () => {
    const result = compileLeaves([
      leaf("EFFECT", "dice-pool-allocation-open", { pool_count: 6, pool_die: "D6", max_activations: 1 }, 1, "A"),
      leaf("EVENT", "named-option", { label: "Path of Slaughter" }, 1, "B"),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
      leaf("EVENT", "named-option", { label: "Path of Rage", requirement_type: "triple", requirement_min_value: 4 }, 1, "C"),
      leaf("EFFECT", "invulnerable-save", { subject: "this-model", threshold: 4 }, 1, "C"),
    ]);
    expect(result.ok).toBe(false);
  });

  it("composes with an earlier select-unit, wrapping the choice in select-units (Master of Deceit's shape)", () => {
    expect(compiled([
      leaf("EVENT", "select-unit", { scope: "friendly", distance: "any", visible: false }, 1, "A"),
      leaf("EFFECT", "choice-open", {}, 1, "A"),
      leaf("EFFECT", "set-up", { subject: "selected-unit", to: "battlefield", from: "battlefield" }, 1, "B"),
      leaf("EFFECT", "set-up", { subject: "selected-unit", to: "strategic-reserves", from: "battlefield" }, 1, "C"),
    ]).mechanics.effect).toEqual({
      type: "select-units",
      selector: { owner: "friendly", count: 1 },
      effect: {
        type: "choice",
        options: [
          { type: "set-up", target: "selected-unit", modifier: { to: "battlefield", from: "battlefield" } },
          { type: "set-up", target: "selected-unit", modifier: { to: "strategic-reserves", from: "battlefield" } },
        ],
      },
    });
  });

  it("composes with an earlier roll, the result band gating the whole choice (Channelled Force's shape)", () => {
    expect(compiled([
      leaf("EVENT", "dice-roll", { dice: "D6" }, 2, "A"),
      leaf("CONDITION", "roll-result", { from: 4, to: 6 }, 1, "A"),
      leaf("EFFECT", "choice-open", {}, 1, "A"),
      leaf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
      leaf("EFFECT", "invulnerable-save", { subject: "this-model", threshold: 4 }, 1, "C"),
    ]).mechanics.effect).toEqual({
      type: "dice-gated", dice: "D6", threshold: 4, comparison: "gte", on_fail: null,
      on_success: {
        type: "choice",
        options: [
          { type: "ability-grant", target: "this-model", modifier: { ability: "fights-first" } },
          { type: "invulnerable-save", target: "this-model", modifier: { invuln_sv: 4 } },
        ],
      },
    });
  });
});

describe("Round 5C dice-roll@2 roll_var binding", () => {
  const base = () => authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");

  it("binds a single result band's dice-gated to the roll instead of rolling fresh dice", () => {
    expect(compiled([
      leaf("EVENT", "dice-roll", { dice: "D6", roll_var: "blast_roll" }, 2),
      leaf("CONDITION", "roll-result", { from: 4, to: 6 }),
      leaf("EFFECT", "mortal-wounds", { recipient: "this-unit", count: "1" }),
    ]).mechanics.effect).toEqual({
      type: "roll", dice: "D6", roll_var: "blast_roll",
      effect: {
        type: "dice-gated", from: { roll_var: "blast_roll" }, threshold: 4, comparison: "gte",
        on_success: { type: "mortal-wounds", target: "this-unit", modifier: { count: 1 } }, on_fail: null,
      },
    });
    expect(rendered(base(), [
      leaf("EVENT", "dice-roll", { dice: "D6", roll_var: "blast_roll" }, 2),
      leaf("CONDITION", "roll-result", { from: 4, to: 6 }),
      leaf("EFFECT", "mortal-wounds", { recipient: "this-unit", count: "1" }),
    ]).length).toBeGreaterThan(0);
  });

  it("still compiles a plain roll with no roll_var to a bare dice-gated, as dice-roll@1 always did", () => {
    expect(compiled([
      leaf("EVENT", "dice-roll", { dice: "D6" }, 2),
      leaf("CONDITION", "roll-result", { from: 4, to: 6 }),
      leaf("EFFECT", "mortal-wounds", { recipient: "this-unit", count: "1" }),
    ]).mechanics.effect).toEqual({
      type: "dice-gated", dice: "D6", threshold: 4, comparison: "gte",
      on_success: { type: "mortal-wounds", target: "this-unit", modifier: { count: 1 } }, on_fail: null,
    });
  });

  it("accepts a dice expression outside the sampled enum unchanged", () => {
    expect(() => normalizeFingerprintParameters("dice-roll", { dice: "D6", roll_var: "x" }, 2)).not.toThrow();
    expect(() => normalizeFingerprintParameters("dice-roll", { dice: "D6", roll_var: "" }, 2)).toThrow(/roll_var/u);
  });
});

describe("Round 5C stance-selection-capacity", () => {
  it("compiles the pooled and fixed-option allocation shapes", () => {
    expect(compiled([leaf("EFFECT", "stance-selection-capacity", { stance_id: "gladius-combat-doctrines", additional_selections: 1, allocation: "choose-one-option" })]).mechanics.effect)
      .toEqual({ type: "stance-selection-capacity", modifier: { stance_id: "gladius-combat-doctrines", additional_selections: 1, allocation: "choose-one-option" } });
    expect(() => normalizeFingerprintParameters("stance-selection-capacity", { stance_id: "gladius-combat-doctrines", additional_selections: 1, allocation: "fixed-option" }))
      .toThrow(/option_id is required/u);
    expect(() => normalizeFingerprintParameters("stance-selection-capacity", { stance_id: "gladius-combat-doctrines", additional_selections: 1, allocation: "fixed-option", option_id: "conqueror-doctrine" }))
      .not.toThrow();
  });
});

describe("Round 5C container-family previews and prefill", () => {
  const family = (id: string) => REVIEWED_FAMILY_REGISTRY.find((item) => item.id === id && item.version === currentFamilyVersion(id)) as unknown as PrefillFamily;
  const prefill = (id: string, text: string) => prefillFromSource(family(id), text);

  it("renders each wrapping leaf as implicit text, since it belongs to the effects it wraps", () => {
    expect(previewLeaf({ family_id: "aura-range", parameters: { side: "enemy", inches: 6 } }).text).toMatch(/No separate text/u);
    expect(previewLeaf({ family_id: "leader-target", parameters: {} }).text).toMatch(/No separate text/u);
    expect(previewLeaf({ family_id: "for-each-unit-select", parameters: { scope: "enemy", distance: "any" } }).text).toMatch(/No separate text/u);
    expect(previewLeaf({ family_id: "rules-bundle-marker", parameters: {} }).text).toMatch(/rules bundle/u);
    expect(previewLeaf({ family_id: "choice-open", parameters: {} }).text).toMatch(/No separate text/u);
    expect(previewLeaf({ family_id: "named-option", parameters: { label: "Take Aim!" } }).text).toMatch(/No separate text/u);
  });

  it("reads aura-range's side and inches outright from prose", () => {
    expect(prefill("aura-range", "enemy units within 6\" of this model suffer mortal wounds")).toEqual({ side: "enemy", inches: 6 });
    expect(prefill("aura-range", "friendly PSYKER units within this model's aura")).toEqual({ side: "friendly" });
  });

  it("reads for-each-unit-select's scope and distance outright from prose", () => {
    expect(prefill("for-each-unit-select", "for each enemy unit within 9\" of this model")).toEqual({ scope: "enemy", distance: "within", inches: 9 });
    expect(prefill("for-each-unit-select", "for each friendly unit")).toEqual({ scope: "friendly", distance: "any" });
  });

  it("reads issue-orders-open's count and range outright from prose", () => {
    expect(prefill("issue-orders-open", "this model can issue one order to a unit within 6\"")).toEqual({ count: 1, range: 6 });
  });

  it("reads dice-pool-allocation-open's pool outright from prose", () => {
    expect(prefill("dice-pool-allocation-open", "roll 6D6 to form your dice pool")).toEqual({ pool_count: 6, pool_die: "D6" });
  });

  it("reads named-option's label from a leading capitalised phrase ended by a colon or dash", () => {
    expect(prefill("named-option", "Conqueror Doctrine: melee weapons gain Sustained Hits 1")).toEqual({ label: "Conqueror Doctrine" });
    expect(prefill("named-option", "this unit re-rolls Hit rolls of 1")).toEqual({});
  });

  it("makes no prefill claim about container parameters it cannot read from prose (falls back to the empty starter)", () => {
    expect(prefill("leader-target", "while this model is leading a unit, the attached Character has Fights First")).toEqual({});
    expect(prefill("rules-bundle-marker", "this bundle of rules is granted by Sacred Rites")).toEqual({});
  });
});
