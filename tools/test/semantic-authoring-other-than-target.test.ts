import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { familyExtension } from "../src/semantic-authoring/families/index.js";

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
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

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

/** The unit-filter version that adds other_than target and event-object. */
function otherThanTargetVersion(): number {
  for (let version = currentFamilyVersion("unit-filter"); version > 1; version -= 1) {
    if (familyExtension("unit-filter", version)?.description.includes("other_than target")) return version;
  }
  throw new Error("No unit-filter version adds other_than target.");
}

const norm = (parameters: Record<string, unknown>, version = currentFamilyVersion("unit-filter")) => normalizeFingerprintParameters("unit-filter", parameters, version);

describe("unit-filter other_than target and event-object", () => {
  it("keeps the new values on other: true, refuses them without it, and refuses them before the version", () => {
    expect(norm({ side: "enemy", other: true, other_than: "target" })).toEqual({ side: "enemy", other: true, other_than: "target" });
    expect(norm({ side: "enemy", other: true, other_than: "event-object" })).toEqual({ side: "enemy", other: true, other_than: "event-object" });
    expect(() => norm({ side: "enemy", other_than: "target" })).toThrow();
    expect(() => norm({ side: "enemy", other: true, other_than: "this-unit" })).toThrow();
    const previous = otherThanTargetVersion() - 1;
    expect(() => norm({ side: "enemy", other: true, other_than: "target" }, previous)).toThrow();
    // Earlier values move across unchanged.
    expect(norm({ side: "friendly", other: true, other_than: "event-subject" })).toEqual(norm({ side: "friendly", other: true, other_than: "event-subject" }, previous));
    expect(norm({ side: "enemy", other: true })).toEqual(norm({ side: "enemy", other: true }, previous));
  });

  const text = "In your Shooting phase, when this unit's ranged attacks target an enemy unit, select one other enemy unit within 3\" of the target. That unit suffers D3 mortal wounds.";
  const leaves = (filter: Record<string, unknown>) => placed(text,
    ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
    ["ranged attacks target an enemy unit", "event", { kind: "targets-selected", subject: "this-unit", action_kind: "shoot" }],
    ["select one", "select-unit", { distance: "any", visible: false }],
    ["other enemy unit", "unit-filter", filter],
    ["within 3\" of the target", "unit-position", { kind: "within", inches: 3, of: "target", subject: "antecedent", negated: false }],
    ["That unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "antecedent", count: "D3" }]);

  it("excludes the attack's target from an enemy selection, not the unit with the ability", () => {
    const json = JSON.stringify(mechanicsOf(leaves({ side: "enemy", other: true, other_than: "target" }), text));
    expect(json).toContain('"excluding":"defender"');
    expect(json).not.toContain('"excluding":"this-unit"');
  });

  it("still excludes the unit with the ability when other names nothing else", () => {
    expect(JSON.stringify(mechanicsOf(leaves({ side: "enemy", other: true }), text))).toContain('"excluding":"this-unit"');
  });
});
