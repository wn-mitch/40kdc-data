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

const TEXT = "When an enemy unit targets this unit with ranged attacks, until that enemy unit has shot, when this unit makes a **save roll**:\n• On an unmodified 6, that enemy unit suffers 1 mortal wound after that enemy unit has shot.";

const LEAD: Item[] = [
  ["enemy unit", "unit-filter", { side: "enemy" }],
  ["targets this unit with ranged attacks", "event", { kind: "targets-selected", owner: "enemy", action_kind: "shoot", object: "this-unit" }],
  ["until that enemy unit has shot", "duration", { endpoint: "end-of-attack-sequence" }],
];
const SAVE: Item = ["when this unit makes a **save roll**", "event", { kind: "after-roll", roll: "save", subject: "this-unit" }];
const BAND = (parameters: Record<string, unknown> = { from: 6, to: 6, unmodified: true }): Item => ["On an unmodified 6", "roll-result", parameters];
const WOUND: Item = ["that enemy unit suffers 1 mortal wound", "mortal-wounds", { recipient: "event-subject", count: "1" }];
const AFTER: Item = ["after that enemy unit has shot", "event", { kind: "enemy-has-shot" }];

function compiled(items: Item[], text = TEXT) {
  return compileLeaves(placed(text, ...items), text, {});
}

function errors(items: Item[], text = TEXT): string {
  const result = compiled(items, text);
  return result.ok ? "" : result.errors.join(" ");
}

describe("a moment within an earlier moment's window, narrowed to unmodified faces, with a delayed effect", () => {
  it("nests the roll moment under the first moment's window, and delays the wound until the bound enemy unit has shot", () => {
    const result = compiled([...LEAD, SAVE, BAND(), WOUND, AFTER]);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const mechanics = result.mechanics as any;
    expect(mechanics.trigger).toMatchObject({ event: "targets-selected", object: "this-unit", binds_event_variable: "moment-subject" });
    expect(mechanics.scope).toEqual({ duration: "attack-sequence" });
    expect(mechanics.effect).toEqual({ type: "ability-part", trigger: { event: "after-roll", filter: { roll: "save", unmodified: { from: 6, to: 6 } } }, effect: {
      type: "ability-part", trigger: { event: "attacks-resolved", filter: { kind: "shoot" }, subject: { event_var: "moment-subject" } }, duration: "phase",
      effect: { type: "mortal-wounds", target: "event-subject", modifier: { count: 1 } },
    } });
    const render = describeAbility({ id: "sample", name: "Sample", ...mechanics });
    expect(render).toContain("After a saving throw is made, on an unmodified 6:");
    expect(render).toContain("After that unit shoots, until the end of the phase:");
  });

  it("keeps the moments as alternatives with no duration between them", () => {
    const text = TEXT.replace(" until that enemy unit has shot,", "");
    const result = compiled([LEAD[0]!, LEAD[1]!, SAVE, BAND(), WOUND], text.replace(" after that enemy unit has shot", ""));
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(Array.isArray((result.mechanics as any).trigger)).toBe(true);
  });

  it("does not nest a moment set apart from the duration by more than a comma", () => {
    const text = TEXT.replace("has shot, when this unit", "has shot. Then, when this unit");
    const result = compiled([...LEAD, SAVE, BAND(), WOUND, AFTER], text);
    expect(result.ok && (result.mechanics as any).effect.trigger?.event === "after-roll").toBe(false);
  });

  it("leaves a moment after the effect that does not name that unit for the part planner", () => {
    const text = TEXT.replace("after that enemy unit has shot", "after an enemy unit has shot");
    expect(errors([...LEAD, SAVE, BAND(), WOUND, ["after an enemy unit has shot", "event", { kind: "enemy-has-shot" }]], text)).toMatch(/A moment ends the ability with no effect after it/u);
  });

  it("refuses a delayed moment whose \"that\" unit no leading moment names", () => {
    const text = "At the end of your Command phase, roll one D6: on a 6, this unit suffers 1 mortal wound after that enemy unit has shot.";
    const items: Item[] = [
      ["At the end of your Command phase", "event", { kind: "phase-end", phase: "command", turn: "your" }],
      ["roll one D6", "dice-roll", { dice: "D6" }],
      ["on a 6", "roll-result", { from: 6, to: 6 }],
      ["this unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }],
      AFTER,
    ];
    expect(errors(items, text)).toMatch(/no one earlier moment names an acting enemy unit/u);
  });
});

describe("unmodified faces of a moment's roll (compile-roll-faces.ts)", () => {
  const text = "Each time this unit makes a **save roll**, on an unmodified 5+, this unit suffers 1 mortal wound.";
  const save: Item = ["Each time this unit makes a **save roll**", "event", { kind: "after-roll", roll: "save", subject: "this-unit" }];
  const band = (parameters: Record<string, unknown>): Item => ["on an unmodified 5+", "roll-result", parameters];
  const wound: Item = ["this unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }];

  it("reads a minimum band as up to 6", () => {
    const result = compiled([save, band({ from: 5, unmodified: true }), wound], text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect((result.mechanics as any).trigger.filter).toEqual({ roll: "save", unmodified: { from: 5, to: 6 } });
    expect(describeAbility({ id: "sample", name: "Sample", ...(result.mechanics as any) })).toContain("on an unmodified 5+");
  });

  it("refuses a band on a moment before the roll", () => {
    expect(errors([[save[0], "event", { kind: "before-roll", roll: "save" }], band({ from: 5, unmodified: true }), wound], text)).toMatch(/reads a roll already made/u);
  });

  it("refuses a second band on one moment", () => {
    const two = "Each time this unit makes a **save roll**, on an unmodified 5+, this unit suffers 1 mortal wound; on an unmodified 1, this unit suffers 1 mortal wound.";
    const items: Item[] = [save, band({ from: 5, unmodified: true }), wound, ["on an unmodified 1", "roll-result", { from: 1, to: 1, unmodified: true }], wound];
    expect(errors(items, two)).toMatch(/more than one unmodified band/u);
  });

  it("keeps a band on the ability's own dice for the dice rules", () => {
    const own = "Each time this unit makes a **save roll**, roll one D6: on an unmodified 5+, this unit suffers 1 mortal wound.";
    const result = compiled([save, ["roll one D6", "dice-roll", { dice: "D6" }], band({ from: 5, unmodified: true }), wound], own);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(JSON.stringify(result.mechanics)).not.toContain("unmodified");
  });

  it("takes unmodified only as true", () => {
    const version = currentFamilyVersion("roll-result");
    expect(normalizeFingerprintParameters("roll-result", { from: 6, to: 6, unmodified: true }, version)).toEqual({ from: 6, to: 6, unmodified: true });
    expect(() => normalizeFingerprintParameters("roll-result", { from: 6, unmodified: false }, version)).toThrow(/true or absent/u);
  });
});
