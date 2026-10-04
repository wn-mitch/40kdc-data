import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { targetRestrictions } from "../src/round5c/compile-conditions.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { designationLabel } from "../src/translate/designations.js";

/** Leaves in source order at the current version of their family. */
function leaves(...items: Array<[string, Record<string, unknown>, string?]>): CompileLeaf[] {
  return items.map(([family, parameters, fragment], index) => {
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: index * 10, end_byte: index * 10 + 5, ...(fragment ? { fragment } : {}) };
  });
}

function mechanicsOf(list: CompileLeaf[]) {
  const result = compileLeaves(list);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Record<string, unknown>;
}

const heal = (): [string, Record<string, unknown>] => ["regain-wounds", { subject: "this-unit", amount: "D3" }];

describe("Round 5C family extensions, eleventh round", () => {
  it("drops \"in any phase\" as a gate, but keeps a named turn", () => {
    const any = mechanicsOf(leaves(["phase-window", { phase: "any", turn: "either" }], heal()));
    expect(JSON.stringify(any)).not.toContain("phase-is");
    expect(any).toEqual(mechanicsOf(leaves(heal())));
    const yours = JSON.stringify(mechanicsOf(leaves(["phase-window", { phase: "any", turn: "your" }], heal())));
    expect(yours).toContain('"player-turn-is"');
    expect(yours).not.toContain("phase-is");
  });

  it("counts twice per battle as two uses a battle", () => {
    const usage = mechanicsOf(leaves(["usage-limit", { frequency: "twice-per-battle", per: "unit" }], heal())).usage;
    expect(usage).toEqual({ frequency: "n-per-battle", count: 2, per: "unit" });
  });

  it("reads \"whose attacks have been resolved this phase\" as the attacks-resolved history, not being selected", () => {
    const text = JSON.stringify(mechanicsOf(leaves(["unit-activity", { activities: ["resolved-attacks-this-phase"], subject: "this-unit", negated: false }], heal())));
    expect(text).toContain('"event":"attacks-resolved"');
    expect(text).toContain('"window":"phase"');
    expect(text).not.toContain('"to":"shoot"');
  });

  it("lets a binding alone be a Stratagem's TARGET, and still refuses two bindings", () => {
    const bound = (to: string) => leaves(["target-binding", { bound_to: to }, "TARGET"])[0]!;
    expect(targetRestrictions([bound("attacked-unit")], [])).toEqual({ count: "one", selects: "unit", bound_to: "attacked-unit" });
    expect(() => targetRestrictions([bound("attacked-unit"), bound("triggering-unit")], [])).toThrow(/bound to more than one unit/u);
  });

  it("reads engaged at an earlier point only for states the DSL can read then", () => {
    expect(normalizeFingerprintParameters("unit-state", { states: ["engaged"], subject: "event-subject", with: "this-unit", at: "phase-start", negated: false }, currentFamilyVersion("unit-state")))
      .toMatchObject({ at: "phase-start" });
    expect(() => normalizeFingerprintParameters("unit-state", { states: ["below-starting-strength"], subject: "this-unit", at: "turn-start", negated: false }, currentFamilyVersion("unit-state")))
      .toThrow(/at reads only/u);
  });
});

describe("leading-unit from the led unit's side", () => {
  it("says this unit is led by a Leader with keywords, negates, and names a selected unit", () => {
    const text = (parameters: Record<string, unknown>) => JSON.stringify(mechanicsOf(leaves(["leading-unit", parameters], heal())));
    expect(text({ subject: "this-unit", attachment: "led", leader_keywords: ["FARSEER"] }))
      .toContain('{"type":"attachment","parameters":{"role":"led","with":{"all_of":["FARSEER"]}}}');
    expect(text({ subject: "this-model", attachment: "leading", negated: true })).toContain('"operator":"not"');
    expect(text({ subject: "selected-unit", attachment: "led" })).toContain('"subject":"selected-unit"');
    expect(() => normalizeFingerprintParameters("leading-unit", { subject: "this-model", attachment: "leading", leader_keywords: ["FARSEER"] }, currentFamilyVersion("leading-unit")))
      .toThrow(/attachment led/u);
  });
});

