import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

// Fabricated wording and identities; no rules text.

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order. */
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

/** Every node of `type` in an effect tree, depth-first. */
function nodes(node: unknown, type: string): Record<string, any>[] {
  if (Array.isArray(node)) return node.flatMap((inner) => nodes(inner, type));
  if (node === null || typeof node !== "object") return [];
  const record = node as Record<string, any>;
  return [...(record.type === type ? [record] : []), ...Object.values(record).flatMap((inner) => nodes(inner, type))];
}

const OFFER = "During your Movement phase, whenever this unit is chosen for a Normal move, it may use this ability. If so, until the end of the turn, its models have a Move of 20.";
const text = (joint = ",") => `${OFFER} Each time this unit uses this ability${joint} at the end of the phase, roll one D6 for each model in it: for each 1, this unit suffers 1 mortal wound.`;

const opening: Item[] = [
  ["During your Movement phase", "phase-window", { phase: "movement", turn: "your" }],
  ["whenever this unit is chosen for a Normal move", "event", { kind: "selected", move_types: ["normal"], to: "move" }],
  ["it may use this ability", "optional-use", { who: "this-unit" }],
  ["until the end of the turn", "duration", { endpoint: "end-of-turn" }],
  ["its models have a Move of 20", "characteristic-set", { subject: "this-unit", characteristic: "M", value: 20 }],
];
const later = (use: Record<string, unknown>): Item[] => [
  ["Each time this unit uses this ability", "event", use],
  ["at the end of the phase", "event", { kind: "phase-end", phase: "any", turn: "either" }],
  ["roll one D6 for each model in it", "dice-roll", { dice: "D6", per_model: "this-unit" }],
  ["for each 1", "roll-result", { from: 1, to: 1 }],
  ["this unit suffers 1 mortal wound", "mortal-wounds", { recipient: "this-unit", count: "1" }],
];
const OWN = { kind: "used", activity: "ability", id: "sample-jump" };

function compiled(items: Item[], source = text(), abilityId: string | null = "sample-jump") {
  return compileLeaves(placed(source, ...items), source, abilityId === null ? {} : { abilityId });
}

describe("a phase end after each use of the record's own ability", () => {
  it("nests in the part that offers the use, for that phase, and the use is not a moment of its own", () => {
    const result = compiled([...opening, ...later(OWN)]);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const parts = nodes(result.mechanics, "ability-part");
    const offering = parts.find((part) => (part.trigger as Record<string, unknown>)?.event === "selected")!;
    const steps = offering.effect.steps as Record<string, any>[];
    // The phase end is the offering part's last step, so each use schedules it once.
    expect(steps.at(-1)).toMatchObject({ type: "ability-part", trigger: { event: "phase-ended" }, duration: "phase",
      effect: { type: "mortal-wounds", target: "this-unit" } });
    // No part fires on the use itself, and no phase end fires outside the offering part.
    expect(JSON.stringify(result.mechanics)).not.toContain("\"used\"");
    expect(parts.filter((part) => (part.trigger as Record<string, unknown>)?.event === "phase-ended")).toHaveLength(1);
  });

  it("refuses a use of some other ability, which is not the offering part's moment", () => {
    const result = compiled([...opening, ...later({ ...OWN, id: "other-rule" })]);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/moment nested in another/u);
  });

  it("refuses in a record with no id, where this ability names nothing", () => {
    const result = compiled([...opening, ...later(OWN)], text(), null);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/moment nested in another/u);
  });

  it("refuses a use that names no ability in a record with no id, where neither names this ability", () => {
    const { id: _id, ...unnamed } = OWN;
    const result = compiled([...opening, ...later(unnamed)], text(), null);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/moment nested in another/u);
  });

  it("leaves two moments joined by and as they were, a list of moments, not a phase end after the use", () => {
    const result = compiled([...opening, ...later(OWN)], text(" and"));
    if (!result.ok) throw new Error(result.errors.join("; "));
    const parts = nodes(result.mechanics, "ability-part");
    expect(parts.some((part) => part.duration === "phase")).toBe(false);
    expect(parts.find((part) => Array.isArray(part.trigger))?.trigger).toEqual([{ event: "used", filter: { kind: "ability", id: "sample-jump" } }, { event: "phase-ended" }]);
  });

  it("refuses when no optional use offers the ability", () => {
    const result = compiled([...opening.filter(([, family]) => family !== "optional-use"), ...later(OWN)]);
    expect(result.ok ? "" : result.errors.join(" ")).toMatch(/moment nested in another/u);
  });
});
