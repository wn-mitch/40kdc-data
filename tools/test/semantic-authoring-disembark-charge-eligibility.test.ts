import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters as normalizeAt } from "../src/semantic-authoring/contracts.js";

const normalizeFingerprintParameters = (family: string, parameters: Record<string, unknown>) => normalizeAt(family, parameters, currentFamilyVersion(family));

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
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

function compiledOf(list: CompileLeaf[], text: string): { ok: boolean; mechanics?: Record<string, any>; checks?: unknown[]; errors?: string[] } {
  const result = compileLeaves(list, text);
  return result.ok ? { ok: true, mechanics: result.mechanics as unknown as Record<string, any>, checks: result.checks } : { ok: false, errors: result.errors };
}

// Fabricated wording only: the three moments of a disembark-then-charge permission.
const PLAIN = "Each time a unit disembarks from this model after it has made a Normal move, that unit is still eligible to declare a charge this turn.";
const EVENT: [string, string, Record<string, unknown>] = ["Each time a unit disembarks from this model", "event", { kind: "disembarked", transport: "this-unit" }];
const ORDER: [string, string, Record<string, unknown>] = ["after it has made a Normal move", "unit-activity", { activities: ["made-normal-move-this-turn"], subject: "this-model", negated: false }];
const PERMIT: [string, string, Record<string, unknown>] = ["that unit is still eligible to declare a charge this turn", "eligibility-permission", { subject: "antecedent", activity: "declare-charge", allow: true, despite: ["disembarked-this-turn"] }];

describe("event transport on a disembarked moment", () => {
  it("is the current event version, with transport closed to this-unit on disembarked", () => {
    expect(currentFamilyVersion("event")).toBeGreaterThanOrEqual(19);
    expect(() => normalizeFingerprintParameters("event", { kind: "disembarked", transport: "this-unit" })).not.toThrow();
    expect(() => normalizeFingerprintParameters("event", { kind: "disembarked", transport: "bearer" })).toThrow();
  });

  it("refuses transport on any kind but disembarked", () => {
    expect(() => normalizeFingerprintParameters("event", { kind: "move-ended", transport: "this-unit" })).toThrow(/disembarked/u);
    expect(() => normalizeFingerprintParameters("event", { kind: "selected", transport: "this-unit" })).toThrow(/disembarked/u);
  });

  it("refuses transport with a subject or an owner on the same moment", () => {
    expect(() => normalizeFingerprintParameters("event", { kind: "disembarked", transport: "this-unit", subject: "this-unit" })).toThrow();
    expect(() => normalizeFingerprintParameters("event", { kind: "disembarked", transport: "this-unit", owner: "friendly" })).toThrow();
  });

  it("keeps a bare disembarked moment as the bare trigger (existing records depend on it)", () => {
    const text = "Each time a unit disembarks from a Transport, this unit suffers D3 mortal wounds.";
    const result = compiledOf(placed(text,
      ["Each time a unit disembarks from a Transport", "event", { kind: "disembarked" }],
      ["this unit suffers D3 mortal wounds", "mortal-wounds", { recipient: "this-unit", count: "D3" }]), text);
    expect(result.ok).toBe(true);
    expect(result.mechanics!.trigger).toEqual({ event: "disembarked" });
  });
});

describe("disembark then charge eligibility (fabricated wording)", () => {
  it("compiles the moment with its Transport filter, the Normal-move history and a conditional permission", () => {
    const result = compiledOf(placed(PLAIN, EVENT, ORDER, PERMIT), PLAIN);
    expect(result.ok).toBe(true);
    expect(result.mechanics!.trigger).toEqual({ event: "disembarked", subject: { owner: "any" }, filter: { transport: "this-unit" } });
    expect(result.mechanics!.effects ?? result.mechanics!.effect).toEqual({
      type: "conditional",
      condition: { type: "happened", parameters: { event: "move-ended", subject: "this-model", filter: { move_types: ["normal"] }, window: "turn" } },
      effect: { type: "permission", target: "event-subject", modifier: { activity: "declare-charge", allow: true, despite: ["disembarked-this-turn"] } },
    });
  });

  it("refuses the same wording when the permission is written as a CONDITION (the mislabel)", () => {
    const eligibleAsCondition: [string, string, Record<string, unknown>] = ["that unit is still eligible to declare a charge this turn", "eligible", { subject: "antecedent", to: "declare-charge" }];
    const result = compiledOf(placed(PLAIN, EVENT, ORDER, eligibleAsCondition), PLAIN);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["There is no effect leaf to compile."]);
  });
});

describe("disembark moments by shape (fabricated wording)", () => {
  it("folds a unit-ability qualifier on the disembarking unit into the moment's subject, with the Transport kept as the filter", () => {
    const text = "Each time a unit with the Deep Strike ability disembarks from this model after it has made a Normal move, that unit is still eligible to declare a charge this turn.";
    const result = compiledOf(placed(text,
      ["a unit", "unit-filter", { side: "any" }],
      ["with the Deep Strike ability", "unit-has-ability", { subject: "antecedent", ability: "deep-strike", negated: false }],
      ["disembarks from this model", "event", { kind: "disembarked", transport: "this-unit" }],
      ORDER, PERMIT), text);
    expect(result.ok).toBe(true);
    expect(result.mechanics!.trigger).toEqual({ event: "disembarked", subject: { owner: "any", has_ability: ["deep-strike"] }, filter: { transport: "this-unit" } });
  });

  it("keeps the bearer gate on the disembarking Transport's model, with the moment on the bearer's Transport", () => {
    const text = "FOO BAR model only. Each time a unit disembarks from the bearer after it has made a Normal move, that unit is still eligible to declare a charge this turn.";
    const result = compiledOf(placed(text,
      ["FOO BAR model only", "bearer-eligibility", { keywords: ["FOO", "BAR"], match: "all", excluded_keywords: [] }],
      ["Each time a unit disembarks from the bearer", "event", { kind: "disembarked", transport: "this-unit" }],
      ORDER, PERMIT), text);
    expect(result.ok).toBe(true);
    expect(result.mechanics!.trigger).toEqual({ event: "disembarked", subject: { owner: "any" }, filter: { transport: "this-unit" } });
    expect(result.checks).toContainEqual({ kind: "bearer-eligibility", parameters: { keywords: ["FOO", "BAR"], match: "all", excluded_keywords: [] } });
  });
});

describe("disembark describer", () => {
  it("renders a Transport-filtered disembark as from this Transport", async () => {
    const { describeTrigger } = await import("../src/translate/trigger.js");
    expect(describeTrigger({ event: "disembarked", subject: { owner: "any" }, filter: { transport: "this-unit" } } as never)).toBe("when a unit disembarks from this Transport");
  });
});
