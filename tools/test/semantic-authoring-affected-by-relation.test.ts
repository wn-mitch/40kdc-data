import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { mergeStackedFilters } from "../src/semantic-authoring/compile-unit-filters.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters as normalizeAt } from "../src/semantic-authoring/contracts.js";
import { designationLabel } from "../src/translate/designations.js";

/** Leaves on their own wording in `text`, in order, all in one fragment (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
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

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

/** The Bondsman shape: select one friendly ARMIGER unit, apply the designation by this unit until the next Command phase. */
const BONDSMAN_TEXT = "Select one friendly ARMIGER unit. That unit is affected by this ability until the start of your next Command phase.";
const bondsman = (): CompileLeaf[] => placed(BONDSMAN_TEXT,
  ["Select one friendly", "select-unit", { scope: "friendly", distance: "any", visible: false }],
  ["ARMIGER unit", "unit-filter", { side: "friendly", keywords: ["ARMIGER"] }],
  ["That unit is affected by this ability", "apply-mark", { subject: "selected-unit", tag: "bondsman-affected", by: "this-unit" }],
  ["until the start of your next Command phase", "duration", { endpoint: "start-of-next-command-phase" }],
);

/** The Duty shape: a model affected by the Bondsman may declare a charge after it Advanced (8737's wording, fabricated). */
const DUTY_TEXT = "While a model is affected by this ability, it is eligible to declare a charge in a turn in which it Advanced.";
const duty = (filter: Record<string, unknown>): CompileLeaf[] => placed(DUTY_TEXT,
  ["While a model is affected by this ability", "unit-filter", filter],
  ["it is eligible to declare a charge", "eligibility-permission", { subject: "antecedent", activity: "declare-charge", allow: true, despite: "advanced" }],
  ["in a turn in which it Advanced", "unit-activity", { activities: ["advanced-this-turn"], subject: "antecedent", negated: false }],
);

const AFFECTED = { side: "friendly", level: "model", designated: "bondsman-affected", designated_by: "this-unit" };

/** A parameter set checked against the family's current version (a leaf's own version when authored). */
const normalizeFingerprintParameters = (family: string, parameters: Record<string, unknown>) => normalizeAt(family, parameters, currentFamilyVersion(family));

describe("apply-mark@4 by: a designation applied by a unit", () => {
  it("compiles a Bondsman application to a designate that names its applier and ends at the printed duration", () => {
    const mechanics = mechanicsOf(bondsman(), BONDSMAN_TEXT);
    expect(mechanics.effect).toEqual({
      type: "select-units",
      selector: { filter: { owner: "friendly", all_of: ["ARMIGER"] }, count: { min: 1, max: 1 } },
      effect: { type: "designate", target: "selected-unit", modifier: { tag: "bondsman-affected", by: "this-unit", clears_on: "until-next-command-phase" } },
    });
    expect(mechanics.scope.duration).toBe("until-next-command-phase");
  });

  it("refuses a designation applied by a unit with no printed duration, because it would never end", () => {
    const text = "That unit is affected by this ability.";
    expect(() => mechanicsOf(placed(text, ["That unit is affected by this ability", "apply-mark", { subject: "this-unit", tag: "bondsman-affected", by: "this-unit" }]), text))
      .toThrow(/needs its duration printed/u);
  });

  it("refuses a designation when the record prints two durations, since neither is named as its end", () => {
    const text = "That unit is affected by this ability until the start of your next Command phase. Until the end of the turn, it is also Battle-shocked.";
    expect(() => mechanicsOf(placed(text,
      ["That unit is affected by this ability", "apply-mark", { subject: "this-unit", tag: "bondsman-affected", by: "this-unit" }],
      ["until the start of your next Command phase", "duration", { endpoint: "start-of-next-command-phase" }],
      ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }],
    ), text)).toThrow(/two printed durations/u);
  });

  it("leaves a designation with no applier as it was: no by, no clears_on", () => {
    const text = "That unit is wracked with agonies until the end of the turn.";
    const modifier = mechanicsOf(placed(text,
      ["That unit is wracked with agonies", "apply-mark", { subject: "this-unit", tag: "wracked-with-agonies" }],
      ["until the end of the turn", "duration", { endpoint: "end-of-turn" }],
    ), text).effect.modifier;
    expect(modifier).toEqual({ tag: "wracked-with-agonies" });
  });

  it("accepts the four appliers, refuses another, and refuses an unregistered tag with by", () => {
    for (const by of ["this-unit", "this-model", "selected-unit", "event-subject"]) {
      expect(() => normalizeFingerprintParameters("apply-mark", { subject: "selected-unit", tag: "bondsman-affected", by })).not.toThrow();
    }
    expect(() => normalizeFingerprintParameters("apply-mark", { subject: "selected-unit", tag: "bondsman-affected", by: "enemy-unit" })).toThrow(/apply-mark.by/u);
    expect(() => normalizeFingerprintParameters("apply-mark", { subject: "selected-unit", tag: "bondsman-affected", by: "antecedent" })).toThrow(/apply-mark.by/u);
    expect(() => normalizeFingerprintParameters("apply-mark", { subject: "selected-unit", tag: "not-a-real-designation", by: "this-unit" })).toThrow(/apply-mark.tag/u);
  });
});

