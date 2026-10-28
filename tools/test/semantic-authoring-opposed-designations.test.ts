import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const run = (text: string, ...items: Item[]) => compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-rivalry", name: "Rivalry" });

const TEXT = "Each time a CRIMSON unit from your army destroys an enemy unit, CRIMSON units from your army are winning the wager. While CRIMSON units from your army are winning the wager, AZURE units from your army are losing the wager, and vice versa.";
const SCORER: Item = ["CRIMSON unit", "unit-filter", { side: "friendly", keywords: ["CRIMSON"] }];
const OWNER: Item = ["from your army", "unit-owner", { owner: "friendly" }];
const DESTROYS: Item = ["destroys an", "event", { kind: "unit-destroyed", by: "antecedent", object_owner: "enemy" }];
const ENEMY: Item = ["enemy unit", "unit-filter", { side: "enemy" }];
const GROUP: Item = ["CRIMSON units", "unit-filter", { side: "friendly", keywords: ["CRIMSON"] }];
const WINNING: Item = ["are winning the wager", "apply-mark", { subject: "antecedent", tag: "winning-the-wager" }];
const PAIR: Item = ["While CRIMSON units from your army are winning the wager, AZURE units from your army are losing the wager, and vice versa", "opposed-designations",
  { tag: "winning-the-wager", opposite_tag: "losing-the-wager", keywords: ["CRIMSON"], opposite_keywords: ["AZURE"] }];

const crimson = { owner: "friendly", all_of: ["CRIMSON"] };
const azure = { owner: "friendly", all_of: ["AZURE"] };

describe("opposed designations", () => {
  it("tags the units after a restated enemy object, and pairs the tag with its opposite on the other group", () => {
    const result = run(TEXT, SCORER, OWNER, DESTROYS, ENEMY, GROUP, OWNER, WINNING, PAIR);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const effect = result.mechanics.effect as Record<string, any>;
    // The "enemy unit" only restates the moment's object; the CRIMSON units after it are the tagged units.
    expect(effect).toEqual({ type: "sequence", steps: [
      { type: "designate", target: crimson, modifier: { tag: "winning-the-wager" } },
      { type: "designate", target: crimson, modifier: { tag: "losing-the-wager", clear: true } },
      { type: "designate", target: azure, modifier: { tag: "losing-the-wager" } },
      { type: "designate", target: azure, modifier: { tag: "winning-the-wager", clear: true } },
    ] });
    expect(result.mechanics.trigger).toMatchObject({ event: "destroyed" });
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json");
    expect(validate?.(effect), JSON.stringify(validate?.errors)).toBe(true);
  });

  it("refuses a pair no designation of the record names, and a designation on neither group", () => {
    const silent = run(TEXT, SCORER, OWNER, DESTROYS, ENEMY, GROUP, OWNER, ["are winning the wager", "apply-mark", { subject: "antecedent", tag: "riled-up" }], PAIR);
    expect(silent.ok ? "" : silent.errors.join(" ")).toContain("pairs no designation");
    const strangers = TEXT.replace("destroys an enemy unit, CRIMSON units", "destroys an enemy unit, VIOLET units");
    const stray = run(strangers, SCORER, OWNER, DESTROYS, ENEMY, ["VIOLET units", "unit-filter", { side: "friendly", keywords: ["VIOLET"] }], OWNER, WINNING, PAIR);
    expect(stray.ok ? "" : stray.errors.join(" ")).toContain("names neither group");
  });

  it("refuses one tag twice and one group twice", () => {
    const base = { tag: "winning-the-wager", opposite_tag: "losing-the-wager", keywords: ["CRIMSON"], opposite_keywords: ["AZURE"] };
    expect(() => normalizeFingerprintParameters("opposed-designations", { ...base, opposite_tag: "winning-the-wager" }, 1)).toThrow(/two different tags/);
    expect(() => normalizeFingerprintParameters("opposed-designations", { ...base, opposite_keywords: ["crimson"] }, 1)).toThrow(/two different groups/);
  });
});