describe("objective range against one marker", () => {
  it("names a designated marker, and refuses a selected one when nothing selects a marker", () => {
    const designated = JSON.stringify(mechanicsOf(leaves(["unit-position", { kind: "objective-range", controlled_by: "any", subject: "this-unit", negated: false, objective: "designated", objective_tag: "acquisition" }], heal())));
    expect(designated).toContain('"of":{"objective":{"designated":"acquisition"}}');
    const unselected = compileLeaves(leaves(["unit-position", { kind: "objective-range", controlled_by: "any", subject: "this-unit", negated: false, objective: "selected" }], heal()));
    expect(unselected.ok ? "" : unselected.errors.join()).toMatch(/selects no objective marker/u);
    expect(() => normalizeFingerprintParameters("unit-position", { kind: "objective-range", controlled_by: "any", subject: "this-unit", negated: false, objective: "designated", objective_tag: "not-a-tag" }, currentFamilyVersion("unit-position")))
      .toThrow(/not a registered designation/u);
  });
});

describe("designations each rule prints", () => {
  it("tags a unit with the rule's own designation, and labels it as printed", () => {
    const text = JSON.stringify(mechanicsOf(leaves(["apply-mark", { subject: "this-unit", tag: "wracked-with-agonies" }])));
    expect(text).toContain('"type":"designate"');
    expect(text).toContain('"tag":"wracked-with-agonies"');
    expect(designationLabel("infested-with-snotlings")).toBe("infested with Snotlings");
    expect(() => normalizeFingerprintParameters("apply-mark", { subject: "this-unit", tag: "wracked" }, currentFamilyVersion("apply-mark"))).toThrow(/not a registered designation/u);
    // Version 1's schema is frozen at the registry it was reviewed with; growing the registry must not drift it.
    expect(() => normalizeFingerprintParameters("apply-mark", { subject: "this-unit", tag: "wracked-with-agonies" }, 1)).toThrow();
    expect(normalizeFingerprintParameters("apply-mark", { subject: "this-unit", tag: { source: "wracked with agonies" } }, currentFamilyVersion("apply-mark")))
      .toEqual({ subject: "this-unit", tag: { source: "wracked with agonies" } });
  });
});

describe("a unit-filter before moments joined by \"or\"", () => {
  /** Leaves on their own wording in `text`, in order, all in the WHEN fragment. */
  function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
    const bytes = Buffer.from(text, "utf8");
    let from = 0;
    return items.map(([wording, family, parameters]) => {
      const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
      if (start < 0) throw new Error(`"${wording}" is not in the text`);
      from = start + Buffer.byteLength(wording, "utf8");
      const version = currentFamilyVersion(family);
      return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "WHEN" };
    });
  }
  const triggersOf = (text: string, between: string) => {
    const when = `when a friendly WALKER unit is **selected to move**${between}**declares a charge**.`;
    const leaves = placed(when,
      ["a friendly WALKER unit", "unit-filter", { side: "friendly", keywords: ["WALKER"] }],
      ["is **selected to move", "event", { kind: "selected", to: "move" }],
      ["**declares a charge", "event", { kind: "targets-selected", action_kind: "charge" }]);
    const version = currentFamilyVersion("regain-wounds");
    const end = Buffer.byteLength(when);
    const heal: CompileLeaf = { role: familyRole("regain-wounds", version), family_id: "regain-wounds", family_version: version, parameters: { subject: "this-unit", amount: "D3" }, start_byte: end + 1, end_byte: end + 2, fragment: "EFFECT" };
    const result = compileLeaves([...leaves, heal], `${when} ${text}`);
    if (!result.ok) throw new Error(result.errors.join("; "));
    return (result.mechanics as { trigger: Array<{ subject?: unknown }> }).trigger;
  };

  it("gives the alternative moment the same unit", () => {
    const [move, charge] = triggersOf("x", "** or **");
    expect(charge!.subject).toEqual(move!.subject);
    expect(JSON.stringify(charge!.subject)).toContain("WALKER");
  });

  it("leaves a moment joined by other words to its own unit", () => {
    const [, charge] = triggersOf("x", "**, then later **");
    expect(JSON.stringify(charge!.subject ?? null)).not.toContain("WALKER");
  });
});