describe("unit-filter@8 designated and designated_by", () => {
  it("names the affected units of a Duty as the permission target, and tests each affected unit's Advance", () => {
    const permissionOnly = placed(DUTY_TEXT,
      ["While a model is affected by this ability", "unit-filter", AFFECTED],
      ["it is eligible to declare a charge", "eligibility-permission", { subject: "antecedent", activity: "declare-charge", allow: true, despite: "advanced" }],
    );
    expect(JSON.stringify(mechanicsOf(permissionOnly, DUTY_TEXT).effect)).toContain('"designated":"bondsman-affected","designated_by":"this-unit"');
    // The Advanced test binds to each affected unit (recipient), not to the group or to the bearer.
    const effect = mechanicsOf(duty(AFFECTED), DUTY_TEXT).effect;
    expect(effect.type).toBe("conditional");
    expect(effect.condition).toEqual({ type: "happened", parameters: { subject: "recipient", event: "move-ended", filter: { move_types: ["advance"] }, window: "turn" } });
    expect(effect.effect.target).toEqual({ owner: "friendly", level: "model", designated: "bondsman-affected", designated_by: "this-unit" });
  });

  it("still refuses an Advanced test in a later sentence, which the designated filter's effect does not govern", () => {
    const text = "While a model is affected by this ability, it is eligible to declare a charge. In a turn in which it Advanced.";
    const leaves = placed(text,
      ["While a model is affected by this ability", "unit-filter", AFFECTED],
      ["it is eligible to declare a charge", "eligibility-permission", { subject: "antecedent", activity: "declare-charge", allow: true, despite: "advanced" }],
      ["In a turn in which it Advanced", "unit-activity", { activities: ["advanced-this-turn"], subject: "antecedent", negated: false }],
    );
    expect(() => mechanicsOf(leaves, text)).toThrow(/no leaf binds it to that/u);
  });

  it("keeps a plain unit-filter's permission target free of designation fields", () => {
    expect(JSON.stringify(mechanicsOf(placed(DUTY_TEXT, ["While a model is affected by this ability", "unit-filter", { side: "friendly", level: "model" }], ["it is eligible to declare a charge", "eligibility-permission", { subject: "antecedent", activity: "declare-charge", allow: true, despite: "advanced" }]), DUTY_TEXT).effect)).not.toContain("designated");
  });

  it("refuses designated_by without designated, an unregistered designation, and a non-unit applier", () => {
    expect(() => normalizeFingerprintParameters("unit-filter", { side: "friendly", designated_by: "this-unit" })).toThrow(/needs designated/u);
    expect(() => normalizeFingerprintParameters("unit-filter", { side: "friendly", designated: "not-a-real-designation" })).toThrow(/unit-filter.designated/u);
    expect(() => normalizeFingerprintParameters("unit-filter", { side: "friendly", designated: "bondsman-affected", designated_by: "enemy-unit" })).toThrow(/designated_by/u);
  });

  it("retains a designation and its applier on a selection's unit filter", () => {
    const text = "Select one friendly unit affected by this ability. That unit regains 1 lost wound.";
    const leaves = placed(text,
      ["Select one friendly", "select-unit", { scope: "friendly", distance: "any", visible: false }],
      ["unit affected by this ability", "unit-filter", { side: "friendly", designated: "bondsman-affected", designated_by: "this-unit" }],
      ["That unit regains 1 lost wound", "regain-wounds", { subject: "selected-unit", amount: "1" }],
    );
    const mechanics = mechanicsOf(leaves, text);
    expect(mechanics.effect.selector.filter).toEqual({ owner: "friendly", designated: "bondsman-affected", designated_by: "this-unit" });
    expect(mechanics.effect.effect).toMatchObject({ type: "heal", target: "selected-unit" });
  });

  it("stacks two filters into one only when their designations agree", () => {
    const text = "Friendly ARMIGER units affected by this ability.";
    const stacked = (second: Record<string, unknown>) => placed(text,
      ["Friendly ARMIGER units", "unit-filter", { side: "friendly", keywords: ["ARMIGER"] }],
      ["affected by this ability", "unit-filter", second],
    );
    const merged = mergeStackedFilters(stacked({ side: "friendly", designated: "bondsman-affected", designated_by: "this-unit" }));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.parameters).toMatchObject({ keywords: ["ARMIGER"], designated: "bondsman-affected", designated_by: "this-unit" });
    expect(mergeStackedFilters(stacked({ side: "friendly", designated: "bondsman-affected" }))).toHaveLength(1);
    // Two different designations, or two different appliers, name two sets of units: no merge.
    const conflicting = (first: Record<string, unknown>, second: Record<string, unknown>) => placed(text,
      ["Friendly ARMIGER units", "unit-filter", first],
      ["affected by this ability", "unit-filter", second],
    );
    expect(mergeStackedFilters(conflicting({ side: "friendly", designated: "bondsman-affected" }, { side: "friendly", designated: "spotted" }))).toHaveLength(2);
    expect(mergeStackedFilters(conflicting({ side: "friendly", designated: "bondsman-affected", designated_by: "this-unit" }, { side: "friendly", designated: "bondsman-affected", designated_by: "selected-unit" }))).toHaveLength(2);
  });
});

describe("the bondsman-affected designation's label", () => {
  it("prints the rules' term, so the describer does not fall back to the internal id", () => {
    expect(designationLabel("bondsman-affected")).toBe("Bondsman-affected");
  });
});
