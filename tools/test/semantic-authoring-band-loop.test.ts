import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { describeAbility } from "../src/translate/index.js";

// Fabricated wording and identities; no rules text.

type Item = [string, string, Record<string, unknown>];

function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version,
      parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const TEXT = "Each time this model is wrecked, after the units embarked within it have made their emergency disembark moves, roll one D6. On a 6, it bursts; each unit within 6\" of that model suffers a number of mortal wounds equal to its rating.";

const WRECKED: Item = ["Each time this model is wrecked", "event", { kind: "this-model-destroyed" }];
const DISEMBARK: Item = ["after the units embarked within it have made their emergency disembark moves", "event", { kind: "move-ended", move_types: ["disembark"] }];
const ROLL: Item = ["roll one D6", "dice-roll", { dice: "D6" }];
const SIX: Item = ["On a 6", "roll-result", { from: 6, to: 6 }];
const EACH: Item[] = [
  ["each", "for-each-unit-select", {}],
  ["unit", "unit-filter", { side: "any" }],
  ["within 6\" of that model", "unit-position", { kind: "within", inches: 6, of: "this-model", subject: "antecedent", negated: false }],
];
const WOUNDS: Item = ["suffers a number of mortal wounds equal to its rating", "mortal-wounds", { recipient: "antecedent", count: "rating" }];

function compiled(items: Item[], text = TEXT) {
  return compileLeaves(placed(text, ...items), text, {});
}

function mechanicsOf(items: Item[], text = TEXT): any {
  const result = compiled(items, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics;
}

describe("a loop printed after a roll's band (compile-band-loop.ts)", () => {
  it("rolls once, and on the band loops over each unit near the model", () => {
    const mechanics = mechanicsOf([WRECKED, DISEMBARK, ROLL, SIX, ...EACH, WOUNDS]);
    expect(mechanics.effect).toEqual({ type: "dice-gated", dice: "D6", threshold: 6, comparison: "gte", on_fail: null, on_success: {
      type: "for-each-unit", selector: { filter: { owner: "any" } }, effect: {
        type: "conditional", condition: { type: "matches", parameters: { subject: "recipient", filter: { within: { of: "this-model", range: { inches: 6 } } } } },
        effect: { type: "mortal-wounds", target: "recipient", modifier: { count: { rating: true } } },
      },
    } });
  });

  it("keeps the loop around the roll when the roll is made for each unit", () => {
    const text = "Each time this model is wrecked, for each unit within 6\" of that model, roll one D6. On a 6, that unit suffers a number of mortal wounds equal to its rating.";
    const items: Item[] = [WRECKED, ...EACH.map((item): Item => item[0] === "each" ? ["for each", item[1], item[2]] : item), ROLL, SIX, ["that unit suffers a number of mortal wounds equal to its rating", "mortal-wounds", { recipient: "antecedent", count: "rating" }]];
    expect(mechanicsOf(items, text).effect.type).toBe("for-each-unit");
  });

  it("keeps the loop around the roll when a full stop sets it apart from the band", () => {
    const text = TEXT.replace("it bursts; each unit", "it bursts. Each unit");
    const items: Item[] = [WRECKED, DISEMBARK, ROLL, SIX, ["Each", "for-each-unit-select", {}], EACH[1]!, EACH[2]!, WOUNDS];
    const result = compiled(items, text);
    expect(result.ok && (result.mechanics as any).effect.type === "dice-gated").toBe(false);
  });

  it("refuses a loop after a band when the roll has another outcome too", () => {
    const text = TEXT.replace("equal to its rating.", "equal to its rating; on a 1, this model suffers 1 mortal wound.");
    const items: Item[] = [WRECKED, DISEMBARK, ROLL, SIX, ...EACH, WOUNDS, ["on a 1", "roll-result", { from: 1, to: 1 }], ["this model suffers 1 mortal wound", "mortal-wounds", { recipient: "this-model", count: "1" }]];
    const result = compiled(items, text);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/this roll has no single band to hold it/u);
  });
});

describe("a destruction resolved after emergency disembarks (compile-emergency-disembark.ts)", () => {
  it("folds the disembark into the destruction's timing", () => {
    const mechanics = mechanicsOf([WRECKED, DISEMBARK, ROLL, SIX, ...EACH, WOUNDS]);
    expect(mechanics.trigger).toEqual({ event: "model-destroyed", object: "this-model", filter: { timing: "after-emergency-disembark" } });
    expect(describeAbility({ id: "sample", name: "Sample", ...mechanics })).toContain("When this model is destroyed, after the units embarked within it have made their emergency disembark moves:");
  });

  it("leaves a disembark moment joined by more than a comma", () => {
    const text = TEXT.replace("wrecked, after", "wrecked and, after");
    const result = compiled([WRECKED, DISEMBARK, ROLL, SIX, ...EACH, WOUNDS], text);
    expect(result.ok && (result.mechanics as any).trigger?.filter?.timing === "after-emergency-disembark").toBe(false);
  });

  it("leaves a disembark moment that does not name an emergency disembark", () => {
    const text = TEXT.replace("emergency disembark moves", "disembark moves");
    const items: Item[] = [WRECKED, ["after the units embarked within it have made their disembark moves", "event", { kind: "move-ended", move_types: ["disembark"] }], ROLL, SIX, ...EACH, WOUNDS];
    const result = compiled(items, text);
    expect(result.ok && (result.mechanics as any).trigger?.filter?.timing === "after-emergency-disembark").toBe(false);
  });
});

describe("mortal wounds counted by the unit's rating", () => {
  it("takes rating only as the count", () => {
    const version = currentFamilyVersion("mortal-wounds");
    expect(normalizeFingerprintParameters("mortal-wounds", { recipient: "antecedent", count: "rating" }, version)).toEqual({ recipient: "antecedent", count: "rating" });
    expect(() => normalizeFingerprintParameters("mortal-wounds", { recipient: "antecedent", count: "ratings" }, version)).toThrow();
  });
});
