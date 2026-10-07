import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";

type Item = [string, string, Record<string, unknown>, string?];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, fragment = "RAW_TEXT"]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment };
  });
}

function compiled(text: string, ...items: Item[]) {
  return compileLeaves(placed(text, ...items), text);
}

function mechanicsOf(text: string, ...items: Item[]): Record<string, any> {
  const result = compiled(text, ...items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(text: string, ...items: Item[]): string {
  const result = compiled(text, ...items);
  if (result.ok) throw new Error(`compiled: ${JSON.stringify(result.mechanics)}`);
  return result.errors.join("; ");
}

const HIDDEN = { direction: "suppressed", rule_kind: "core-rule", rule: "attacking-ends-hidden" };
const hidden = (wording: string, subject: string, fragment?: string): Item => [wording, "rule-state", { subject, ...HIDDEN }, fragment];
const THOSE = { of: "antecedent" };
const THOSE_RANGED = { attack_type: "ranged", of: "antecedent" };
const SHOT = { kind: "attacks-resolved", action_kind: "shoot" };
const SELECTED_TO_SHOOT = { kind: "selected", to: "shoot" };
const BOUND_MODIFIER = { ...HIDDEN, attacks: { event_var: "those-attacks" } };

describe("Round 5C hidden retention: the standing exclusion (sub-shape A)", () => {
  it("keeps all of this unit's ranged attacks from ending Hidden, always", () => {
    const text = "ALPHA unit only. This unit's ranged attacks do not prevent this unit from being hidden.";
    const mechanics = mechanicsOf(text,
      ["ALPHA unit only", "bearer-eligibility", { keywords: ["ALPHA"], match: "all", excluded_keywords: [] }],
      ["This unit's ranged attacks", "attack", { direction: "makes", unit: "this-unit", attack_type: "ranged" }],
      hidden("do not prevent this unit from being hidden", "this-unit"));
    expect(mechanics.behavior).toBe("passive");
    expect(mechanics.scope).toEqual({ duration: "permanent" });
    expect(mechanics.effect).toEqual({
      type: "conditional", condition: { type: "attack-is", parameters: { attack_type: "ranged" } },
      effect: { type: "rule-state", target: "this-unit", modifier: HIDDEN },
    });
  });
});

describe("Round 5C hidden retention: those attacks of a shooting moment (sub-shapes B and C)", () => {
  it("binds a Stratagem's \"has shot\" attacks to the suppression on its bound target", () => {
    const text = "Your Shooting phase, when a friendly ALPHA unit has shot.\nThat ALPHA unit.\nThose attacks do not prevent your unit from being hidden.";
    const mechanics = mechanicsOf(text,
      ["Your Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"],
      ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "WHEN"],
      ["has shot", "event", SHOT, "WHEN"],
      ["That ALPHA unit", "target-binding", { bound_to: "triggering-unit" }, "TARGET"],
      ["Those attacks", "attack-filter", THOSE, "EFFECT"],
      hidden("do not prevent your unit from being hidden", "this-unit", "EFFECT"));
    expect(mechanics.trigger).toEqual({
      event: "attacks-resolved", filter: { kind: "shoot" }, binds_event_variable: "those-attacks",
      subject: { owner: "friendly", all_of: ["ALPHA"] },
    });
    // No attack-is gate: the bound attacks are the moment's own, not a condition on the ability.
    expect(mechanics.effect).toEqual({ type: "rule-state", target: "this-unit", modifier: BOUND_MODIFIER });
  });

  it("binds the attacks a detachment rule's unit is selected to make, on the triggering unit", () => {
    const text = "In your Shooting phase, when a friendly BETA unit is selected to shoot, those ranged attacks do not prevent your unit from being hidden.";
    const mechanics = mechanicsOf(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["friendly BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }],
      ["is selected to shoot", "event", SELECTED_TO_SHOOT],
      ["those ranged attacks", "attack-filter", THOSE_RANGED],
      hidden("do not prevent your unit from being hidden", "event-subject"));
    expect(mechanics.trigger).toMatchObject({ event: "selected", filter: { to: "shoot" }, binds_event_variable: "those-attacks" });
    expect(JSON.stringify(mechanics.effect)).toContain(JSON.stringify({ type: "rule-state", target: "event-subject", modifier: BOUND_MODIFIER }));
    expect(JSON.stringify(mechanics)).not.toContain("attack-is");
  });

  it("binds \"that unit\" to the unit that shot", () => {
    const text = "When a friendly GAMMA unit has shot: those attacks do not prevent that unit from being hidden.";
    const mechanics = mechanicsOf(text,
      ["friendly GAMMA unit", "unit-filter", { side: "friendly", keywords: ["GAMMA"] }],
      ["has shot", "event", SHOT],
      ["those attacks", "attack-filter", THOSE],
      hidden("do not prevent that unit from being hidden", "antecedent"));
    expect(mechanics.trigger.binds_event_variable).toBe("those-attacks");
    expect(mechanics.effect).toEqual({ type: "rule-state", target: "event-subject", modifier: BOUND_MODIFIER });
  });

  it("takes this unit as the shooter when the moment is this unit's own", () => {
    const text = "When this unit is selected to shoot, those ranged attacks do not prevent this unit from being hidden.";
    const mechanics = mechanicsOf(text,
      ["When this unit is selected to shoot", "event", { kind: "selected-to-shoot" }],
      ["those ranged attacks", "attack-filter", THOSE_RANGED],
      hidden("do not prevent this unit from being hidden", "this-unit"));
    expect(mechanics.trigger).toEqual({ event: "selected", filter: { to: "shoot" }, binds_event_variable: "those-attacks" });
    expect(mechanics.effect).toEqual({ type: "rule-state", target: "this-unit", modifier: BOUND_MODIFIER });
  });

  it("numbers the bound attacks of two moments in one record", () => {
    const text = "When this unit is selected to shoot, those attacks do not prevent this unit from being hidden. When this unit has shot, those attacks do not prevent this unit from being hidden.";
    const mechanics = mechanicsOf(text,
      ["When this unit is selected to shoot", "event", { kind: "selected-to-shoot" }],
      ["those attacks", "attack-filter", THOSE],
      hidden("do not prevent this unit from being hidden", "this-unit"),
      ["When this unit has shot", "event", SHOT],
      ["those attacks", "attack-filter", THOSE],
      hidden("do not prevent this unit from being hidden", "this-unit"));
    const text2 = JSON.stringify(mechanics);
    expect(text2).toContain('"binds_event_variable":"those-attacks-1"');
    expect(text2).toContain('"binds_event_variable":"those-attacks-2"');
    expect(text2).toContain('"attacks":{"event_var":"those-attacks-1"}');
    expect(text2).toContain('"attacks":{"event_var":"those-attacks-2"}');
  });
});

describe("Round 5C hidden retention refusals", () => {
  it("refuses \"those attacks\" with no shooting moment before it", () => {
    const text = "When this unit is selected to fight, those attacks do not prevent this unit from being hidden.";
    expect(errorsOf(text,
      ["When this unit is selected to fight", "event", { kind: "selected-to-fight" }],
      ["those attacks", "attack-filter", THOSE],
      hidden("do not prevent this unit from being hidden", "this-unit"))).toMatch(/shooting moment/u);
    const passive = "Those attacks do not prevent this unit from being hidden.";
    expect(errorsOf(passive,
      ["Those attacks", "attack-filter", THOSE],
      hidden("do not prevent this unit from being hidden", "this-unit"))).toMatch(/moment before it is missing/u);
  });

  it("refuses \"those attacks\" before anything but the hidden suppression", () => {
    const text = "When this unit has shot, those attacks gain 1 to their Hit rolls.";
    expect(errorsOf(text,
      ["When this unit has shot", "event", SHOT],
      ["those attacks", "attack-filter", THOSE],
      ["gain 1 to their Hit rolls", "roll-modifier", { roll: "hit", operation: "add", value: 1 }])).toMatch(/attacking-ends-hidden suppression/u);
  });

  it("refuses bound attacks narrowed by another attack field", () => {
    const text = "When this unit is selected to shoot, those melee attacks do not prevent this unit from being hidden.";
    expect(errorsOf(text,
      ["When this unit is selected to shoot", "event", { kind: "selected-to-shoot" }],
      ["those melee attacks", "attack-filter", { attack_type: "melee", of: "antecedent" }],
      hidden("do not prevent this unit from being hidden", "this-unit"))).toMatch(/ranged, not melee/u);
    const version = currentFamilyVersion("attack-filter");
    for (const extra of [{ fight_type: "normal" }, { weapon_name: "Blade" }, { negated: true }, { all_target_same_unit: true }, { shooting_type: "snap" }]) {
      expect(() => normalizeFingerprintParameters("attack-filter", { of: "antecedent", ...extra }, version)).toThrow(/cannot narrow/u);
    }
    expect(() => normalizeFingerprintParameters("attack-filter", { of: "this-unit" }, version)).toThrow(/attack-filter.of/u);
    expect(normalizeFingerprintParameters("attack-filter", { of: "antecedent" }, version)).toEqual({ of: "antecedent" });
    expect(normalizeFingerprintParameters("attack-filter", { attack_type: "ranged", of: "antecedent" }, version)).toEqual({ attack_type: "ranged", of: "antecedent" });
    // Earlier leaves fit the new version unchanged.
    expect(normalizeFingerprintParameters("attack-filter", { attack_type: "melee" }, version)).toEqual({ attack_type: "melee" });
  });

  it("refuses a suppression on a unit other than the shooter", () => {
    // Outside a Stratagem, "your unit" after a filtered moment is the triggering unit, never this unit.
    const text = "In your Shooting phase, when a friendly BETA unit is selected to shoot, those ranged attacks do not prevent your unit from being hidden.";
    expect(errorsOf(text,
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["friendly BETA unit", "unit-filter", { side: "friendly", keywords: ["BETA"] }],
      ["is selected to shoot", "event", SELECTED_TO_SHOOT],
      ["those ranged attacks", "attack-filter", THOSE_RANGED],
      hidden("do not prevent your unit from being hidden", "this-unit"))).toMatch(/not that unit/u);
  });

  it("refuses an unbound suppression after the attacks were already made", () => {
    const text = "When a friendly GAMMA unit has shot, that unit does not stop being hidden when it attacks.";
    expect(errorsOf(text,
      ["friendly GAMMA unit", "unit-filter", { side: "friendly", keywords: ["GAMMA"] }],
      ["has shot", "event", SHOT],
      hidden("that unit does not stop being hidden when it attacks", "antecedent"))).toMatch(/name those attacks/u);
  });
});

describe("Round 5C \"Or:\" between options of different kinds (sub-shape D)", () => {
  const text = "When a friendly GAMMA unit has shot: Those attacks do not prevent that unit from being hidden. Or: That unit can make a Normal move of up to D6. That unit is not eligible to declare a charge until the end of the turn.";
  const head: Item[] = [
    ["friendly GAMMA unit", "unit-filter", { side: "friendly", keywords: ["GAMMA"] }],
    ["has shot", "event", SHOT],
    ["Those attacks", "attack-filter", THOSE],
    hidden("do not prevent that unit from being hidden", "antecedent"),
  ];
  const tail: Item[] = [
    ["That unit can make a Normal move of up to D6", "make-move", { subject: "antecedent", move_type: "normal", distance: "D6" }],
    ["That unit is not eligible to declare a charge", "eligibility-permission", { subject: "antecedent", activity: "declare-charge", allow: false }],
    ["until the end of the turn", "duration", { endpoint: "end-of-turn" }],
  ];

  it("offers the effects before and after \"Or:\" as two options", () => {
    const mechanics = mechanicsOf(text, ...head, ["Or:", "instead", { choice: true }], ...tail);
    expect(mechanics.trigger.binds_event_variable).toBe("those-attacks");
    expect(mechanics.effect).toEqual({
      type: "choice",
      options: [
        { type: "rule-state", target: "event-subject", modifier: BOUND_MODIFIER },
        { type: "sequence", steps: [
          { type: "move", target: "event-subject", modifier: { move_type: "normal", distance: "D6" } },
          { type: "permission", target: "event-subject", modifier: { activity: "declare-charge", allow: false } },
        ] },
      ],
    });
  });

  it("still runs both groups in sequence without the choice leaf", () => {
    const mechanics = mechanicsOf(text, ...head, ...tail);
    expect(mechanics.effect.type).toBe("sequence");
  });

  it("refuses an \"Or:\" with no effect before it in its part", () => {
    const lone = "When a friendly GAMMA unit has shot: Or: That unit can make a Normal move of up to D6.";
    expect(errorsOf(lone,
      ["friendly GAMMA unit", "unit-filter", { side: "friendly", keywords: ["GAMMA"] }],
      ["has shot", "event", SHOT],
      ["Or:", "instead", { choice: true }],
      tail[0]!)).toMatch(/effect on each side/u);
  });

  it("refuses to split roll result bands across the choice", () => {
    const rolled = "When this unit is selected to shoot, roll one D6: On a 2+, this unit can make a Normal move of up to D6. Or: On a 2+, those ranged attacks do not prevent this unit from being hidden.";
    expect(errorsOf(rolled,
      ["When this unit is selected to shoot", "event", { kind: "selected-to-shoot" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["On a 2+", "roll-result", { from: 2 }],
      ["this unit can make a Normal move of up to D6", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }],
      ["Or:", "instead", { choice: true }],
      ["On a 2+", "roll-result", { from: 2 }],
      ["those ranged attacks", "attack-filter", THOSE_RANGED],
      hidden("do not prevent this unit from being hidden", "this-unit"))).toMatch(/roll results/u);
  });
});

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");

/** A real authored entry to carry compiled mechanics through the ability schema and describer. */
function base(): Record<string, unknown> {
  const entries = JSON.parse(readFileSync(join(dataRoot, "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  return entries.find((item) => item.ability_id === "control-edict-adeptus-mechanicus")!;
}

describe("Round 5C hidden retention: compiled entries validate and render", () => {
  it("validates and renders the bound suppression and the \"Or:\" choice", () => {
    const text = "When a friendly GAMMA unit has shot: Those attacks do not prevent that unit from being hidden. Or: That unit can make a Normal move of up to D6.";
    const mechanics = mechanicsOf(text,
      ["friendly GAMMA unit", "unit-filter", { side: "friendly", keywords: ["GAMMA"] }],
      ["has shot", "event", SHOT],
      ["Those attacks", "attack-filter", THOSE],
      hidden("do not prevent that unit from being hidden", "antecedent"),
      ["Or:", "instead", { choice: true }],
      ["That unit can make a Normal move of up to D6", "make-move", { subject: "antecedent", move_type: "normal", distance: "D6" }]);
    const check = checkEntry(entryWithMechanics(base(), mechanics as never));
    expect(check.errors).toEqual([]);
    expect(check.rendered_text).toContain("Select one of the following:\n    - Those attacks do not stop the triggering unit from being hidden.");
  });

  it("rejects bound attacks on any rule but the hidden suppression", () => {
    const entry = entryWithMechanics(base(), {
      behavior: "triggered", scope: { duration: "phase" },
      trigger: { event: "attacks-resolved", filter: { kind: "shoot" }, binds_event_variable: "those-attacks" },
      effect: { type: "rule-state", target: "this-unit", modifier: { direction: "granted", rule_kind: "core-rule", rule: "attacking-ends-hidden", attacks: { event_var: "those-attacks" } } },
    } as never);
    expect(checkEntry(entry).errors.join("; ")).toMatch(/must be equal to constant/u);
  });
});
