import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";

/**
 * A Stratagem whose TARGET offers the triggering unit or a unit near it ("That X unit, or one
 * friendly Y unit within 3\" of it"): two exclusive modes, "your unit" as whichever was selected,
 * and an aura measured from that target. Wording is fabricated; leaves sit on their own wording.
 */

type Item = [wording: string, family: string, parameters: Record<string, unknown>, fragment: string];

/** Leaves on their own wording in `text`, in order. */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters, fragment]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    const end = start + Buffer.byteLength(wording, "utf8");
    from = end;
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: end, fragment };
  });
}

function compiled(text: string, ...items: Item[]): { mechanics: Record<string, any>; target: any } {
  const result = compileLeaves(placed(text, ...items), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return { mechanics: result.mechanics as unknown as Record<string, any>, target: result.core?.target_restrictions };
}

function refused(text: string, ...items: Item[]): string {
  const result = compileLeaves(placed(text, ...items), text);
  if (result.ok) throw new Error("compiled, but should refuse");
  return result.errors.join("; ");
}

const ajv = createValidator();
const stratagemOk = ajv.getSchema("https://40kdc.dev/schemas/core/stratagem.schema.json")!;
const abilityOk = ajv.getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/ability.schema.json")!;

const TEXT = [
  "Any phase, just after an ALPHA unit from your army suffers a mortal wound.",
  "That ALPHA unit, or one friendly ALPHA BETA unit within 3\" of it.",
  "Until the end of the phase, models in your unit have the Feel No Pain 5+ ability against mortal wounds. If you targeted an ALPHA BETA unit from your army with this Stratagem, then until the end of the phase, while a friendly ALPHA unit is within 3\" of your unit, models in that unit have the Feel No Pain 5+ ability against mortal wounds.",
].join("\n");

const fnp = (wording: string, subject: string): Item => [wording, "feel-no-pain", { subject, threshold: 5, against: "mortal" }, "EFFECT"];
const LEAVES: Item[] = [
  ["Any phase", "use-window", { your_phases: [], opponent_phases: [], either_phases: ["command", "movement", "shooting", "charge", "fight"] }, "WHEN"],
  ["ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "WHEN"],
  ["from your army", "unit-owner", { owner: "friendly" }, "WHEN"],
  ["suffers a mortal wound", "event", { kind: "damage-allocated", attack_type: "mortal" }, "WHEN"],
  ["That ALPHA unit", "triggering-target", { selects: "unit", keywords: ["ALPHA"], match: "all" }, "TARGET"],
  ["one", "stratagem-target", { count: "one" }, "TARGET"],
  ["friendly ALPHA BETA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA", "BETA"] }, "TARGET"],
  ["within 3\" of it", "unit-position", { kind: "within", inches: 3, of: "antecedent", subject: "this-unit", negated: false }, "TARGET"],
  ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
  fnp("models in your unit have the Feel No Pain 5+ ability against mortal wounds", "this-unit"),
  ["you targeted an ALPHA BETA unit from your army with this Stratagem", "unit-keyword", { keywords: ["ALPHA", "BETA"], subject: "this-unit", negated: false, match: "all" }, "EFFECT"],
  ["until the end of the phase", "duration", { endpoint: "end-of-phase" }, "EFFECT"],
  ["friendly ALPHA unit", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }, "EFFECT"],
  ["within 3\" of your unit", "aura-range", { inches: 3, of: "this-unit" }, "EFFECT"],
  fnp("models in that unit have the Feel No Pain 5+ ability against mortal wounds", "antecedent"),
];

const first = { stratagem_target: "first" };
const second = { stratagem_target: "second" };
const isJumper = (subject: unknown) => ({ type: "matches", parameters: { subject, filter: { all_of: ["ALPHA", "BETA"] } } });
const nearby = (of: unknown) => ({ type: "feel-no-pain", target: { owner: "friendly", all_of: ["ALPHA"], within: { range: { inches: 3 }, of } }, modifier: { threshold: 5, against: "mortal" } });

describe("Semantic authoring Stratagem that targets the triggering unit or a unit near it", () => {
  it("puts the triggering unit and the nearby unit in exclusive modes, measuring the second from the moment's unit", () => {
    const { target } = compiled(TEXT, ...LEAVES);
    expect(target).toEqual([
      { name: "first", count: "one", mode: "a", selects: "unit", required_keywords: ["ALPHA"], bound_to: "triggering-unit" },
      {
        name: "second", count: "one", mode: "b", side: "your-army", selects: "unit", required_keywords: ["ALPHA", "BETA"],
        // Not {stratagem_target: first}: in mode b the first target is never selected.
        eligibility: { type: "matches", parameters: { filter: { within: { of: "event-object", range: { inches: 3 } } } } },
      },
    ]);
    const record = { id: "fabricated", name: "Fabricated", cp_cost: 1, category: "battle-tactic", phases: ["fight"], game_version: { edition: "11th", dataslate: "2026-q3" }, target_restrictions: target };
    stratagemOk(record);
    // Only the target is under test; the fabricated record's other fields are not.
    expect((stratagemOk.errors ?? []).filter((error) => error.instancePath.startsWith("/target_restrictions"))).toEqual([]);
  });

  it("reads \"your unit\" as the selected target: an effect per target, a condition met by the selected one", () => {
    const { mechanics } = compiled(TEXT, ...LEAVES);
    expect(mechanics.behavior).toBe("reactive");
    expect(mechanics.trigger).toMatchObject({ event: "damage-allocated", object: { owner: "friendly", all_of: ["ALPHA"] } });
    expect(mechanics.effect).toEqual({
      type: "sequence",
      steps: [
        { type: "feel-no-pain", target: first, modifier: { threshold: 5, against: "mortal" } },
        { type: "feel-no-pain", target: second, modifier: { threshold: 5, against: "mortal" } },
        {
          type: "conditional",
          condition: { operator: "or", operands: [isJumper(first), isJumper(second)] },
          // The aura from a target is the effect on every friendly ALPHA unit within 3" of it.
          effect: { type: "sequence", steps: [nearby(first), nearby(second)] },
        },
      ],
    });
    const entry = { ability_id: "fabricated", name: "Fabricated", authored_by: "40kdc-community", game_version: { edition: "11th", dataslate: "2026-q3" }, unit_ids: [], faction_id: null, ability_type: "stratagem", ...mechanics };
    expect(abilityOk(entry), JSON.stringify(abilityOk.errors)).toBe(true);
  });

  it("still refuses \"your unit\" when a mode holds several units", () => {
    const several = TEXT.replace("one friendly", "up to two friendly");
    const leaves = LEAVES.map((item): Item => item[1] === "stratagem-target" ? ["up to two", "stratagem-target", { count: "up-to", count_max: 2 }, "TARGET"] : item);
    expect(refused(several, ...leaves)).toMatch(/names this unit \(subject\), but the Stratagem has several targets/u);
  });

  it("refuses an aura from a target whose effect is not on the unit the aura reaches", () => {
    const own = LEAVES.map((item, at): Item => at === LEAVES.length - 1 ? fnp(item[0], "this-unit") : item);
    expect(refused(TEXT, ...own)).toMatch(/aura-range at byte \d+ measures from a Stratagem target, so its body must be one effect on the unit it reaches/u);
  });
});

describe("Semantic authoring unit-keyword match all", () => {
  const normalize = (parameters: Record<string, unknown>) => normalizeFingerprintParameters("unit-keyword", parameters, 8);

  it("keeps match all on two or more keywords, and several keywords without it stay alternatives", () => {
    expect(normalize({ keywords: ["ALPHA", "BETA"], subject: "this-unit", negated: false, match: "all" })).toMatchObject({ match: "all" });
    expect(normalize({ keywords: ["ALPHA", "BETA"], subject: "this-unit", negated: false })).not.toHaveProperty("match");
  });

  it("refuses match all on one keyword, on a negated leaf, and any other match", () => {
    expect(() => normalize({ keywords: ["ALPHA"], subject: "this-unit", negated: false, match: "all" })).toThrow(/two or more keywords/u);
    expect(() => normalize({ keywords: ["ALPHA", "BETA"], subject: "this-unit", negated: true, match: "all" })).toThrow(/not negated/u);
    expect(() => normalize({ keywords: ["ALPHA", "BETA"], subject: "this-unit", negated: false, match: "any" })).toThrow(/all or omitted/u);
  });
});
